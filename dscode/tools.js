(function () {
  'use strict';
  var App = window.DSApp, L = window.DSLang, P = window.DSPreview, S = window.DSStore, Lint = window.DSLint, A = window.DSAssist;
  var state = App.state, $ = function (id) { return document.getElementById(id); }, el = App.el;

  /* ---------- find / replace (current file) ---------- */
  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&'); }
  function buildRegex(q, o) {
    if (!q) return null;
    var src = o.regex ? q : escRe(q);
    if (o.word) src = '\\b(?:' + src + ')\\b';
    try { return new RegExp(src, 'g' + (o.caseS ? '' : 'i') + 'm'); } catch (e) { return undefined; }
  }
  function recomputeFind(keepIdx) {
    var ed = App.activeEditor(), f = state.find, q = $('findInput').value, rx = buildRegex(q, f);
    f.matches = []; var count = $('findCount');
    if (!ed || !q) { f.idx = -1; count.textContent = '0'; App.renderDecor(ed); return; }
    if (rx === undefined) { count.textContent = 'invalid'; f.idx = -1; App.renderDecor(ed); return; }
    var v = ed.ta.value, m;
    while ((m = rx.exec(v)) !== null && f.matches.length < 10000) {
      f.matches.push({ s: m.index, e: m.index + m[0].length });
      if (m[0].length === 0) rx.lastIndex++;
    }
    if (!keepIdx || f.idx >= f.matches.length) {
      var pos = ed.ta.selectionStart, i = 0;
      while (i < f.matches.length && f.matches[i].s < pos) i++;
      f.idx = f.matches.length ? (i < f.matches.length ? i : 0) : -1;
    }
    count.textContent = f.matches.length ? (f.idx + 1) + ' of ' + f.matches.length : 'No results';
    App.renderDecor(ed);
  }
  function gotoMatch(step) {
    var ed = App.activeEditor(), f = state.find; if (!ed) return;
    if (!f.matches.length) { recomputeFind(false); if (!f.matches.length) return; }
    else f.idx = (f.idx + step + f.matches.length) % f.matches.length;
    var m = f.matches[f.idx], lc = App.posToLineCol(ed.ta.value, m.s);
    ed.ta.setSelectionRange(m.s, m.e);
    App.revealLine(ed, lc.line + 1, lc.col);
    $('findCount').textContent = (f.idx + 1) + ' of ' + f.matches.length; App.renderDecor(ed);
  }
  function openFind(withReplace) {
    var ed = App.activeEditor(); if (!ed) return;
    var bar = $('findBar'), f = state.find; f.open = true; bar.classList.remove('hidden');
    var sel = ed.ta.value.slice(ed.ta.selectionStart, ed.ta.selectionEnd);
    if (sel && sel.indexOf('\n') === -1) $('findInput').value = sel;
    $('replaceInput').style.display = withReplace ? '' : 'none'; $('replaceOne').style.display = withReplace ? '' : 'none'; $('replaceAll').style.display = withReplace ? '' : 'none';
    recomputeFind(false);
    var target = withReplace && $('findInput').value ? $('replaceInput') : $('findInput'); target.focus(); if (target === $('findInput')) target.select();
  }
  function closeFind() {
    state.find.open = false; state.find.matches = []; $('findBar').classList.add('hidden');
    var ed = App.activeEditor(); if (ed) { App.renderDecor(ed); ed.ta.focus(); }
  }
  function replaceCurrent() {
    var ed = App.activeEditor(), f = state.find; if (!ed || f.idx < 0 || !f.matches.length) { gotoMatch(0); return; }
    var m = f.matches[f.idx], rep = $('replaceInput').value, rx = buildRegex($('findInput').value, f), text = ed.ta.value.slice(m.s, m.e);
    var out = f.regex && rx ? text.replace(new RegExp(rx.source, rx.flags.replace('g', '')), rep) : rep;
    App.applyEdit(ed, m.s, m.e, out); recomputeFind(true); gotoMatch(0); $('replaceInput').focus();
  }
  function replaceAllInFile() {
    var ed = App.activeEditor(), f = state.find, rx = buildRegex($('findInput').value, f); if (!ed || !rx) return;
    var rep = $('replaceInput').value, v = ed.ta.value, n = 0;
    var out = v.replace(rx, function () { n++; if (!f.regex) return rep; var a = arguments, groups = Array.prototype.slice.call(a, 1, -2); return rep.replace(/\$(\d+|&)/g, function (mm, g) { return g === '&' ? a[0] : (groups[parseInt(g, 10) - 1] || ''); }); });
    if (!n) { App.toast('No matches.', { kind: 'warn' }); return; }
    App.applyEdit(ed, 0, v.length, out, 0); recomputeFind(false); App.toast('Replaced ' + n + ' occurrence(s). Ctrl+Z undoes it.', { kind: 'ok' });
  }

  /* ---------- go to line ---------- */
  function goToLine() {
    var ed = App.activeEditor(); if (!ed) return;
    App.askText('Go to line', 'Line number (or line:column):', '').then(function (v) {
      if (!v) return; var m = /^(\d+)(?::(\d+))?$/.exec(String(v).trim()); if (!m) { App.toast('Enter a number like 42 or 42:7', { kind: 'warn' }); return; }
      App.jumpToLine(parseInt(m[1], 10), m[2] ? parseInt(m[2], 10) - 1 : undefined, 0);
    });
  }

  /* ---------- search across files ---------- */
  function runGlobalSearch() {
    var q = $('gsQuery').value, res = $('gsResults'), sum = $('gsSummary'); res.innerHTML = '';
    if (!q) { sum.textContent = ''; return; }
    var rx = buildRegex(q, { regex: $('gsRegex').checked, caseS: $('gsCase').checked, word: false });
    if (rx === undefined) { sum.textContent = 'Invalid regular expression.'; return; }
    App.flushEditors();
    var hits = 0, files = 0, capped = false;
    Object.keys(state.files).sort().forEach(function (p) {
      var f = state.files[p]; if (f.binary || capped) return;
      var lines = f.content.split('\n'), fileHits = [];
      for (var i = 0; i < lines.length && !capped; i++) {
        rx.lastIndex = 0; var m;
        while ((m = rx.exec(lines[i])) !== null) {
          fileHits.push({ line: i + 1, col: m.index, len: m[0].length, text: lines[i] });
          if (m[0].length === 0) rx.lastIndex++;
          if (++hits >= 1000) { capped = true; break; }
        }
      }
      if (!fileHits.length) return;
      files++;
      var head = el('div', 'gs-file', p + ' (' + fileHits.length + ')'); head.addEventListener('click', function () { App.openFile(p); }); res.appendChild(head);
      fileHits.slice(0, 200).forEach(function (h) {
        var row = el('div', 'gs-hit'), t = h.text.trim().length > 140 ? h.text.slice(Math.max(0, h.col - 40), h.col + 100) : h.text.replace(/^\s+/, ''), off = h.text.length - h.text.replace(/^\s+/, '').length;
        var cut = h.text.trim().length > 140 ? Math.max(0, h.col - 40) : off, start = h.col - cut;
        row.innerHTML = App.esc(t.slice(0, Math.max(0, start))) + '<mark>' + App.esc(t.slice(Math.max(0, start), start + h.len)) + '</mark>' + App.esc(t.slice(start + h.len));
        row.addEventListener('click', function () { App.openFile(p); setTimeout(function () { App.jumpToLine(h.line, h.col, h.len); }, 30); });
        res.appendChild(row);
      });
    });
    sum.textContent = hits ? hits + (capped ? '+' : '') + ' result(s) in ' + files + ' file(s)' : 'No results.';
  }
  function replaceInFiles() {
    var q = $('gsQuery').value, rep = $('gsReplace').value; if (!q) return;
    var useRx = $('gsRegex').checked, rx = buildRegex(q, { regex: useRx, caseS: $('gsCase').checked, word: false });
    if (!rx) { App.toast('Invalid search expression.', { kind: 'error' }); return; }
    App.flushEditors();
    var plan = [], total = 0;
    Object.keys(state.files).forEach(function (p) {
      var f = state.files[p]; if (f.binary) return; var n = 0;
      var out = f.content.replace(rx, function () { n++; if (!useRx) return rep; var a = arguments, groups = Array.prototype.slice.call(a, 1, -2); return rep.replace(/\$(\d+|&)/g, function (mm, g) { return g === '&' ? a[0] : (groups[parseInt(g, 10) - 1] || ''); }); });
      if (n) { plan.push({ p: p, out: out, n: n }); total += n; }
    });
    if (!total) { App.toast('Nothing to replace.', { kind: 'warn' }); return; }
    App.askConfirm('Replace ' + total + ' occurrence(s) in ' + plan.length + ' file(s)?\n\nYou can undo right after.', 'Replace all', true).then(function (ok) {
      if (!ok) return;
      var snap = App.snapshotFiles(plan.map(function (x) { return x.p; }));
      plan.forEach(function (x) { state.files[x.p].content = x.out; App.disposeEditor(x.p); });
      App.afterStructureChange(); App.scheduleSave(); runGlobalSearch();
      App.offerUndo('Replaced ' + total + ' occurrence(s) in ' + plan.length + ' file(s)', function () { App.restoreSnapshot(snap); });
    });
  }
  function showSideView(name) {
    document.querySelectorAll('.side-tab').forEach(function (t) { t.classList.toggle('active', t.dataset.view === name); });
    $('viewExplorer').classList.toggle('hidden', name !== 'explorer'); $('viewSearch').classList.toggle('hidden', name !== 'search');
    $('sidebar').classList.remove('hidden');
    if (name === 'search') { var ed = App.activeEditor(); if (ed) { var sel = ed.ta.value.slice(ed.ta.selectionStart, ed.ta.selectionEnd); if (sel && sel.indexOf('\n') === -1) $('gsQuery').value = sel; } $('gsQuery').focus(); $('gsQuery').select(); }
  }

  /* ---------- palette ---------- */
  var pal = { mode: 'files', items: [], idx: 0, open: false };
  function fuzzy(query, text) {
    if (!query) return { score: 0, idx: [] };
    var q = query.toLowerCase(), t = text.toLowerCase(), qi = 0, score = 0, last = -2, idx = [], base = t.lastIndexOf('/') + 1;
    for (var i = 0; i < t.length && qi < q.length; i++) {
      if (t.charAt(i) === q.charAt(qi)) { score += 1 + (i === last + 1 ? 3 : 0) + (i === 0 || /[\/._-]/.test(t.charAt(i - 1)) ? 4 : 0) + (i >= base ? 2 : 0); last = i; idx.push(i); qi++; }
    }
    return qi === q.length ? { score: score - text.length * 0.01, idx: idx } : null;
  }
  function highlightIdx(text, idx) {
    var out = '', set = {}; idx.forEach(function (i) { set[i] = true; });
    for (var i = 0; i < text.length; i++) out += set[i] ? '<span class="match">' + App.esc(text.charAt(i)) + '</span>' : App.esc(text.charAt(i));
    return out;
  }
  function commandsList() {
    var C = [], add = function (name, hint, run) { C.push({ name: name, hint: hint, run: run }); };
    add('New File', 'Ctrl+Alt+N', function () { App.newFile(); }); add('New Folder', '', function () { App.newFolder(); });
    add('Upload Files or ZIP…', '', function () { $('fileInput').click(); }); add('Upload Folder…', '', function () { $('dirInput').click(); });
    add('Import from Pasted Text…', '', function () { $('importModal').classList.remove('hidden'); $('importTextarea').focus(); });
    add('Download Workspace as ZIP', '', App.downloadZip);
    add('Run Preview', 'Ctrl+Enter', function () { runPreview(); }); add('Toggle Preview', '', togglePreview);
    add('Export Preview as Single HTML File', '', exportSingleHtml); add('Clear Preview Storage (localStorage of previewed page)', '', function () { state.previewStorage = {}; App.scheduleSave(); App.toast('Preview storage cleared.', { kind: 'ok' }); });
    add('Toggle Sidebar', 'Ctrl+B', function () { $('sidebar').classList.toggle('hidden'); });
    add('Toggle Problems / Console Panel', 'Ctrl+`', togglePanel);
    add('Find in File', 'Ctrl+F', function () { openFind(false); }); add('Replace in File', 'Ctrl+H', function () { openFind(true); });
    add('Search in All Files', 'Ctrl+Shift+F', function () { showSideView('search'); });
    add('Go to Line…', 'Ctrl+G', goToLine);
    add('Format Document (JSON / whitespace cleanup)', 'Ctrl+Alt+F', formatDocument);
    add('Trim Trailing Whitespace', '', trimWhitespace);
    add('Lint All Files', '', App.lintAll);
    add('Close Current Tab', '', function () { if (state.activeTab) App.closeTab(state.activeTab); });
    add('Close All Tabs', '', function () { state.openTabs.slice().forEach(function (p) { App.disposeEditor(p); }); state.openTabs = []; state.activeTab = null; App.renderTabs(); App.renderTree(); App.syncEditor(); App.scheduleSave(); });
    add('Rename Current File…', '', function () { if (state.activeTab) App.renamePath(state.activeTab, false); });
    add('Duplicate Current File', '', function () { if (state.activeTab) App.duplicate(state.activeTab); });
    add('Delete Current File', '', function () { if (state.activeTab) App.deletePath(state.activeTab, false); });
    add('Download Current File', '', function () { if (state.activeTab) App.downloadFile(state.activeTab); });
    add('Increase Font Size', '', function () { setFont(1); }); add('Decrease Font Size', '', function () { setFont(-1); }); add('Reset Font Size', '', function () { state.settings.fontSize = 13; App.applyFontSettings(); App.scheduleSave(); });
    add('Indent with 2 Spaces', '', function () { setTabSize(2); }); add('Indent with 4 Spaces', '', function () { setTabSize(4); });
    add('Toggle Live Preview', '', function () { $('previewLive').checked = !$('previewLive').checked; state.settings.live = $('previewLive').checked; App.scheduleSave(); });
    add('Open Git Terminal', '', function () { window.open('../terminal/index.html', '_blank', 'noopener'); });
    add('Reset Workspace (delete everything)', '', resetWorkspace);
    return C;
  }
  function setFont(d) { state.settings.fontSize = Math.min(24, Math.max(10, (state.settings.fontSize || 13) + d)); App.applyFontSettings(); App.scheduleSave(); }
  function setTabSize(n) { state.settings.tabSize = n; App.applyFontSettings(); App.scheduleSave(); }
  function resetWorkspace() {
    App.askConfirm('Delete ALL files and folders in this workspace? A ZIP download first is recommended.', 'Delete everything', true).then(function (ok) {
      if (!ok) return;
      var snap = App.snapshotFiles(Object.keys(state.files)), foldersBefore = Array.from(state.folders);
      Object.keys(state.editors).forEach(App.disposeEditor);
      state.files = {}; state.folders = new Set(); state.expanded = new Set(['']); state.openTabs = []; state.activeTab = null;
      App.afterStructureChange(); App.scheduleSave();
      App.offerUndo('Workspace cleared', function () { foldersBefore.forEach(function (f) { state.folders.add(f); }); App.restoreSnapshot(snap); });
    });
  }
  function formatDocument() {
    var ed = App.activeEditor(); if (!ed) return; var lang = L.langOf(ed.path), v = ed.ta.value;
    if (lang === 'json') { var r = A.formatJSON(v); if (r.error) { App.toast('Cannot format: ' + r.error, { kind: 'error' }); return; } if (r.text !== v) App.applyEdit(ed, 0, v.length, r.text, 0); App.toast('Formatted JSON.', { kind: 'ok' }); return; }
    trimWhitespace(true);
  }
  function trimWhitespace(final) {
    var ed = App.activeEditor(); if (!ed) return; var v = ed.ta.value, out = v.replace(/[ \t]+$/gm, '').replace(/\s*$/, '\n');
    if (v === '') return;
    if (out !== v) App.applyEdit(ed, 0, v.length, out, Math.min(ed.ta.selectionStart, out.length)); App.toast('Trailing whitespace removed, single final newline.', { kind: 'ok' });
  }

  function openPalette(initial) {
    pal.open = true; $('paletteOverlay').classList.remove('hidden');
    var inp = $('paletteInput'); inp.value = initial || ''; renderPalette(); inp.focus();
  }
  function closePalette() { pal.open = false; $('paletteOverlay').classList.add('hidden'); var ed = App.activeEditor(); if (ed) ed.ta.focus(); }
  function renderPalette() {
    var raw = $('paletteInput').value, list = $('paletteList'); list.innerHTML = ''; pal.items = [];
    if (raw.charAt(0) === '>') {
      pal.mode = 'cmd'; var q = raw.slice(1).trim();
      commandsList().forEach(function (c) { var m = fuzzy(q, c.name); if (m) pal.items.push({ label: c.name, hint: c.hint, idx: m.idx, score: m.score, run: c.run }); });
    } else if (raw.charAt(0) === ':') {
      pal.mode = 'line'; var n = parseInt(raw.slice(1), 10);
      pal.items.push({ label: isNaN(n) ? 'Type a line number' : 'Go to line ' + n, hint: '', idx: [], score: 0, run: function () { if (!isNaN(n)) App.jumpToLine(n); } });
    } else {
      pal.mode = 'files'; var order = state.openTabs;
      Object.keys(state.files).forEach(function (p) { var m = fuzzy(raw.trim(), p); if (m) pal.items.push({ label: p, hint: order.indexOf(p) !== -1 ? 'open' : '', idx: m.idx, score: m.score + (order.indexOf(p) !== -1 ? 0.5 : 0), run: function () { App.openFile(p); } }); });
    }
    pal.items.sort(function (a, b) { return b.score - a.score; }); pal.items = pal.items.slice(0, 60); pal.idx = 0;
    if (!pal.items.length) list.appendChild(el('div', 'pal-item', 'No matches'));
    pal.items.forEach(function (it, i) {
      var row = el('div', 'pal-item' + (i === 0 ? ' selected' : '')), name = el('span'); name.innerHTML = highlightIdx(it.label, it.idx);
      row.appendChild(name); row.appendChild(el('span', 'hint', it.hint));
      row.addEventListener('mousedown', function (e) { e.preventDefault(); pal.idx = i; choosePalette(); });
      list.appendChild(row);
    });
  }
  function choosePalette() { var it = pal.items[pal.idx]; if (!it) return; closePalette(); setTimeout(it.run, 0); }
  function movePalette(d) {
    if (!pal.items.length) return; pal.idx = (pal.idx + d + pal.items.length) % pal.items.length;
    var rows = $('paletteList').children; for (var i = 0; i < rows.length; i++) rows[i].classList.toggle('selected', i === pal.idx);
    if (rows[pal.idx]) rows[pal.idx].scrollIntoView({ block: 'nearest' });
  }

  /* ---------- panels ---------- */
  function togglePanel() { var p = $('bottomPanels'); if (p.classList.contains('hidden')) App.showPanel(document.querySelector('.panel-tab.active').dataset.panel); else p.classList.add('hidden'); }

  /* ---------- preview ---------- */
  var liveTimer = null, evalWaiters = {};
  function consoleAdd(level, text, loc) {
    var line = el('div', 'con-line ' + level); line.appendChild(document.createTextNode(text));
    if (loc) { var a = el('span', 'loc', loc.path + ':' + loc.line); a.addEventListener('click', function () { if (state.files[loc.path]) { App.openFile(loc.path); setTimeout(function () { App.jumpToLine(loc.line); }, 30); } }); line.appendChild(a); }
    var list = $('consoleList'); list.appendChild(line); list.scrollTop = list.scrollHeight;
    if (level !== 'input' && level !== 'result') { state.consoleCount++; $('consoleCount').textContent = state.consoleCount; }
    while (list.children.length > 500) list.removeChild(list.firstChild);
  }
  function clearConsole() { $('consoleList').innerHTML = ''; state.consoleCount = 0; $('consoleCount').textContent = '0'; }

  function renderPreview(entry, pushHistory) {
    App.flushEditors();
    var res;
    try { res = P.build(state.files, entry, { storage: state.previewStorage }); } catch (err) { consoleAdd('error', 'Preview failed: ' + err.message); App.showPanel('console'); return; }
    if (pushHistory && state.previewEntry && state.previewEntry !== entry) state.previewHistory.push(state.previewEntry);
    state.previewEntry = entry; state.previewMap = res.sourceMap; state.errorShown = false;
    clearConsole();
    res.warnings.slice(0, 20).forEach(function (w) { consoleAdd('warn', w); });
    $('previewTitle').textContent = entry; $('btnPreviewBack').style.visibility = state.previewHistory.length ? 'visible' : 'hidden';
    $('previewFrame').srcdoc = res.html;
    if (res.warnings.length) App.showPanel('console');
  }
  function showPreviewPanel() { $('previewPanel').classList.remove('hidden'); $('previewSplit').classList.remove('hidden'); }
  function runPreview(path) {
    var entry = path;
    if (!entry) { var a = state.activeTab; entry = a && /\.html?$/i.test(a) && state.files[a] ? a : P.pickEntry(state.files, null); }
    if (!entry) { App.toast('No HTML file in the workspace to preview.', { kind: 'warn' }); return; }
    state.previewHistory = []; showPreviewPanel(); renderPreview(entry, false);
  }
  function togglePreview() {
    var pnl = $('previewPanel'); if (pnl.classList.contains('hidden')) runPreview(); else { pnl.classList.add('hidden'); $('previewSplit').classList.add('hidden'); }
  }
  function onContentChanged(ed) {
    if (state.find.open && ed.path === state.activeTab) recomputeFind(true);
    if ($('previewPanel').classList.contains('hidden') || !$('previewLive').checked || !state.previewEntry) return;
    clearTimeout(liveTimer); liveTimer = setTimeout(function () { if (state.files[state.previewEntry]) renderPreview(state.previewEntry, false); }, 800);
  }
  function exportSingleHtml() {
    var entry = state.previewEntry || P.pickEntry(state.files, null); if (!entry) { App.toast('No HTML file found.', { kind: 'warn' }); return; }
    App.flushEditors();
    try {
      var res = P.build(state.files, entry, { storage: {}, noBridge: true }), html = res.html;
      App.triggerDownload(new Blob([html], { type: 'text/html' }), 'bundle.html'); App.toast('Standalone bundle.html created (CSS, JS and images inlined).', { kind: 'ok' });
    } catch (e) { App.toast('Export failed: ' + e.message, { kind: 'error' }); }
  }
  window.addEventListener('message', function (ev) {
    var frame = $('previewFrame'); if (!frame || ev.source !== frame.contentWindow) return;
    var m = ev.data; if (!m || m.__ds !== 1) return;
    if (m.type === 'console') consoleAdd(m.level === 'debug' ? 'info' : m.level, String(m.text).slice(0, 6000));
    else if (m.type === 'clear') clearConsole();
    else if (m.type === 'error') {
      var loc = m.line ? P.mapLine(state.previewMap, m.line, state.previewEntry) : null;
      consoleAdd('error', String(m.message).slice(0, 2000), loc);
      if (!state.errorShown) { state.errorShown = true; App.showPanel('console'); }
    } else if (m.type === 'nav') { if (state.files[m.path]) renderPreview(m.path, true); else consoleAdd('warn', 'Preview link target not found in workspace: ' + m.path); }
    else if (m.type === 'ls') {
      if (m.op === 'set') state.previewStorage[m.key] = m.val; else if (m.op === 'del') delete state.previewStorage[m.key]; else if (m.op === 'clear') state.previewStorage = {};
      App.scheduleSave();
    } else if (m.type === 'evalresult') consoleAdd(m.ok ? 'result' : 'error', (m.ok ? '← ' : '✖ ') + String(m.value).slice(0, 4000));
  });
  function evalInPreview(code) {
    var frame = $('previewFrame');
    if (!frame.contentWindow || $('previewPanel').classList.contains('hidden')) { consoleAdd('warn', 'Run the preview first (Ctrl+Enter).'); return; }
    consoleAdd('input', '› ' + code);
    frame.contentWindow.postMessage({ __ds: 1, type: 'eval', id: ++state.evalId, code: code }, '*');
  }

  /* ---------- git status badges ---------- */
  var gitTimer = null;
  function scheduleGit() { clearTimeout(gitTimer); gitTimer = setTimeout(computeGit, 900); }
  function computeGit() {
    var gs = $('statusGit');
    if (!state.sync || !state.sync.files) { state.gitStatus = {}; state.gitDirtyFolders = {}; gs.textContent = '⎇ not synced'; gs.title = 'Open the Git Terminal to connect a repository'; App.renderTree(); return Promise.resolve(); }
    var base = state.sync.files, paths = Object.keys(state.files), jobs = [];
    paths.forEach(function (p) {
      var f = state.files[p], c = state.gitCache[p];
      if (c && c.content === f.content && c.binary === !!f.binary) return;
      jobs.push(S.gitBlobSha(S.fileBytes(f)).then(function (sha) { state.gitCache[p] = { content: f.content, binary: !!f.binary, sha: sha }; }));
    });
    return Promise.all(jobs).then(function () {
      var status = {}, dirtyF = {}, changed = 0, deleted = 0;
      paths.forEach(function (p) {
        var sha = state.gitCache[p] && state.gitCache[p].sha;
        if (!(p in base)) status[p] = 'A'; else if (base[p] !== sha) status[p] = 'M';
        if (status[p]) { changed++; var d = App.parentDir(p); while (d) { dirtyF[d] = true; d = App.parentDir(d); } }
      });
      Object.keys(base).forEach(function (p) { if (!state.files[p]) deleted++; });
      state.gitStatus = status; state.gitDirtyFolders = dirtyF; state.gitDeleted = deleted;
      gs.textContent = '⎇ ' + (state.sync.branch || '?') + (changed || deleted ? '  ●' + changed + (deleted ? ' −' + deleted : '') : '  ✓ clean');
      gs.title = state.sync.repo + ' @ ' + (state.sync.commit || '').slice(0, 7) + ' — ' + changed + ' changed, ' + deleted + ' deleted since last sync';
      App.renderTree();
    });
  }

  Object.assign(App, { openFind: openFind, closeFind: closeFind, recomputeFind: recomputeFind, gotoMatch: gotoMatch, replaceCurrent: replaceCurrent, replaceAllInFile: replaceAllInFile, goToLine: goToLine,
    runGlobalSearch: runGlobalSearch, replaceInFiles: replaceInFiles, showSideView: showSideView, openPalette: openPalette, closePalette: closePalette, renderPalette: renderPalette, choosePalette: choosePalette,
    movePalette: movePalette, togglePanel: togglePanel, runPreview: runPreview, togglePreview: togglePreview, renderPreview: renderPreview, onContentChanged: onContentChanged, exportSingleHtml: exportSingleHtml,
    evalInPreview: evalInPreview, clearConsole: clearConsole, scheduleGit: scheduleGit, computeGit: computeGit, formatDocument: formatDocument, setTabSize: setTabSize, resetWorkspace: resetWorkspace,
    showPreviewPanel: showPreviewPanel, isPaletteOpen: function () { return pal.open; } });
})();
