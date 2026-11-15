(function (root) {
  'use strict';
  var DB_NAME = 'dscode-db', DB_VERSION = 1, STORE = 'kv';
  var WS_KEY = 'workspace', SYNC_KEY = 'sync', INBOX_KEY = 'dscode-handoff', LEGACY_KEY = 'dscode-workspace-v8';
  var channel = null;
  try { channel = new BroadcastChannel('dscode-sync'); } catch (e) {}
  var dbPromise = null;
  var instanceId = Math.random().toString(36).slice(2);

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!root.indexedDB) { reject(new Error('IndexedDB is not available in this browser or mode.')); return; }
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () { req.result.createObjectStore(STORE); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('Could not open IndexedDB.')); };
      req.onblocked = function () { reject(new Error('IndexedDB is blocked by another tab.')); };
    });
    return dbPromise;
  }

  function tx(mode, fn) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(STORE, mode), store = t.objectStore(STORE), req;
        try { req = fn(store); } catch (e) { reject(e); return; }
        t.oncomplete = function () { resolve(req ? req.result : undefined); };
        t.onerror = function () { reject(t.error || new Error('IndexedDB transaction failed.')); };
        t.onabort = function () { reject(t.error || new Error('IndexedDB transaction aborted (storage quota may be full).')); };
      });
    });
  }

  function get(key) { return tx('readonly', function (s) { return s.get(key); }); }
  function put(key, val) { return tx('readwrite', function (s) { return s.put(val, key); }); }
  function del(key) { return tx('readwrite', function (s) { return s.delete(key); }); }

  function emptyWorkspace() {
    return { files: {}, folders: [], expanded: [''], openTabs: [], activeTab: null, settings: {}, previewStorage: {} };
  }

  function normalizeWorkspace(w) {
    var base = emptyWorkspace();
    if (!w || typeof w !== 'object') return base;
    var files = {};
    Object.keys(w.files || {}).forEach(function (p) {
      var f = w.files[p];
      if (f && typeof f.content === 'string') files[p] = { content: f.content, binary: !!f.binary, mime: f.mime || '' };
    });
    base.files = files;
    base.folders = Array.isArray(w.folders) ? w.folders.filter(function (x) { return typeof x === 'string'; }) : [];
    base.expanded = Array.isArray(w.expanded) ? w.expanded : [''];
    base.openTabs = (Array.isArray(w.openTabs) ? w.openTabs : []).filter(function (p) { return files[p]; });
    base.activeTab = w.activeTab && files[w.activeTab] ? w.activeTab : (base.openTabs[0] || null);
    base.settings = w.settings && typeof w.settings === 'object' ? w.settings : {};
    base.previewStorage = w.previewStorage && typeof w.previewStorage === 'object' ? w.previewStorage : {};
    return base;
  }

  function loadWorkspace() {
    return get(WS_KEY).then(function (w) {
      if (w) return normalizeWorkspace(w);
      var legacy = null;
      try { legacy = JSON.parse(root.localStorage.getItem(LEGACY_KEY) || 'null'); } catch (e) {}
      return normalizeWorkspace(legacy);
    });
  }

  function saveWorkspace(ws) {
    return put(WS_KEY, ws).then(function () { notify('workspace'); });
  }

  function loadSync() { return get(SYNC_KEY).then(function (s) { return s || null; }); }
  function saveSync(s) { return put(SYNC_KEY, s).then(function () { notify('sync'); }); }
  function clearSync() { return del(SYNC_KEY).then(function () { notify('sync'); }); }

  function notify(kind) {
    if (channel) { try { channel.postMessage({ kind: kind, at: Date.now(), from: instanceId }); } catch (e) {} }
  }

  function onChange(cb) {
    if (!channel) return function () {};
    var h = function (ev) { if (ev.data && ev.data.from !== instanceId) cb(ev.data.kind); };
    channel.addEventListener('message', h);
    return function () { channel.removeEventListener('message', h); };
  }

  function requestFlush(timeoutMs) {
    return new Promise(function (resolve) {
      if (!channel) { resolve(false); return; }
      var done = false, off = onChange(function (kind) { if (kind === 'flushed' && !done) { done = true; off(); resolve(true); } });
      setTimeout(function () { if (!done) { done = true; off(); resolve(false); } }, timeoutMs || 1200);
      notify('flush-request');
    });
  }

  function takeInbox() {
    var raw = null;
    try { raw = root.localStorage.getItem(INBOX_KEY); root.localStorage.removeItem(INBOX_KEY); } catch (e) { return null; }
    if (!raw) return null;
    try {
      var p = JSON.parse(raw);
      if (!p || typeof p !== 'object' || !p.files) return null;
      return p;
    } catch (e) { return null; }
  }

  function utf8ToBytes(s) { return new TextEncoder().encode(s); }
  function b64ToBytes(b64) {
    var bin = atob(b64), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function bytesToB64(bytes) {
    var CHUNK = 0x8000, parts = [];
    for (var i = 0; i < bytes.length; i += CHUNK) parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK)));
    return btoa(parts.join(''));
  }
  function fileBytes(f) { return f.binary ? b64ToBytes(f.content) : utf8ToBytes(f.content); }

  function sha1Fallback(bytes) {
    var h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE, h3 = 0x10325476, h4 = 0xC3D2E1F0;
    var len = bytes.length, total = (((len + 8) >> 6) + 1) << 6, buf = new Uint8Array(total);
    buf.set(bytes); buf[len] = 0x80;
    var dv = new DataView(buf.buffer), bits = len * 8;
    dv.setUint32(total - 8, Math.floor(bits / 4294967296)); dv.setUint32(total - 4, bits >>> 0);
    var w = new Uint32Array(80);
    function rol(x, n) { return ((x << n) | (x >>> (32 - n))) >>> 0; }
    for (var off = 0; off < total; off += 64) {
      var i;
      for (i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
      for (i = 16; i < 80; i++) w[i] = rol(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
      var a = h0, b = h1, c = h2, d = h3, e = h4;
      for (i = 0; i < 80; i++) {
        var f, k;
        if (i < 20) { f = (b & c) | (~b & d); k = 0x5A827999; }
        else if (i < 40) { f = b ^ c ^ d; k = 0x6ED9EBA1; }
        else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC; }
        else { f = b ^ c ^ d; k = 0xCA62C1D6; }
        var t = (rol(a, 5) + (f >>> 0) + e + k + w[i]) >>> 0;
        e = d; d = c; c = rol(b, 30); b = a; a = t;
      }
      h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
    }
    return [h0, h1, h2, h3, h4].map(function (x) { return ('00000000' + x.toString(16)).slice(-8); }).join('');
  }

  function sha1Hex(bytes) {
    if (root.crypto && root.crypto.subtle && root.isSecureContext !== false) {
      return root.crypto.subtle.digest('SHA-1', bytes).then(function (buf) {
        return Array.prototype.map.call(new Uint8Array(buf), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
      }).catch(function () { return sha1Fallback(bytes); });
    }
    return Promise.resolve(sha1Fallback(bytes));
  }

  function gitBlobSha(bytes) {
    var header = utf8ToBytes('blob ' + bytes.length + '\0'), all = new Uint8Array(header.length + bytes.length);
    all.set(header); all.set(bytes, header.length);
    return sha1Hex(all);
  }

  var api = {
    loadWorkspace: loadWorkspace, saveWorkspace: saveWorkspace, emptyWorkspace: emptyWorkspace, normalizeWorkspace: normalizeWorkspace,
    loadSync: loadSync, saveSync: saveSync, requestFlush: requestFlush, clearSync: clearSync, onChange: onChange, notify: notify, takeInbox: takeInbox,
    fileBytes: fileBytes, bytesToB64: bytesToB64, b64ToBytes: b64ToBytes, utf8ToBytes: utf8ToBytes,
    gitBlobSha: gitBlobSha, sha1Fallback: sha1Fallback, INBOX_KEY: INBOX_KEY
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DSStore = api;
})(typeof window !== 'undefined' ? window : globalThis);
