(function () {
  'use strict';
  var App = window.DSApp, L = window.DSLang, S = window.DSStore;
  var state = App.state, $ = function (id) { return document.getElementById(id); };

  function bind(id, ev, fn) { var e = $(id); if (e) e.addEventListener(ev, fn); else console.warn('DScode: missing element #' + id); }

  function handleInbox() {
    var inbox = S.takeInbox();
    if (!inbox || !inbox.files) return Promise.resolve();
    var entries = [];
    Object.keys(inbox.files).forEach(function (p) {
      var f = inbox.files[p], path = App.sanitizePath(p);
      if (path && f && typeof f.content === 'string') entries.push({ path: path, content: f.content, binary: !!f.binary, mime: f.mime || '' });
    });
    (inbox.folders || []).forEach(function (f) { var sp = App.sanitizePath(f); if (sp) state.folders.add(sp); });
    return App.addFiles(entries, 'Received from Organizer:').then(function () {
      if (inbox.activeTab && state.files[App.sanitizePath(inbox.activeTab)]) App.openFile(App.sanitizePath(inbox.activeTab));
    });
  }

  function reloadFromStore(reason) {
    return S.loadWorkspace().then(function (ws) {
      var prevActive = state.activeTab;
      App.disposeAllEditors();
      App.applyLoaded(ws);
      if (prevActive && state.files[prevActive]) state.activeTab = prevActive;
      state.gitCache = {};
      App.applyFontSettings(); App.afterStructureChange();
      App.toast(reason, { kind: 'ok' });
    });
  }

  function loadSync() {
    return S.loadSync().then(function (s) { state.sync = s; state.gitCache = state.gitCache || {}; App.computeGit(); }, function () {});
  }

  function setupSplitter() {
    var split = $('previewSplit'), panel = $('previewPanel'), dragging = false;
    split.addEventListener('mousedown', function (e) { dragging = true; e.preventDefault(); document.body.style.userSelect = 'none'; $('previewFrame').style.pointerEvents = 'none'; });
    document.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      var total = document.querySelector('.main').getBoundingClientRect(), w = total.right - e.clientX;
      panel.style.width = Math.max(260, Math.min(total.width - 380, w)) + 'px';
    });
    document.addEventListener('mouseup', function () { if (dragging) { dragging = false; document.body.style.userSelect = ''; $('previewFrame').style.pointerEvents = ''; } });
  }

  function setupDrop() {
    var area = $('editorArea'), tree = $('fileTree');
    [area, tree].forEach(function (zone) {
      zone.addEventListener('dragover', function (e) { if (App.hasFiles(e)) e.preventDefault(); });
      zone.addEventListener('drop', function (e) {
        if (!App.hasFiles(e)) { if (zone === tree && e.dataTransfer.getData('text/dscode-path')) { e.preventDefault(); App.handleDrop(e, ''); } return; }
        e.preventDefault(); App.collectDropped(e.dataTransfer, '');
      });
    });
  }

  function setupShortcuts() {
    document.addEventListener('keydown', function (e) {
      var mod = e.ctrlKey || e.metaKey, k = e.key, kl = k.length === 1 ? k.toLowerCase() : k;
      if (!document.getElementById('dialogOverlay').classList.contains('hidden')) return;
      if (App.isPaletteOpen()) return;
      if (mod && e.shiftKey && kl === 'p') { e.preventDefault(); App.openPalette('>'); }
      else if (mod && !e.shiftKey && kl === 'p') { e.preventDefault(); App.openPalette(''); }
      else if (mod && e.shiftKey && kl === 'f') { e.preventDefault(); App.showSideView('search'); }
      else if (mod && !e.shiftKey && !e.altKey && kl === 'f') { if (App.activeEditor()) { e.preventDefault(); App.openFind(false); } }
      else if (mod && !e.shiftKey && kl === 'h') { if (App.activeEditor()) { e.preventDefault(); App.openFind(true); } }
      else if (mod && !e.shiftKey && kl === 'g') { e.preventDefault(); App.goToLine(); }
      else if (mod && !e.shiftKey && kl === 's') { e.preventDefault(); var ed = App.activeEditor(); if (ed) state.files[ed.path].content = ed.ta.value; App.flushSave().then(function () { App.toast('Saved.', { kind: 'ok', ttl: 1200 }); }); }
      else if (mod && kl === 'b') { e.preventDefault(); $('sidebar').classList.toggle('hidden'); }
      else if (mod && k === 'Enter') { e.preventDefault(); App.runPreview(); }
      else if (mod && k === '`') { e.preventDefault(); App.togglePanel(); }
      else if (mod && e.altKey && kl === 'n') { e.preventDefault(); App.newFile(); }
      else if (mod && e.altKey && kl === 'f') { e.preventDefault(); App.formatDocument(); }
      else if (k === 'F1') { e.preventDefault(); App.openPalette('>'); }
      else if (k === 'Escape') {
        if (!$('ctxMenu').classList.contains('hidden')) App.hideCtx();
        else if (!$('importModal').classList.contains('hidden')) $('importModal').classList.add('hidden');
        else if (state.find.open) App.closeFind();
        else if (state.ac.open) App.hideAC();
      }
    }, true);
    document.addEventListener('click', function (e) { if (!e.target.closest('#ctxMenu')) App.hideCtx(); });
  }

  function bindUi() {
    bind('btnNewFile', 'click', function () { App.newFile(); });
    bind('btnNewFolder', 'click', function () { App.newFolder(); });
    bind('btnSideNewFile', 'click', function () { App.newFile(); });
    bind('btnSideNewFolder', 'click', function () { App.newFolder(); });
    bind('btnWelcomeNewFile', 'click', function () { App.newFile(); });
    bind('btnUpload', 'click', function () { $('fileInput').click(); });
    bind('btnWelcomeUpload', 'click', function () { $('fileInput').click(); });
    bind('fileInput', 'change', function (e) { var f = e.target.files; if (f && f.length) App.ingestFiles(f, ''); e.target.value = ''; });
    bind('dirInput', 'change', function (e) { var f = e.target.files; if (f && f.length) App.ingestFiles(f, ''); e.target.value = ''; });
    bind('btnImport', 'click', function () { $('importModal').classList.remove('hidden'); $('importTextarea').focus(); });
    bind('btnWelcomeImport', 'click', function () { $('importModal').classList.remove('hidden'); $('importTextarea').focus(); });
    bind('btnImportClose', 'click', function () { $('importModal').classList.add('hidden'); });
    bind('btnImportCancel', 'click', function () { $('importModal').classList.add('hidden'); });
    bind('btnImportConfirm', 'click', App.importFromText);
    bind('btnRun', 'click', function () { App.runPreview(); });
    bind('btnDownload', 'click', App.downloadZip);
    bind('btnPalette', 'click', function () { App.openPalette('>'); });
    bind('btnToggleSidebar', 'click', function () { $('sidebar').classList.toggle('hidden'); });
    bind('btnTogglePreview', 'click', App.togglePreview);
    bind('btnTogglePanel', 'click', App.togglePanel);
    bind('btnClosePanels', 'click', function () { $('bottomPanels').classList.add('hidden'); });
    bind('btnPanelClear', 'click', function () { App.clearConsole(); });
    bind('btnCollapseAll', 'click', function () { state.expanded = new Set(['']); App.scheduleSave(); App.renderTree(); });
    bind('btnReset', 'click', App.resetWorkspace);
    bind('searchInput', 'input', function (e) { state.filter = e.target.value.trim(); App.renderTree(); });
    bind('statusErrors', 'click', function () { App.showPanel('problems'); });
    bind('statusTab', 'click', function () { App.setTabSize(state.settings.tabSize === 2 ? 4 : 2); });
    bind('btnPreviewRefresh', 'click', function () { if (state.previewEntry) App.renderPreview(state.previewEntry, false); else App.runPreview(); });
    bind('btnPreviewClose', 'click', function () { $('previewPanel').classList.add('hidden'); $('previewSplit').classList.add('hidden'); });
    bind('btnPreviewBack', 'click', function () { var prev = state.previewHistory.pop(); if (prev && state.files[prev]) App.renderPreview(prev, false); $('btnPreviewBack').style.visibility = state.previewHistory.length ? 'visible' : 'hidden'; });
    bind('btnPreviewDevice', 'click', function () {
      var devs = [{ w: '100%', n: 'Full width' }, { w: '768px', n: 'Tablet 768px' }, { w: '375px', n: 'Mobile 375px' }];
      state.deviceIdx = (state.deviceIdx + 1) % devs.length; $('previewFrame').style.width = devs[state.deviceIdx].w; App.toast('Preview: ' + devs[state.deviceIdx].n, { ttl: 1500 });
    });
    bind('previewLive', 'change', function (e) { state.settings.live = e.target.checked; App.scheduleSave(); });
    document.querySelectorAll('.panel-tab').forEach(function (t) { t.addEventListener('click', function () { App.showPanel(t.dataset.panel); }); });
    document.querySelectorAll('.side-tab').forEach(function (t) { t.addEventListener('click', function () { App.showSideView(t.dataset.view); }); });

    bind('findInput', 'input', function () { App.recomputeFind(false); App.gotoMatch(0); });
    bind('findInput', 'keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); App.gotoMatch(e.shiftKey ? -1 : 1); } else if (e.key === 'Escape') { e.preventDefault(); App.closeFind(); } });
    bind('replaceInput', 'keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); App.replaceCurrent(); } else if (e.key === 'Escape') { e.preventDefault(); App.closeFind(); } });
    ['findCase:caseS', 'findWord:word', 'findRegex:regex'].forEach(function (pair) {
      var id = pair.split(':')[0], key = pair.split(':')[1];
      bind(id, 'click', function () { state.find[key] = !state.find[key]; $(id).classList.toggle('on', state.find[key]); App.recomputeFind(false); App.gotoMatch(0); });
    });
    bind('findNext', 'click', function () { App.gotoMatch(1); }); bind('findPrev', 'click', function () { App.gotoMatch(-1); }); bind('findClose', 'click', App.closeFind);
    bind('replaceOne', 'click', App.replaceCurrent); bind('replaceAll', 'click', App.replaceAllInFile);

    bind('gsRun', 'click', App.runGlobalSearch); bind('gsReplaceAll', 'click', App.replaceInFiles);
    bind('gsQuery', 'keydown', function (e) { if (e.key === 'Enter') App.runGlobalSearch(); });

    bind('paletteInput', 'input', App.renderPalette);
    bind('paletteInput', 'keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); App.movePalette(1); } else if (e.key === 'ArrowUp') { e.preventDefault(); App.movePalette(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); App.choosePalette(); } else if (e.key === 'Escape') { e.preventDefault(); App.closePalette(); }
    });
    bind('paletteOverlay', 'mousedown', function (e) { if (e.target === $('paletteOverlay')) App.closePalette(); });
    bind('consoleInput', 'keydown', function (e) { if (e.key === 'Enter' && e.target.value.trim()) { App.evalInPreview(e.target.value); e.target.value = ''; } });
    bind('linkGit', 'click', function () { App.flushSave(); });
  }

  function init() {
    bindUi(); setupShortcuts(); setupSplitter(); setupDrop();
    S.loadWorkspace().then(function (ws) {
      App.applyLoaded(ws); $('previewLive').checked = state.settings.live !== false;
      App.applyFontSettings(); App.renderTree(); App.renderTabs(); App.syncEditor();
      return handleInbox();
    }).then(function () { return loadSync(); }).catch(function (err) {
      App.toast('Storage problem: ' + err.message + '. Your work cannot be saved in this browser mode — download a ZIP regularly.', { kind: 'error', ttl: 12000 });
      App.setSaveStatus('fail', err.message);
    });

    S.onChange(function (kind) {
      if (kind === 'workspace') reloadFromStore('Workspace updated from another DScode tab or the Git Terminal.');
      else if (kind === 'sync') loadSync();
      else if (kind === 'flush-request') { App.flushEditors(); App.flushSave().then(function () { S.notify('flushed'); }); }
    });
    document.addEventListener('visibilitychange', function () { if (document.hidden) { App.flushEditors(); App.flushSave(); } else loadSync(); });
    window.addEventListener('pagehide', function () { App.flushEditors(); App.flushSave(); });
    window.addEventListener('beforeunload', function () { App.flushEditors(); if (state.dirty) App.flushSave(); });
    window.addEventListener('focus', loadSync);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
