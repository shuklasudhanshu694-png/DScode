(function () {
  'use strict';
  var App = window.DSApp, L = window.DSLang, Z = window.DSZip, S = window.DSStore;
  var state = App.state, $ = function (id) { return document.getElementById(id); }, el = App.el;
  var MAX_TEXT = 8 * 1024 * 1024, MAX_BIN = 15 * 1024 * 1024;

  var ICONS = { html: '🌐', htm: '🌐', css: '🎨', js: '⚡', mjs: '⚡', ts: '🔷', jsx: '⚛', tsx: '⚛', json: '📋', md: '📝', txt: '📄', xml: '📄', svg: '🖼️', py: '🐍', yml: '⚙️', yaml: '⚙️', sh: '🐚',
    png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', webp: '🖼️', ico: '🖼️', pdf: '📕', zip: '🗜️', woff: '🔤', woff2: '🔤', ttf: '🔤' };
  function iconOf(name) { return ICONS[L.extOf(name)] || '📄'; }

  function openFile(path, opts) {
    if (!state.files[path]) return;
    if (state.openTabs.indexOf(path) === -1) state.openTabs.push(path);
    state.activeTab = path; App.expandTo(path);
    renderTabs(); renderTree(); App.syncEditor(); App.scheduleSave();
  }
  function switchTab(path) { if (state.activeTab === path) return; state.activeTab = path; renderTabs(); renderTree(); App.syncEditor(); App.scheduleSave(); }
  function closeTab(path) {
    var i = state.openTabs.indexOf(path);
    state.openTabs = state.openTabs.filter(function (p) { return p !== path; });
    if (state.activeTab === path) state.activeTab = state.openTabs[Math.min(i, state.openTabs.length - 1)] || null;
    App.disposeEditor(path); renderTabs(); renderTree(); App.syncEditor(); App.scheduleSave();
  }

  function renderTabs() {
    var host = $('tabs'); host.innerHTML = '';
    state.openTabs.forEach(function (path) {
      var ed = state.editors[path], hasErr = ed && ed.errors.some(function (e) { return e.type === 'error'; });
      var tab = el('div', 'tab' + (path === state.activeTab ? ' active' : '') + (hasErr ? ' err' : ''));
      tab.title = path;
      tab.appendChild(el('span', 'tab-icon', iconOf(path)));
      tab.appendChild(el('span', 'tab-name', path.split('/').pop()));
      var close = el('button', 'tab-close', '✕');
      close.addEventListener('click', function (e) { e.stopPropagation(); closeTab(path); });
      tab.appendChild(close);
      tab.addEventListener('click', function () { switchTab(path); });
      tab.addEventListener('mousedown', function (e) { if (e.button === 1) { e.preventDefault(); closeTab(path); } });
      host.appendChild(tab);
      if (path === state.activeTab) setTimeout(function () { tab.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, 0);
    });
  }

  function buildTree() {
    var root = { name: '', type: 'folder', children: {}, path: '' };
    function ensure(parts) {
      var node = root;
      for (var i = 0; i < parts.length; i++) {
        if (!node.children[parts[i]]) node.children[parts[i]] = { name: parts[i], type: 'folder', children: {}, path: parts.slice(0, i + 1).join('/') };
        node = node.children[parts[i]];
      }
      return node;
    }
    Object.keys(state.files).forEach(function (p) { var parts = p.split('/'), n = ensure(parts.slice(0, -1)); n.children[parts[parts.length - 1]] = { name: parts[parts.length - 1], type: 'file', path: p }; });
    state.folders.forEach(function (f) { ensure(f.split('/')); });
    return root;
  }

  function matchSets() {
    var q = state.filter.toLowerCase();
    if (!q) return null;
    var vis = {};
    Object.keys(state.files).forEach(function (p) {
      if (p.toLowerCase().indexOf(q) !== -1) { vis[p] = true; var d = App.parentDir(p); while (d) { vis[d] = true; d = App.parentDir(d); } }
    });
    App.allFolders().forEach(function (f) { if (f.toLowerCase().indexOf(q) !== -1) vis[f] = true; });
    return vis;
  }

  function renderTree() {
    var c = $('fileTree'); c.innerHTML = '';
    var tree = buildTree(), vis = matchSets();
    if (!Object.keys(tree.children).length) c.appendChild(el('div', 'tree-empty', 'No files yet — use ＋ or drop files here.'));
    else renderNode(tree, c, 0, vis);
    var n = Object.keys(state.files).length;
    $('fileCount').textContent = n + (n === 1 ? ' file' : ' files');
  }

  function renderNode(node, parent, depth, vis) {
    var keys = Object.keys(node.children).sort(function (a, b) {
      var A = node.children[a], B = node.children[b];
      if (A.type !== B.type) return A.type === 'folder' ? -1 : 1;
      return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    });
    keys.forEach(function (key) {
      var child = node.children[key];
      if (vis && !vis[child.path]) return;
      var row = el('div', 'tree-row'), isFolder = child.type === 'folder';
      row.style.paddingLeft = (depth * 12 + 8) + 'px'; row.draggable = true; row.dataset.path = child.path; row.dataset.type = child.type; row.title = child.path;
      if (isFolder) {
        var open = vis ? true : state.expanded.has(child.path);
        row.appendChild(el('span', 'arrow', open ? '▾' : '▸')); row.appendChild(el('span', 'icon', open ? '📂' : '📁'));
        row.appendChild(el('span', 'name', child.name));
        if (state.gitDirtyFolders[child.path]) row.appendChild(el('span', 'badge-git dot', '●'));
        row.addEventListener('click', function () { if (state.expanded.has(child.path)) state.expanded.delete(child.path); else state.expanded.add(child.path); App.scheduleSave(); renderTree(); });
        parent.appendChild(row);
        if (open) renderNode(child, parent, depth + 1, vis);
      } else {
        if (state.activeTab === child.path) row.classList.add('active');
        row.appendChild(el('span', 'arrow', '')); row.appendChild(el('span', 'icon', iconOf(child.name)));
        row.appendChild(el('span', 'name', child.name));
        var st = state.gitStatus[child.path];
        if (st) row.appendChild(el('span', 'badge-git ' + st, st));
        row.addEventListener('click', function () { openFile(child.path); });
        parent.appendChild(row);
      }
      row.addEventListener('contextmenu', function (e) { e.preventDefault(); showCtx(e.clientX, e.clientY, child.path, isFolder); });
      row.addEventListener('dragstart', function (e) { e.dataTransfer.setData('text/dscode-path', child.path); e.dataTransfer.effectAllowed = 'move'; });
      if (isFolder) {
        row.addEventListener('dragover', function (e) { if (hasInternal(e) || hasFiles(e)) { e.preventDefault(); row.classList.add('drop'); } });
        row.addEventListener('dragleave', function () { row.classList.remove('drop'); });
        row.addEventListener('drop', function (e) { e.preventDefault(); e.stopPropagation(); row.classList.remove('drop'); handleDrop(e, child.path); });
      }
    });
  }
  function hasInternal(e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types, 'text/dscode-path') !== -1; }
  function hasFiles(e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') !== -1; }

  function handleDrop(e, destFolder) {
    if (hasInternal(e)) {
      var src = e.dataTransfer.getData('text/dscode-path');
      if (!src) return;
      var isFolder = !state.files[src], name = App.baseName(src), dest = App.sanitizePath((destFolder ? destFolder + '/' : '') + name);
      if (dest === src) return;
      if (isFolder && (dest + '/').indexOf(src + '/') === 0) { App.toast('Cannot move a folder into itself.', { kind: 'error' }); return; }
      movePath(src, dest, isFolder);
    } else if (hasFiles(e)) collectDropped(e.dataTransfer, destFolder);
  }

  function showCtx(x, y, path, isFolder) {
    var items = [];
    var dir = path === null ? '' : (isFolder ? path : App.parentDir(path));
    items.push({ label: 'New file…', run: function () { newFile(dir ? dir + '/' : ''); } });
    items.push({ label: 'New folder…', run: function () { newFolder(dir ? dir + '/' : ''); } });
    if (path !== null) {
      items.push('-');
      if (!isFolder) { items.push({ label: 'Open', run: function () { openFile(path); } }); items.push({ label: 'Duplicate', run: function () { duplicate(path); } }); items.push({ label: 'Download', run: function () { downloadFile(path); } }); }
      items.push({ label: 'Rename / move…', run: function () { renamePath(path, isFolder); } });
      items.push({ label: 'Copy path', run: function () { navigator.clipboard && navigator.clipboard.writeText(path).then(function () { App.toast('Path copied.'); }, function () {}); } });
      items.push('-'); items.push({ label: 'Delete', cls: 'danger', run: function () { deletePath(path, isFolder); } });
    }
    var m = $('ctxMenu'); m.innerHTML = '';
    items.forEach(function (it) {
      if (it === '-') { m.appendChild(el('div', 'ctx-sep')); return; }
      var d = el('div', 'ctx-item ' + (it.cls || ''), it.label);
      d.addEventListener('click', function () { hideCtx(); it.run(); });
      m.appendChild(d);
    });
    m.classList.remove('hidden');
    m.style.left = Math.min(x, window.innerWidth - 190) + 'px'; m.style.top = Math.min(y, window.innerHeight - m.offsetHeight - 6) + 'px';
  }
  function hideCtx() { $('ctxMenu').classList.add('hidden'); }

  function validNewPath(raw) {
    var path = App.sanitizePath(raw);
    if (!path) { App.toast('Invalid path.', { kind: 'error' }); return null; }
    if (state.files[path] || state.folders.has(path) || App.allFolders().has(path)) { App.toast('"' + path + '" already exists.', { kind: 'error' }); return null; }
    var d = App.parentDir(path);
    while (d) { if (state.files[d]) { App.toast('"' + d + '" is a file, not a folder.', { kind: 'error' }); return null; } d = App.parentDir(d); }
    return path;
  }
  function newFile(prefill) {
    App.askText('New file', 'Path relative to the project root. Missing folders are created automatically.', prefill || '').then(function (raw) {
      if (raw === null || raw === undefined) return;
      var path = validNewPath(raw); if (!path) return;
      state.files[path] = { content: '', binary: false, mime: '' };
      openFile(path); App.scheduleGit();
    });
  }
  function newFolder(prefill) {
    App.askText('New folder', 'Folder path:', prefill || '').then(function (raw) {
      if (raw === null || raw === undefined) return;
      var path = validNewPath(raw); if (!path) return;
      state.folders.add(path); App.expandTo(path + '/x'); state.expanded.add(path); renderTree(); App.scheduleSave();
    });
  }

  function deletePath(path, isFolder) {
    var prefix = path + '/', affected = isFolder ? Object.keys(state.files).filter(function (p) { return p.indexOf(prefix) === 0; }) : [path];
    App.askConfirm(isFolder ? 'Delete folder "' + path + '" and its ' + affected.length + ' file(s)?' : 'Delete "' + path + '"?', 'Delete', true).then(function (ok) {
      if (!ok) return;
      var snap = App.snapshotFiles(affected);
      affected.forEach(function (p) { delete state.files[p]; App.disposeEditor(p); });
      if (isFolder) Array.from(state.folders).forEach(function (f) { if (f === path || f.indexOf(prefix) === 0) state.folders.delete(f); });
      state.openTabs = state.openTabs.filter(function (p) { return !!state.files[p]; });
      if (!state.files[state.activeTab]) state.activeTab = state.openTabs[state.openTabs.length - 1] || null;
      App.afterStructureChange(); App.scheduleSave();
      App.offerUndo('Deleted ' + (isFolder ? 'folder ' : '') + path, function () { if (isFolder) state.folders.add(path); App.restoreSnapshot(snap); });
    });
  }

  function movePath(oldPath, newPath, isFolder) {
    if (isFolder) {
      var prefix = oldPath + '/', np = newPath + '/';
      var moved = Object.keys(state.files).filter(function (p) { return p.indexOf(prefix) === 0; });
      for (var i = 0; i < moved.length; i++) { var t = newPath + '/' + moved[i].slice(prefix.length); if (state.files[t]) { App.toast('Target "' + t + '" already exists.', { kind: 'error' }); return; } }
      moved.forEach(function (p) { state.files[newPath + '/' + p.slice(prefix.length)] = state.files[p]; delete state.files[p]; App.disposeEditor(p); });
      Array.from(state.folders).forEach(function (f) { if (f === oldPath || f.indexOf(prefix) === 0) { state.folders.delete(f); state.folders.add(newPath + f.slice(oldPath.length)); } });
      state.folders.add(newPath);
      state.openTabs = state.openTabs.map(function (p) { return p.indexOf(prefix) === 0 ? np + p.slice(prefix.length) : p; });
      if (state.activeTab && state.activeTab.indexOf(prefix) === 0) state.activeTab = np + state.activeTab.slice(prefix.length);
      state.expanded.add(newPath);
    } else {
      state.files[newPath] = state.files[oldPath]; delete state.files[oldPath]; App.disposeEditor(oldPath);
      state.openTabs = state.openTabs.map(function (p) { return p === oldPath ? newPath : p; });
      if (state.activeTab === oldPath) state.activeTab = newPath;
    }
    App.expandTo(newPath + '/x'); App.afterStructureChange(); App.scheduleSave();
  }
  function renamePath(oldPath, isFolder) {
    App.askText(isFolder ? 'Rename / move folder' : 'Rename / move file', 'New path:', oldPath).then(function (raw) {
      if (raw === null || raw === undefined) return;
      var np = App.sanitizePath(raw);
      if (!np || np === oldPath) return;
      if (state.files[np] || App.allFolders().has(np)) { App.toast('"' + np + '" already exists.', { kind: 'error' }); return; }
      if (isFolder && (np + '/').indexOf(oldPath + '/') === 0) { App.toast('Cannot move a folder into itself.', { kind: 'error' }); return; }
      var d = App.parentDir(np); while (d) { if (state.files[d]) { App.toast('"' + d + '" is a file.', { kind: 'error' }); return; } d = App.parentDir(d); }
      movePath(oldPath, np, isFolder);
    });
  }
  function duplicate(path) {
    var np = App.uniquePath(path); state.files[np] = JSON.parse(JSON.stringify(state.files[path])); openFile(np); App.scheduleGit();
  }

  /* ---------- adding files from uploads / zip / text ---------- */
  function addFiles(entries, label) {
    entries = entries.filter(function (e) { return e && e.path; });
    if (!entries.length) { App.toast('Nothing to add.', { kind: 'warn' }); return Promise.resolve(0); }
    var conflicts = entries.filter(function (e) { var f = state.files[e.path]; return f && (f.content !== e.content || !!f.binary !== !!e.binary); });
    var same = entries.filter(function (e) { var f = state.files[e.path]; return f && f.content === e.content && !!f.binary === !!e.binary; }).length;
    var step = conflicts.length ? App.dialog({ title: 'Files already exist', msg: conflicts.length + ' incoming file(s) have different content from existing files with the same path:\n\n' + conflicts.slice(0, 8).map(function (e) { return '• ' + e.path; }).join('\n') + (conflicts.length > 8 ? '\n• …' : ''), buttons: [{ label: 'Cancel', value: null }, { label: 'Skip existing', value: 'skip' }, { label: 'Keep both', value: 'both' }, { label: 'Overwrite', value: 'over', cls: 'danger' }] }) : Promise.resolve('over');
    return step.then(function (choice) {
      if (!choice) return 0;
      var snap = App.snapshotFiles(conflicts.map(function (e) { return e.path; })), added = [], isFirst = null;
      entries.forEach(function (e) {
        var path = e.path, existing = state.files[path];
        if (existing && existing.content === e.content && !!existing.binary === !!e.binary) return;
        if (existing) { if (choice === 'skip') return; if (choice === 'both') path = App.uniquePath(path); }
        var d = App.parentDir(path), blocked = false;
        while (d) { if (state.files[d]) { blocked = true; break; } d = App.parentDir(d); }
        if (blocked || App.allFolders().has(path) && !state.files[path]) return;
        state.files[path] = { content: e.content, binary: !!e.binary, mime: e.mime || '' };
        App.disposeEditor(path); added.push(path); App.expandTo(path);
        if (!isFirst) isFirst = path;
      });
      if (!added.length) { App.toast('No new files were added' + (same ? ' (' + same + ' identical).' : '.'), { kind: 'warn' }); return 0; }
      if (!state.activeTab || state.openTabs.length === 0) { state.openTabs = [isFirst]; state.activeTab = isFirst; }
      else if (state.activeTab && added.indexOf(state.activeTab) !== -1) { App.disposeEditor(state.activeTab); }
      App.afterStructureChange(); App.scheduleSave();
      var msg = (label || 'Added') + ' ' + added.length + ' file(s)' + (same ? ' — ' + same + ' identical skipped' : '');
      if (conflicts.length && choice === 'over') App.offerUndo(msg, function () { App.restoreSnapshot(snap); }); else App.toast(msg, { kind: 'ok' });
      return added.length;
    });
  }

  function looksText(bytes) {
    var n = Math.min(bytes.length, 8000);
    for (var i = 0; i < n; i++) if (bytes[i] === 0) return false;
    try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); return true; } catch (e) { return false; }
  }
  function entryFromBytes(path, bytes) {
    var p = App.sanitizePath(path); if (!p) return null;
    if (!L.isBinaryPath(p) && looksText(bytes)) {
      if (bytes.length > MAX_TEXT) return { skipped: p + ' (text file over ' + (MAX_TEXT / 1048576) + ' MB)' };
      return { path: p, content: new TextDecoder('utf-8').decode(bytes), binary: false, mime: '' };
    }
    if (bytes.length > MAX_BIN) return { skipped: p + ' (binary over ' + (MAX_BIN / 1048576) + ' MB)' };
    return { path: p, content: S.bytesToB64(bytes), binary: true, mime: L.mimeOf(p) };
  }

  function ingestFiles(list, destFolder) {
    var jobs = [], skipped = [];
    Array.prototype.forEach.call(list, function (item) {
      var file = item.file || item, rel = item.rel || file.webkitRelativePath || file.name;
      jobs.push(file.arrayBuffer().then(function (buf) {
        var bytes = new Uint8Array(buf), dest = (destFolder ? destFolder + '/' : '') + rel;
        if (/\.zip$/i.test(file.name) && !item.noZip) return { zip: bytes, name: file.name };
        var en = entryFromBytes(dest, bytes);
        if (en && en.skipped) { skipped.push(en.skipped); return null; }
        return en;
      }, function () { skipped.push(rel + ' (unreadable)'); return null; }));
    });
    return Promise.all(jobs).then(function (results) {
      var entries = [], zips = [];
      results.forEach(function (r) { if (!r) return; if (r.zip) zips.push(r); else entries.push(r); });
      var chain = Promise.resolve();
      zips.forEach(function (z) {
        chain = chain.then(function () {
          return App.dialog({ title: 'ZIP archive', msg: '"' + z.name + '" is a ZIP file.\nExtract its contents into the workspace, or keep it as a single file?', buttons: [{ label: 'Cancel', value: null }, { label: 'Keep as file', value: 'file' }, { label: 'Extract', value: 'extract', cls: 'primary' }] }).then(function (ch) {
            if (ch === 'file') { var en = entryFromBytes((destFolder ? destFolder + '/' : '') + z.name, z.bytes); if (en && !en.skipped) entries.push(en); }
            else if (ch === 'extract') {
              return Z.readZip(z.bytes.buffer.slice(z.bytes.byteOffset, z.bytes.byteOffset + z.bytes.byteLength)).then(function (res) {
                res.skipped.forEach(function (s) { skipped.push(s); });
                var files = res.entries.filter(function (e) { return !e.dir; }), prefix = commonRoot(files.map(function (f) { return f.path; }));
                files.forEach(function (f) { var rel = prefix ? f.path.slice(prefix.length) : f.path, en = entryFromBytes((destFolder ? destFolder + '/' : '') + rel, f.bytes); if (en && en.skipped) skipped.push(en.skipped); else if (en) entries.push(en); });
                res.entries.filter(function (e) { return e.dir; }).forEach(function (d) { var rel = prefix && d.path.indexOf(prefix) === 0 ? d.path.slice(prefix.length) : d.path; rel = App.sanitizePath(rel); if (rel) state.folders.add(App.sanitizePath((destFolder ? destFolder + '/' : '') + rel)); });
              }, function (err) { App.toast('ZIP import failed: ' + err.message, { kind: 'error', ttl: 7000 }); });
            }
          });
        });
      });
      return chain.then(function () { return addFiles(entries, 'Imported'); }).then(function (n) {
        if (skipped.length) App.toast('Skipped ' + skipped.length + ': ' + skipped.slice(0, 3).join('; ') + (skipped.length > 3 ? '…' : ''), { kind: 'warn', ttl: 7000 });
        return n;
      });
    });
  }
  function commonRoot(paths) {
    if (!paths.length) return '';
    var first = paths[0].split('/'); if (first.length < 2) return '';
    var root = first[0];
    for (var i = 1; i < paths.length; i++) if (paths[i].split('/')[0] !== root || paths[i].split('/').length < 2) return '';
    return root + '/';
  }

  function collectDropped(dt, destFolder) {
    var items = dt.items ? Array.prototype.slice.call(dt.items) : [], entries = [];
    function walk(entry, prefix) {
      return new Promise(function (resolve) {
        if (entry.isFile) entry.file(function (f) { entries.push({ file: f, rel: prefix + f.name }); resolve(); }, function () { resolve(); });
        else if (entry.isDirectory) {
          var reader = entry.createReader(), all = [];
          (function read() { reader.readEntries(function (batch) { if (!batch.length) { Promise.all(all.map(function (c) { return walk(c, prefix + entry.name + '/'); })).then(resolve); } else { all = all.concat(Array.prototype.slice.call(batch)); read(); } }, function () { resolve(); }); })();
        } else resolve();
      });
    }
    var roots = items.map(function (it) { return it.webkitGetAsEntry ? it.webkitGetAsEntry() : null; }).filter(Boolean);
    var p = roots.length ? Promise.all(roots.map(function (r) { return walk(r, ''); })) : Promise.resolve(Array.prototype.forEach.call(dt.files, function (f) { entries.push({ file: f, rel: f.name }); }));
    p.then(function () { if (entries.length) ingestFiles(entries, destFolder); });
  }

  /* ---------- text import ---------- */
  function parseImportText(text) {
    var out = [], re = /^[ \t]*(```|~~~)([\w+#.-]*)[^\n]*\n([\s\S]*?)^[ \t]*\1[ \t]*$/gm, m, idx = 0;
    while ((m = re.exec(text)) !== null) {
      var lang = (m[2] || '').toLowerCase(), content = m[3].replace(/\r\n/g, '\n').replace(/\n$/, '');
      if (!content.trim()) continue;
      var before = text.slice(0, m.index).split('\n'), name = null, k = before.length - 1;
      while (k >= 0 && !before[k].trim()) k--;
      if (k >= 0) {
        var hm = /`([^`\s]+\.[A-Za-z0-9]{1,10})`/.exec(before[k]) || /^\s*(?:#{1,6}\s*)?(?:\d+[.)]\s*)?(?:\*\*)?(?:file(?:name)?\s*:\s*)?([\w@.\/-]+\.[A-Za-z0-9]{1,10})(?:\*\*)?\s*:?\s*$/i.exec(before[k]);
        if (hm) name = hm[1];
      }
      if (!name) {
        var first = content.split('\n')[0], cm = /^\s*(?:\/\/|#|--|;|\/\*+|<!--)\s*(?:file(?:name)?\s*:\s*)?([\w@.\/-]+\.[A-Za-z0-9]{1,10})\b/i.exec(first);
        if (cm) name = cm[1];
      }
      if (!name) {
        var def = { html: 'index.html', css: 'style.css', js: 'script.js', javascript: 'script.js', ts: 'main.ts', python: 'main.py', py: 'main.py', json: 'data.json', md: 'README.md', yaml: 'config.yml', yml: 'config.yml', sh: 'run.sh', bash: 'run.sh' };
        name = def[lang] || ('file' + (idx + 1) + '.' + (lang || 'txt'));
      }
      name = App.sanitizePath(name); if (!name) continue;
      idx++; out.push({ path: name, content: content + '\n', binary: false, mime: '' });
    }
    var seen = {};
    out.forEach(function (e) { if (seen[e.path]) { var dot = e.path.lastIndexOf('.'); e.path = (dot > -1 ? e.path.slice(0, dot) : e.path) + '_' + (++seen[e.path]) + (dot > -1 ? e.path.slice(dot) : ''); } else seen[e.path] = 1; });
    return out;
  }
  function importFromText() {
    var text = $('importTextarea').value;
    if (!text.trim()) { App.toast('Paste some text first.', { kind: 'warn' }); return; }
    var entries = parseImportText(text);
    if (!entries.length) { App.toast('No fenced code blocks found.', { kind: 'warn' }); return; }
    $('importModal').classList.add('hidden');
    addFiles(entries, 'Imported').then(function (n) { if (n) $('importTextarea').value = ''; });
  }

  /* ---------- export ---------- */
  function triggerDownload(blob, name) {
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }
  function flushEditors() {
    Object.keys(state.editors).forEach(function (p) { if (state.files[p]) state.files[p].content = state.editors[p].ta.value; });
  }
  function downloadZip() {
    flushEditors();
    var paths = Object.keys(state.files);
    if (!paths.length && !state.folders.size) { App.toast('Workspace is empty.', { kind: 'warn' }); return; }
    var entries = paths.map(function (p) { return { path: p, bytes: S.fileBytes(state.files[p]) }; });
    var withFiles = {}; paths.forEach(function (p) { var d = App.parentDir(p); while (d) { withFiles[d] = true; d = App.parentDir(d); } });
    state.folders.forEach(function (f) { if (!withFiles[f]) entries.push({ path: f, dir: true }); });
    var d = new Date(), stamp = d.getFullYear() + '' + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2);
    triggerDownload(Z.createZip(entries), 'dscode-workspace-' + stamp + '.zip');
    App.toast('ZIP created with ' + paths.length + ' file(s).', { kind: 'ok' });
  }
  function downloadFile(path) {
    var ed = state.editors[path]; if (ed) state.files[path].content = ed.ta.value;
    var f = state.files[path]; if (!f) return;
    triggerDownload(new Blob([S.fileBytes(f)], { type: f.mime || L.mimeOf(path) }), App.baseName(path));
  }

  Object.assign(App, { openFile: openFile, switchTab: switchTab, closeTab: closeTab, renderTabs: renderTabs, renderTree: renderTree, newFile: newFile, newFolder: newFolder, deletePath: deletePath,
    renamePath: renamePath, movePath: movePath, duplicate: duplicate, addFiles: addFiles, ingestFiles: ingestFiles, collectDropped: collectDropped, handleDrop: handleDrop, hasFiles: hasFiles,
    parseImportText: parseImportText, importFromText: importFromText, downloadZip: downloadZip, downloadFile: downloadFile, showCtx: showCtx, hideCtx: hideCtx, flushEditors: flushEditors, triggerDownload: triggerDownload, iconOf: iconOf });
})();
