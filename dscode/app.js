(function () {
  'use strict';
  var L = window.DSLang, Lint = window.DSLint, A = window.DSAssist, Z = window.DSZip, P = window.DSPreview, S = window.DSStore;
  var $ = function (id) { return document.getElementById(id); };

  var state = {
    files: {}, folders: new Set(), expanded: new Set(['']), openTabs: [], activeTab: null, settings: { fontSize: 13, tabSize: 2, live: true },
    previewStorage: {}, filter: '', editors: {}, sync: null, gitStatus: {}, gitDirtyFolders: {}, gitDeleted: 0, gitCache: {},
    problems: [], problemMode: 'file', consoleCount: 0, previewEntry: null, previewMap: [], previewHistory: [], deviceIdx: 0,
    find: { open: false, matches: [], idx: -1, caseS: false, word: false, regex: false }, undo: null, wordsCache: { at: 0, list: [] },
    ac: { items: [], index: 0, from: 0, open: false }, cw: 7.8, saveTimer: null, dirty: false, evalId: 0, errorShown: false
  };
  var PAD_L = 10, PAD_T = 12, BIG_FILE = 1500000, DEVICES = [{ w: '100%', label: 'Full' }, { w: '768px', label: 'Tablet' }, { w: '375px', label: 'Mobile' }];

  function esc(s) { return L.esc(s); }
  function X() { return window.DSApp; }
  function renderTree() { X().renderTree(); }
  function renderTabs() { X().renderTabs(); }
  function scheduleGit() { X().scheduleGit(); }
  function onInput(ed, ev) { X().onInput(ed, ev); }
  function onKeyDown(ed, ev) { X().onKeyDown(ed, ev); }
  function hideAC() { X().hideAC(); }
  function openFile(p, o) { X().openFile(p, o); }
  function downloadFile(p) { X().downloadFile(p); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function cssNum(n) { return Math.max(0, n) + 'px'; }

  function toast(msg, opts) {
    opts = opts || {};
    var t = el('div', 'toast ' + (opts.kind || '')), span = el('span', '', msg);
    t.appendChild(span);
    if (opts.action) {
      var b = el('button', '', opts.action.label);
      b.addEventListener('click', function () { try { opts.action.run(); } finally { t.remove(); } });
      t.appendChild(b);
    }
    $('toasts').appendChild(t);
    setTimeout(function () { if (t.parentNode) t.remove(); }, opts.ttl || (opts.action ? 9000 : 3500));
  }

  var dialogResolve = null;
  function dialog(o) {
    return new Promise(function (resolve) {
      if (dialogResolve) dialogResolve(null);
      var ov = $('dialogOverlay'), input = $('dialogInput'), foot = $('dialogFoot');
      $('dialogTitle').textContent = o.title || '';
      $('dialogMsg').textContent = o.msg || '';
      var hasInput = o.input !== undefined;
      input.classList.toggle('hidden', !hasInput);
      if (hasInput) input.value = o.input;
      foot.innerHTML = '';
      var buttons = o.buttons || [{ label: 'Cancel', value: null }, { label: 'OK', value: true, cls: 'primary' }];
      function done(v) { ov.classList.add('hidden'); dialogResolve = null; document.removeEventListener('keydown', onKey, true); resolve(v); }
      function primaryValue() {
        var p = buttons.filter(function (b) { return b.cls && /primary|danger/.test(b.cls); })[0] || buttons[buttons.length - 1];
        return hasInput ? input.value : p.value;
      }
      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); }
        else if (e.key === 'Enter' && (hasInput || document.activeElement.tagName !== 'BUTTON')) { e.preventDefault(); e.stopPropagation(); done(primaryValue()); }
      }
      buttons.forEach(function (b) {
        var btn = el('button', 'modal-btn ' + (b.cls || ''), b.label);
        btn.addEventListener('click', function () { done(hasInput && b.value === true ? input.value : b.value); });
        foot.appendChild(btn);
      });
      dialogResolve = done;
      $('dialogClose').onclick = function () { done(null); };
      document.addEventListener('keydown', onKey, true);
      ov.classList.remove('hidden');
      setTimeout(function () { if (hasInput) { input.focus(); input.select(); } else { var last = foot.lastChild; if (last) last.focus(); } }, 0);
    });
  }
  function askText(title, msg, def) { return dialog({ title: title, msg: msg, input: def || '' }); }
  function askConfirm(msg, okLabel, danger) { return dialog({ title: 'Confirm', msg: msg, buttons: [{ label: 'Cancel', value: false }, { label: okLabel || 'OK', value: true, cls: danger ? 'danger' : 'primary' }] }).then(function (v) { return v === true; }); }

  function sanitizePath(p) {
    if (!p) return '';
    p = String(p).replace(/\\/g, '/').trim().replace(/^\.\//, '').replace(/^\/+/, '');
    var out = [];
    p.split('/').forEach(function (s) { s = s.trim(); if (s && s !== '.' && s !== '..') out.push(s); });
    return out.join('/');
  }
  function parentDir(p) { var i = p.lastIndexOf('/'); return i === -1 ? '' : p.slice(0, i); }
  function baseName(p) { return p.split('/').pop(); }
  function uniquePath(path) {
    if (!state.files[path] && !state.folders.has(path)) return path;
    var dot = path.lastIndexOf('.'), slash = path.lastIndexOf('/'), base = dot > slash ? path.slice(0, dot) : path, ext = dot > slash ? path.slice(dot) : '', n = 1;
    while (state.files[base + ' copy' + (n > 1 ? ' ' + n : '') + ext]) n++;
    return base + ' copy' + (n > 1 ? ' ' + n : '') + ext;
  }
  function allFolders() {
    var set = new Set(state.folders);
    Object.keys(state.files).forEach(function (p) { var d = parentDir(p); while (d) { set.add(d); d = parentDir(d); } });
    return set;
  }
  function expandTo(path) { var d = parentDir(path); while (d) { state.expanded.add(d); d = parentDir(d); } }
  function fmtSize(n) { return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB'; }
  function fileByteLength(f) { return f.binary ? Math.floor(f.content.length * 3 / 4) : new Blob([f.content]).size; }

  function serialize() {
    return { files: state.files, folders: Array.from(state.folders), expanded: Array.from(state.expanded), openTabs: state.openTabs, activeTab: state.activeTab, settings: state.settings, previewStorage: state.previewStorage };
  }
  function setSaveStatus(kind, msg) {
    var s = $('statusSave');
    s.textContent = kind === 'ok' ? '● saved' : kind === 'pending' ? '○ saving…' : '⚠ ' + (msg || 'not saved');
    s.title = kind === 'fail' ? msg : 'Autosave state';
  }
  function scheduleSave() {
    state.dirty = true; setSaveStatus('pending');
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(flushSave, 250);
  }
  function flushSave() {
    clearTimeout(state.saveTimer); state.saveTimer = null;
    if (!state.dirty) return Promise.resolve();
    state.dirty = false;
    return S.saveWorkspace(serialize()).then(function () { if (!state.dirty) setSaveStatus('ok'); }, function (err) {
      state.dirty = true; setSaveStatus('fail', err.message);
      toast('Could not save workspace: ' + err.message + ' — download a ZIP backup now.', { kind: 'error', ttl: 8000 });
    });
  }

  function applyLoaded(ws) {
    state.files = ws.files; state.folders = new Set(ws.folders.map(sanitizePath).filter(Boolean)); state.expanded = new Set(ws.expanded.length ? ws.expanded : ['']);
    state.openTabs = ws.openTabs; state.activeTab = ws.activeTab; state.previewStorage = ws.previewStorage || {};
    state.settings = Object.assign({ fontSize: 13, tabSize: 2, live: true }, ws.settings || {});
  }

  var undoPayload = null;
  function offerUndo(label, restore) {
    undoPayload = restore;
    toast(label, { action: { label: 'Undo', run: function () { if (undoPayload) { undoPayload(); undoPayload = null; } } }, ttl: 9000 });
  }
  function snapshotFiles(paths) {
    var snap = {}; paths.forEach(function (p) { if (state.files[p]) snap[p] = JSON.parse(JSON.stringify(state.files[p])); });
    return { files: snap, folders: Array.from(state.folders), openTabs: state.openTabs.slice(), activeTab: state.activeTab };
  }
  function restoreSnapshot(snap) {
    Object.keys(snap.files).forEach(function (p) { state.files[p] = snap.files[p]; expandTo(p); });
    snap.folders.forEach(function (f) { state.folders.add(f); });
    state.openTabs = snap.openTabs.filter(function (p) { return state.files[p]; });
    state.activeTab = snap.activeTab && state.files[snap.activeTab] ? snap.activeTab : state.openTabs[0] || null;
    Object.keys(snap.files).forEach(function (p) { disposeEditor(p); });
    afterStructureChange(); scheduleSave();
  }

  function afterStructureChange() { renderTree(); renderTabs(); syncEditor(); scheduleGit(); }

  /* ---------- editors ---------- */
  function langFor(path) { return L.langOf(path); }
  function disposeEditor(path) {
    var ed = state.editors[path];
    if (ed) { ed.ta.remove(); delete state.editors[path]; }
  }
  function disposeAllEditors() { Object.keys(state.editors).forEach(disposeEditor); }

  function getEditor(path) {
    var ed = state.editors[path];
    if (ed) return ed;
    var f = state.files[path];
    var ta = document.createElement('textarea');
    ta.className = 'code-input'; ta.spellcheck = false; ta.setAttribute('wrap', 'off'); ta.setAttribute('autocomplete', 'off'); ta.setAttribute('autocorrect', 'off'); ta.setAttribute('autocapitalize', 'off');
    ta.value = f.content; ta.style.display = 'none';
    ed = { path: path, ta: ta, errors: [], version: 0, blankedV: -1, blanked: '', lintTimer: null };
    ta.addEventListener('input', function (ev) { onInput(ed, ev); });
    ta.addEventListener('scroll', function () { syncScroll(ed); hideAC(); });
    ta.addEventListener('keydown', function (ev) { onKeyDown(ed, ev); });
    ta.addEventListener('click', function () { hideAC(); caretChanged(); });
    ta.addEventListener('keyup', function (ev) { if (/^(Arrow|Home|End|Page)/.test(ev.key)) { if (/Left|Right|Home|End/.test(ev.key)) hideAC(); caretChanged(); } });
    ta.addEventListener('blur', function () { setTimeout(hideAC, 120); });
    $('codeArea').appendChild(ta);
    state.editors[path] = ed;
    return ed;
  }
  function activeEditor() { return state.activeTab ? state.editors[state.activeTab] || null : null; }

  function syncScroll(ed) {
    if (ed.path !== state.activeTab) return;
    var hl = $('highlightLayer'), ta = ed.ta;
    hl.scrollTop = ta.scrollTop; hl.scrollLeft = ta.scrollLeft;
    $('gutter').scrollTop = ta.scrollTop;
    $('decorInner').style.transform = 'translate(' + (-ta.scrollLeft) + 'px,' + (-ta.scrollTop) + 'px)';
  }

  function applyFontSettings() {
    var fs = Math.min(24, Math.max(10, state.settings.fontSize || 13)), lh = Math.round(fs * 1.55);
    var r = document.documentElement.style;
    r.setProperty('--fs', fs + 'px'); r.setProperty('--lh', lh + 'px'); r.setProperty('--tab', String(state.settings.tabSize || 2));
    var probe = el('span'); probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font-family:var(--font-mono);font-size:var(--fs);';
    probe.textContent = new Array(101).join('x'); $('codeArea').appendChild(probe);
    state.cw = probe.getBoundingClientRect().width / 100 || fs * 0.6; probe.remove();
    $('statusTab').textContent = 'Spaces: ' + (state.settings.tabSize || 2);
    var ed = activeEditor(); if (ed) { renderEditorLayers(ed); caretChanged(); }
  }
  function lineHeight() { return Math.round(Math.min(24, Math.max(10, state.settings.fontSize || 13)) * 1.55); }

  function syncEditor() {
    var path = state.activeTab, welcome = $('welcome'), wrapper = $('editorWrapper'), media = $('mediaView');
    Object.keys(state.editors).forEach(function (p) { state.editors[p].ta.style.display = 'none'; });
    media.classList.add('hidden');
    if (!path || !state.files[path]) {
      welcome.style.display = 'flex'; wrapper.style.display = 'none'; updateStatus(); renderProblems(); return;
    }
    welcome.style.display = 'none';
    var f = state.files[path];
    if (f.binary) { wrapper.style.display = 'none'; showMedia(path, f); updateStatus(); state.problems = []; renderProblems(); return; }
    wrapper.style.display = 'flex';
    var ed = getEditor(path);
    ed.ta.style.display = 'block';
    renderEditorLayers(ed); scheduleLint(ed, 0); updateStatus(); caretChanged();
    setTimeout(function () { if (state.activeTab === path && !document.querySelector('.modal-overlay:not(.hidden)') && document.activeElement && !/INPUT|TEXTAREA/.test(document.activeElement.tagName || '')) ed.ta.focus(); }, 0);
    syncScroll(ed);
  }

  function showMedia(path, f) {
    var m = $('mediaView'); m.innerHTML = ''; m.classList.remove('hidden');
    var mime = f.mime || L.mimeOf(path), url = 'data:' + mime + ';base64,' + f.content;
    if (L.isImagePath(path)) { var img = document.createElement('img'); img.alt = path; img.src = url; m.appendChild(img); img.onload = function () { info.textContent = path + ' — ' + img.naturalWidth + '×' + img.naturalHeight + ' — ' + fmtSize(fileByteLength(f)); }; }
    else if (/^audio\//.test(mime) || /^video\//.test(mime)) { var med = document.createElement(/^audio/.test(mime) ? 'audio' : 'video'); med.controls = true; med.src = url; med.style.maxWidth = '90%'; m.appendChild(med); }
    var info = el('div', '', path + ' — binary file, ' + fmtSize(fileByteLength(f)) + ' (not editable)');
    var b = el('button', 'modal-btn', 'Download'); b.addEventListener('click', function () { downloadFile(path); });
    m.appendChild(info); m.appendChild(b);
  }

  function renderEditorLayers(ed) {
    var code = ed.ta.value, lang = langFor(ed.path), big = code.length > BIG_FILE;
    ed.big = big;
    var html = big ? esc(code) : L.highlight(code, lang);
    if (/\n$/.test(code) || code === '') html += ' ';
    $('highlightLayer').innerHTML = html;
    renderGutter(ed); renderDecor(ed); syncScroll(ed);
  }

  function renderGutter(ed) {
    var n = ed.ta.value.split('\n').length, errLines = {}, warnLines = {};
    ed.errors.forEach(function (e) { if (e.type === 'error') errLines[e.line] = true; else if (e.type === 'warning') warnLines[e.line] = true; });
    var key = n + '|' + Object.keys(errLines).join(',') + '|' + Object.keys(warnLines).join(',');
    if (ed.gutterKey === key) return;
    ed.gutterKey = key;
    var parts = [];
    for (var i = 1; i <= n; i++) parts.push('<span class="gl' + (errLines[i] ? ' err' : warnLines[i] ? ' warn' : '') + '">' + i + '</span>');
    $('gutter').innerHTML = parts.join('');
  }

  function posToLineCol(v, pos) {
    var before = v.slice(0, pos), line = 0, idx = -1, i;
    while ((i = before.indexOf('\n', idx + 1)) !== -1) { line++; idx = i; }
    return { line: line, col: pos - idx - 1 };
  }
  function visualCol(text, col) {
    var tab = state.settings.tabSize || 2, v = 0;
    for (var i = 0; i < col && i < text.length; i++) v = text.charAt(i) === '\t' ? (Math.floor(v / tab) + 1) * tab : v + 1;
    return v;
  }
  function lineText(v, line) { var s = 0, i; for (i = 0; i < line; i++) { s = v.indexOf('\n', s) + 1; if (s === 0) return ''; } var e = v.indexOf('\n', s); return v.slice(s, e === -1 ? v.length : e); }

  function renderDecor(ed) {
    var inner = $('decorInner'), lh = lineHeight(), v = ed.ta.value, html = [];
    if (ed.path !== state.activeTab) return;
    var caret = posToLineCol(v, ed.ta.selectionStart);
    if (document.activeElement === ed.ta && ed.ta.selectionStart === ed.ta.selectionEnd) html.push('<div class="d-line" style="top:' + (PAD_T + caret.line * lh) + 'px"></div>');
    var lines = v.split('\n'), seen = {};
    ed.errors.slice(0, 120).forEach(function (e) {
      var key = e.line + e.type; if (seen[key] || e.line > lines.length) return; seen[key] = true;
      var t = lines[e.line - 1] || '', lead = /^\s*/.exec(t)[0].length;
      html.push('<div class="d-' + (e.type === 'error' ? 'err' : e.type === 'warning' ? 'warn' : 'info') + '" style="top:' + (PAD_T + (e.line - 1) * lh) + 'px;left:' + (PAD_L + visualCol(t, lead) * state.cw) + 'px;width:' + Math.max(8, (visualCol(t, t.length) - visualCol(t, lead)) * state.cw) + 'px"></div>');
    });
    if (state.find.open && state.find.matches.length) {
      var top = ed.ta.scrollTop, vis0 = Math.floor((top - PAD_T) / lh) - 1, vis1 = vis0 + Math.ceil(ed.ta.clientHeight / lh) + 3, shown = 0;
      for (var m = 0; m < state.find.matches.length && shown < 400; m++) {
        var mt = state.find.matches[m], lc = posToLineCol(v, mt.s);
        if (lc.line < vis0 || lc.line > vis1) continue;
        shown++;
        var txt = lines[lc.line] || '', w = Math.max(1, Math.min(mt.e - mt.s, txt.length - lc.col)) * state.cw;
        html.push('<div class="d-find' + (m === state.find.idx ? ' cur' : '') + '" style="top:' + (PAD_T + lc.line * lh) + 'px;left:' + (PAD_L + visualCol(txt, lc.col) * state.cw) + 'px;width:' + w + 'px"></div>');
      }
    }
    if (ed.bracket) {
      ed.bracket.forEach(function (p) {
        var lc = posToLineCol(v, p);
        html.push('<div class="d-bracket" style="top:' + (PAD_T + lc.line * lh) + 'px;left:' + (PAD_L + visualCol(lines[lc.line] || '', lc.col) * state.cw) + 'px;width:' + state.cw + 'px"></div>');
      });
    }
    inner.innerHTML = html.join('');
  }

  function findBracket(ed) {
    ed.bracket = null;
    var lang = langFor(ed.path);
    if (ed.big || !/^(js|ts|css|json)$/.test(lang)) return;
    var v = ed.ta.value, pos = ed.ta.selectionStart;
    if (ed.ta.selectionStart !== ed.ta.selectionEnd) return;
    if (ed.blankedV !== ed.version) { ed.blanked = L.blankNonCode(v, L.scan(v, lang)); ed.blankedV = ed.version; }
    var b = ed.blanked, open = '([{', close = ')]}', at = -1, ch;
    if (pos < b.length && (open.indexOf(b.charAt(pos)) !== -1 || close.indexOf(b.charAt(pos)) !== -1)) at = pos;
    else if (pos > 0 && (open.indexOf(b.charAt(pos - 1)) !== -1 || close.indexOf(b.charAt(pos - 1)) !== -1)) at = pos - 1;
    if (at === -1) return;
    ch = b.charAt(at);
    var oi = open.indexOf(ch), depth = 0, i;
    if (oi !== -1) {
      var want = close.charAt(oi);
      for (i = at; i < b.length; i++) { var c = b.charAt(i); if (c === ch) depth++; else if (c === want) { depth--; if (depth === 0) { ed.bracket = [at, i]; return; } } }
    } else {
      var wantO = open.charAt(close.indexOf(ch));
      for (i = at; i >= 0; i--) { var c2 = b.charAt(i); if (c2 === ch) depth++; else if (c2 === wantO) { depth--; if (depth === 0) { ed.bracket = [i, at]; return; } } }
    }
  }

  function caretChanged() {
    var ed = activeEditor(); if (!ed) return;
    var v = ed.ta.value, s = ed.ta.selectionStart, e = ed.ta.selectionEnd, lc = posToLineCol(v, s);
    $('statusPos').textContent = 'Ln ' + (lc.line + 1) + ', Col ' + (lc.col + 1) + (e > s ? ' (' + (e - s) + ' selected)' : '');
    findBracket(ed); renderDecor(ed);
  }

  function updateStatus() {
    var path = state.activeTab;
    if (!path || !state.files[path]) { $('statusPath').textContent = 'No file open'; $('statusSize').textContent = '0 B'; $('statusLang').textContent = '—'; $('statusPos').textContent = ''; updateErrorStatus([]); return; }
    $('statusPath').textContent = path;
    $('statusSize').textContent = fmtSize(fileByteLength(state.files[path]));
    var names = { html: 'HTML', css: 'CSS', js: 'JavaScript', ts: 'TypeScript', json: 'JSON', python: 'Python', yaml: 'YAML', md: 'Markdown', xml: 'XML', sh: 'Shell', txt: 'Plain Text' };
    $('statusLang').textContent = state.files[path].binary ? 'Binary' : (names[langFor(path)] || 'Plain Text') + (state.editors[path] && state.editors[path].big ? ' (large file mode)' : '');
  }
  function updateErrorStatus(errs) {
    var e = errs.filter(function (x) { return x.type === 'error'; }).length, w = errs.filter(function (x) { return x.type === 'warning'; }).length, s = $('statusErrors');
    $('problemCount').textContent = errs.length;
    if (e || w) { s.classList.remove('hidden'); s.textContent = 'ⓧ ' + e + '  ⚠ ' + w; } else s.classList.add('hidden');
    $('statusbar').classList.toggle('syntax-error', e > 0);
  }

  /* ---------- linting ---------- */
  function scheduleLint(ed, delay) {
    clearTimeout(ed.lintTimer);
    ed.lintTimer = setTimeout(function () { runLint(ed); }, delay === undefined ? 350 : delay);
  }
  function workspaceCtx(path) {
    var files = {}, dirs = {};
    Object.keys(state.files).forEach(function (p) { files[p] = true; });
    allFolders().forEach(function (d) { dirs[d] = true; });
    return { path: path, files: files, dirs: dirs };
  }
  function runLint(ed) {
    if (!state.files[ed.path] || state.files[ed.path].binary) return;
    var lang = langFor(ed.path);
    ed.errors = ed.big ? [] : Lint.lint(ed.ta.value, lang, workspaceCtx(ed.path));
    renderTabs();
    if (ed.path === state.activeTab) {
      state.problems = ed.errors; updateErrorStatus(ed.errors);
      if (state.problemMode === 'file') renderProblems();
      renderGutter(ed); renderDecor(ed);
    }
  }
  function renderProblems() {
    var list = $('problemsList'); list.innerHTML = '';
    if (state.problemMode === 'all') return;
    if (!state.problems.length) { list.appendChild(el('div', 'problems-empty', state.activeTab ? 'No problems detected in this file.' : 'Open a file to see problems.')); return; }
    state.problems.forEach(function (err) {
      var item = el('div', 'problem-item');
      item.appendChild(el('span', 'problem-icon ' + err.type, err.type === 'error' ? 'ⓧ' : err.type === 'warning' ? '⚠' : 'ⓘ'));
      item.appendChild(el('span', '', err.msg));
      item.appendChild(el('span', 'problem-loc', 'Ln ' + err.line));
      item.addEventListener('click', function () { jumpToLine(err.line); });
      list.appendChild(item);
    });
  }
  function lintAll() {
    var list = $('problemsList'); list.innerHTML = ''; state.problemMode = 'all';
    var ctx = workspaceCtx(''), total = 0;
    Object.keys(state.files).sort().forEach(function (p) {
      var f = state.files[p]; if (f.binary) return;
      var c = Object.assign({}, ctx, { path: p }), errs = Lint.lint(f.content, langFor(p), c).filter(function (e) { return e.type !== 'info'; });
      if (!errs.length) return;
      total += errs.length;
      var h = el('div', 'problem-file', p + '  (' + errs.length + ')'); list.appendChild(h);
      errs.forEach(function (err) {
        var item = el('div', 'problem-item');
        item.appendChild(el('span', 'problem-icon ' + err.type, err.type === 'error' ? 'ⓧ' : '⚠'));
        item.appendChild(el('span', '', err.msg)); item.appendChild(el('span', 'problem-loc', 'Ln ' + err.line));
        item.addEventListener('click', function () { openFile(p); setTimeout(function () { jumpToLine(err.line); }, 30); });
        list.appendChild(item);
      });
    });
    if (!total) list.appendChild(el('div', 'problems-empty', 'No problems found in any file.'));
    showPanel('problems'); toast('Linted ' + Object.keys(state.files).length + ' files — ' + total + ' problem(s).', { kind: total ? 'warn' : 'ok' });
    var back = function () { state.problemMode = 'file'; };
    setTimeout(function () { document.addEventListener('click', function once(ev) { if (!ev.target.closest('#panelProblems')) { back(); document.removeEventListener('click', once); } }); }, 0);
  }

  function showPanel(name) {
    $('bottomPanels').classList.remove('hidden');
    document.querySelectorAll('.panel-tab').forEach(function (t) { t.classList.toggle('active', t.dataset.panel === name); });
    $('panelProblems').classList.toggle('hidden', name !== 'problems');
    $('panelConsole').classList.toggle('hidden', name !== 'console');
    if (name === 'problems' && state.problemMode === 'file') renderProblems();
  }

  function revealLine(ed, line, col) {
    var lh = lineHeight(), ta = ed.ta, y = PAD_T + (line - 1) * lh;
    if (y < ta.scrollTop + lh || y > ta.scrollTop + ta.clientHeight - lh * 2) ta.scrollTop = Math.max(0, y - ta.clientHeight / 2);
    if (col !== undefined) {
      var x = PAD_L + visualCol(lineText(ta.value, line - 1), col) * state.cw;
      if (x < ta.scrollLeft + 20 || x > ta.scrollLeft + ta.clientWidth - 60) ta.scrollLeft = Math.max(0, x - ta.clientWidth / 2);
    }
    syncScroll(ed);
  }
  function jumpToLine(line, col, len) {
    var ed = activeEditor(); if (!ed) return;
    var v = ed.ta.value, lines = v.split('\n'), ln = Math.min(Math.max(1, line), lines.length), pos = 0;
    for (var i = 0; i < ln - 1; i++) pos += lines[i].length + 1;
    var start = pos + (col !== undefined ? col : 0), end = col !== undefined ? start + (len || 0) : pos + lines[ln - 1].length;
    ed.ta.focus(); ed.ta.setSelectionRange(start, end);
    revealLine(ed, ln, col); caretChanged();
  }

  window.DSApp = { state: state, toast: toast, dialog: dialog, askText: askText, askConfirm: askConfirm, sanitizePath: sanitizePath, parentDir: parentDir, baseName: baseName, uniquePath: uniquePath,
    allFolders: allFolders, expandTo: expandTo, fmtSize: fmtSize, fileByteLength: fileByteLength, scheduleSave: scheduleSave, flushSave: flushSave, applyLoaded: applyLoaded,
    offerUndo: offerUndo, snapshotFiles: snapshotFiles, restoreSnapshot: restoreSnapshot, afterStructureChange: afterStructureChange, disposeEditor: disposeEditor, disposeAllEditors: disposeAllEditors,
    getEditor: getEditor, activeEditor: activeEditor, syncEditor: syncEditor, renderEditorLayers: renderEditorLayers, scheduleLint: scheduleLint, runLint: runLint, lintAll: lintAll, showPanel: showPanel,
    revealLine: revealLine, jumpToLine: jumpToLine, caretChanged: caretChanged, applyFontSettings: applyFontSettings, updateStatus: updateStatus, setSaveStatus: setSaveStatus, lineHeight: lineHeight,
    posToLineCol: posToLineCol, langFor: langFor, esc: esc, el: el, renderDecor: renderDecor, syncScroll: syncScroll, updateErrorStatus: updateErrorStatus, renderProblems: renderProblems };
})();
