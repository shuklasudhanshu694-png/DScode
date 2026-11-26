(function (root) {
  'use strict';
  var TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();

  function crc32(bytes) {
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) crc = TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function dosDateTime(d) {
    var time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    var date = ((Math.max(d.getFullYear(), 1980) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    return { time: time & 0xFFFF, date: date & 0xFFFF };
  }

  function safePath(p) {
    var parts = String(p).replace(/\\/g, '/').split('/'), out = [];
    for (var i = 0; i < parts.length; i++) {
      var s = parts[i];
      if (s === '' || s === '.') continue;
      if (s === '..') return null;
      if (/^[a-zA-Z]:$/.test(s) && i === 0) return null;
      out.push(s);
    }
    return out.join('/');
  }

  function createZip(entries) {
    var enc = new TextEncoder(), parts = [], central = [], offset = 0, dt = dosDateTime(new Date());
    entries.forEach(function (e) {
      var name = enc.encode(e.dir ? e.path.replace(/\/?$/, '/') : e.path), data = e.dir ? new Uint8Array(0) : e.bytes, crc = e.dir ? 0 : crc32(data);
      var lh = new Uint8Array(30 + name.length), lv = new DataView(lh.buffer);
      lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true); lv.setUint16(8, 0, true);
      lv.setUint16(10, dt.time, true); lv.setUint16(12, dt.date, true); lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true); lv.setUint16(26, name.length, true); lv.setUint16(28, 0, true);
      lh.set(name, 30);
      var ch = new Uint8Array(46 + name.length), cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 0x031E, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true); cv.setUint16(10, 0, true);
      cv.setUint16(12, dt.time, true); cv.setUint16(14, dt.date, true); cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, name.length, true);
      cv.setUint32(38, e.dir ? 0x41ED0010 : 0x81A40000, true); cv.setUint32(42, offset, true);
      ch.set(name, 46);
      parts.push(lh, data); central.push(ch); offset += lh.length + data.length;
    });
    var cdSize = central.reduce(function (s, c) { return s + c.length; }, 0), end = new Uint8Array(22), ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true);
    ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
    return new Blob(parts.concat(central, [end]), { type: 'application/zip' });
  }

  function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') return Promise.reject(new Error('This browser cannot decompress ZIP entries (DecompressionStream missing). Use a current Chrome, Edge, Firefox or Safari.'));
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(stream).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }

  function readZip(buffer, limits) {
    limits = limits || {};
    var maxEntries = limits.maxEntries || 5000, maxTotal = limits.maxTotal || 100 * 1024 * 1024, maxEntry = limits.maxEntry || 25 * 1024 * 1024;
    var u8 = new Uint8Array(buffer), dv = new DataView(buffer), eocd = -1;
    for (var i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd === -1) return Promise.reject(new Error('Not a valid ZIP file (end-of-archive record not found).'));
    var count = dv.getUint16(eocd + 10, true), cdOffset = dv.getUint32(eocd + 16, true);
    if (count === 0xFFFF || cdOffset === 0xFFFFFFFF) return Promise.reject(new Error('ZIP64 archives are not supported.'));
    if (count > maxEntries) return Promise.reject(new Error('ZIP has too many entries (' + count + ', limit ' + maxEntries + ').'));
    var dec = new TextDecoder('utf-8'), pos = cdOffset, jobs = [], total = 0;
    for (var n = 0; n < count; n++) {
      if (dv.getUint32(pos, true) !== 0x02014b50) return Promise.reject(new Error('ZIP central directory is corrupt.'));
      var flags = dv.getUint16(pos + 8, true), method = dv.getUint16(pos + 10, true), csize = dv.getUint32(pos + 20, true), usize = dv.getUint32(pos + 24, true);
      var nlen = dv.getUint16(pos + 28, true), elen = dv.getUint16(pos + 30, true), clen = dv.getUint16(pos + 32, true), lho = dv.getUint32(pos + 42, true);
      var rawName = dec.decode(u8.subarray(pos + 46, pos + 46 + nlen));
      pos += 46 + nlen + elen + clen;
      var isDir = /\/$/.test(rawName), path = safePath(rawName);
      if (path === null) { jobs.push({ skipped: rawName, reason: 'unsafe path' }); continue; }
      if (!path) continue;
      if (flags & 1) { jobs.push({ skipped: rawName, reason: 'encrypted' }); continue; }
      if (usize > maxEntry) { jobs.push({ skipped: rawName, reason: 'file larger than ' + Math.round(maxEntry / 1048576) + ' MB' }); continue; }
      total += usize;
      if (total > maxTotal) return Promise.reject(new Error('ZIP expands to more than ' + Math.round(maxTotal / 1048576) + ' MB. Import aborted.'));
      jobs.push({ path: path, dir: isDir, method: method, csize: csize, usize: usize, lho: lho });
    }
    var results = [], skipped = [];
    return jobs.reduce(function (chain, job) {
      return chain.then(function () {
        if (job.skipped) { skipped.push(job.skipped + ' (' + job.reason + ')'); return; }
        if (job.dir) { results.push({ path: job.path, dir: true }); return; }
        if (dv.getUint32(job.lho, true) !== 0x04034b50) { skipped.push(job.path + ' (corrupt header)'); return; }
        var start = job.lho + 30 + dv.getUint16(job.lho + 26, true) + dv.getUint16(job.lho + 28, true), data = u8.subarray(start, start + job.csize);
        if (job.method === 0) { results.push({ path: job.path, bytes: data.slice() }); return; }
        if (job.method === 8) {
          return inflateRaw(data).then(function (out) {
            if (out.length > maxEntry) { skipped.push(job.path + ' (too large)'); return; }
            results.push({ path: job.path, bytes: out });
          }, function (err) { skipped.push(job.path + ' (' + err.message + ')'); });
        }
        skipped.push(job.path + ' (unsupported compression method ' + job.method + ')');
      });
    }, Promise.resolve()).then(function () { return { entries: results, skipped: skipped }; });
  }

  var api = { crc32: crc32, createZip: createZip, readZip: readZip, safePath: safePath };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DSZip = api;
})(typeof window !== 'undefined' ? window : globalThis);
