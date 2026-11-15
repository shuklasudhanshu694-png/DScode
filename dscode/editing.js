(function () {
  'use strict';
  var App = window.DSApp, L = window.DSLang, A = window.DSAssist;
  var state = App.state, $ = function (id) { return document.getElementById(id); }, el = App.el;
  var PAIRS = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' };
  var PAIR_STRINGS = { '()': 1, '[]': 1, '{}': 1, '""': 1, "''": 1, '``': 1 };

  function unit() { return new Array((state.settings.tabSize || 2) + 1).join(' '); }
  function lineBounds(v, pos) { var ls = v.lastIndexOf('\n', pos - 1) + 1, le = v.indexOf('\n', pos); return { ls: ls, le: le === -1 ? v.length : le }; }
  function blockBounds(ta) {
    var v = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
    if (e > s && v.charAt(e - 1) === '\n') e--;
    var a = lineBounds(v, s), b = lineBounds(v, e);
    return { start: a.ls, end: b.le };
  }

  function applyEdit(ed, start, end, text, selStart, selEnd) {
    var ta = ed.ta, before = ta.value, expected = before.slice(0, start) + text + before.slice(end), ok = false;
    ed.programmatic = true;
    if (document.activeElement !== ta) ta.focus();
    ta.setSelectionRange(start, end);
    try { ok = text === '' ? document.execCommand('delete') : document.execCommand('insertText', false, text); } catch (e) { ok = false; }
    if (!ok || ta.value !== expected) {
      ta.value = expected;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
    ed.programmatic = false;
    var ns = selStart === undefined ? start + text.length : selStart, ne = selEnd === undefined ? ns : selEnd;
    ta.setSelectionRange(ns, ne);
    App.caretChanged();
  }

  function onInput(ed, ev) {
    var f = App.state.files[ed.path]; if (!f) return;
    f.content = ed.ta.value; ed.version++;
    if (ed.path === state.activeTab) { App.renderEditorLayersFast(ed); App.updateStatus(); }
    App.scheduleLint(ed); App.scheduleSave(); App.scheduleGit(); App.onContentChanged(ed);
    var t = ev && ev.inputType, v = ed.ta.value, pos = ed.ta.selectionStart;
    if (ed.big) return;
    if (t === 'insertText' && ev.data === '>' && !ed.programmatic) {
      var tag = A.autoCloseTag(v, pos, L.langOf(ed.path));
      if (tag) { applyEdit(ed, pos, pos, '</' + tag + '>', pos, pos); return; }
    }
    if (!ed.programmatic && (t === 'insertText' || t === 'deleteContentBackward') && ed.ta.selectionStart === ed.ta.selectionEnd) triggerComplete(ed, false);
    else hideAC();
  }

  /* ---------- autocomplete ---------- */
  function collectWords() {
    var now = Date.now();
    if (now - state.wordsCache.at < 2500 && state.wordsCache.list.length) return state.wordsCache.list;
    var seen = {}, list = [], budget = 400000;
    Object.keys(state.files).some(function (p) {
      var f = state.files[p]; if (f.binary || budget <= 0) return false;
      var text = f.content.length > 120000 ? f.content.slice(0, 120000) : f.content; budget -= text.length;
      var re = /[A-Za-z_$][\w$]{3,}/g, m;
      while ((m = re.exec(text)) !== null) { if (!seen[m[0]]) { seen[m[0]] = 1; list.push(m[0]); if (list.length > 4000) return true; } }
      return false;
    });
    state.wordsCache = { at: now, list: list };
    return list;
  }

  function triggerComplete(ed, manual) {
    var ta = ed.ta, pos = ta.selectionStart;
    var res = A.complete({ code: ta.value, pos: pos, lang: L.langOf(ed.path), path: ed.path, words: collectWords() });
    if (!res || !res.items.length) { hideAC(); return; }
    showAC(ed, res, pos);
  }

  function showAC(ed, res, pos) {
    var box = $('autocompleteBox'), prefix = ed.ta.value.slice(res.from, pos);
    state.ac = { items: res.items, index: 0, from: res.from, open: true, pos: pos };
    box.innerHTML = '';
    res.items.forEach(function (it, i) {
      var row = el('div', 'ac-item' + (i === 0 ? ' selected' : ''));
      var label = el('span', 'ac-label'); label.innerHTML = '<b>' + App.esc(it.label.slice(0, prefix.length)) + '</b>' + App.esc(it.label.slice(prefix.length));
      row.appendChild(label); row.appendChild(el('span', 'ac-kind', it.kind));
      row.addEventListener('mousedown', function (e) { e.preventDefault(); acceptAC(i); });
      box.appendChild(row);
    });
    var lc = App.posToLineCol(ed.ta.value, pos), txt = ed.ta.value.slice(ed.ta.value.lastIndexOf('\n', pos - 1) + 1, pos);
    var lh = App.lineHeight(), x = 10 + txt.length * state.cw - ed.ta.scrollLeft, y = 12 + (lc.line + 1) * lh - ed.ta.scrollTop;
    box.classList.remove('hidden');
    var maxX = $('codeArea').clientWidth - box.offsetWidth - 8, maxY = $('codeArea').clientHeight - box.offsetHeight - 4;
    box.style.left = Math.max(4, Math.min(x, maxX)) + 'px';
    box.style.top = (y > maxY ? Math.max(4, y - lh - box.offsetHeight) : y) + 'px';
  }
  function hideAC() { state.ac.open = false; $('autocompleteBox').classList.add('hidden'); }
  function moveAC(delta) {
    var n = state.ac.items.length; state.ac.index = (state.ac.index + delta + n) % n;
    var rows = $('autocompleteBox').children;
    for (var i = 0; i < rows.length; i++) rows[i].classList.toggle('selected', i === state.ac.index);
    if (rows[state.ac.index]) rows[state.ac.index].scrollIntoView({ block: 'nearest' });
  }
  function insertWithCursor(ed, from, to, snippet) {
    var v = ed.ta.value, b = lineBounds(v, from), indent = /^[ \t]*/.exec(v.slice(b.ls, b.le))[0];
    var text = snippet.replace(/\n/g, '\n' + indent), ci = text.indexOf('$0');
    text = text.replace('$0', '');
    applyEdit(ed, from, to, text, ci === -1 ? from + text.length : from + ci);
  }
  function acceptAC(i) {
    var ed = App.activeEditor(), it = state.ac.items[i]; if (!ed || !it) return;
    var from = state.ac.from, to = ed.ta.selectionStart; hideAC();
    insertWithCursor(ed, from, to, it.insert);
  }

  /* ---------- key handling ---------- */
  function selectedLinesEdit(ed, fn) {
    var ta = ed.ta, v = ta.value, bb = blockBounds(ta), block = v.slice(bb.start, bb.end), res = fn(block.split('\n'));
    if (!res) return;
    var text = res.join('\n');
    applyEdit(ed, bb.start, bb.end, text, bb.start, bb.start + text.length);
  }
  function indentLines(ed, outdent) {
    var u = unit(), tab = state.settings.tabSize || 2;
    selectedLinesEdit(ed, function (lines) {
      return lines.map(function (l) {
        if (!outdent) return l.trim() ? u + l : l;
        if (l.charAt(0) === '\t') return l.slice(1);
        var m = /^ +/.exec(l); return m ? l.slice(Math.min(m[0].length, tab)) : l;
      });
    });
  }
  function toggleComment(ed) {
    var ta = ed.ta, lang = A.langAt(ta.value, ta.selectionStart, L.langOf(ed.path));
    var changed = false;
    selectedLinesEdit(ed, function (lines) { var r = A.toggleComment(lines, lang); if (r) changed = true; return r; });
    if (!changed) App.toast('This file type has no comment syntax.', { kind: 'warn' });
  }
  function duplicateLines(ed) {
    var ta = ed.ta, v = ta.value;
    if (ta.selectionStart !== ta.selectionEnd && v.slice(ta.selectionStart, ta.selectionEnd).indexOf('\n') === -1) {
      var seg = v.slice(ta.selectionStart, ta.selectionEnd); applyEdit(ed, ta.selectionEnd, ta.selectionEnd, seg, ta.selectionEnd, ta.selectionEnd + seg.length); return;
    }
    var bb = blockBounds(ta), block = v.slice(bb.start, bb.end);
    applyEdit(ed, bb.end, bb.end, '\n' + block, bb.end + 1, bb.end + 1 + block.length);
  }
  function deleteLines(ed) {
    var ta = ed.ta, v = ta.value, bb = blockBounds(ta), s = bb.start, e = bb.end;
    if (e < v.length) e++; else if (s > 0) s--;
    applyEdit(ed, s, e, '', Math.min(s, v.length - (e - s)));
  }
  function moveLines(ed, dir) {
    var ta = ed.ta, v = ta.value, bb = blockBounds(ta), block = v.slice(bb.start, bb.end), relS = ta.selectionStart - bb.start, relE = ta.selectionEnd - bb.start;
    if (dir < 0) {
      if (bb.start === 0) return;
      var pb = lineBounds(v, bb.start - 1), prev = v.slice(pb.ls, pb.le);
      applyEdit(ed, pb.ls, bb.end, block + '\n' + prev, pb.ls + relS, pb.ls + relE);
    } else {
      if (bb.end >= v.length) return;
      var nb = lineBounds(v, bb.end + 1), next = v.slice(nb.ls, nb.le);
      applyEdit(ed, bb.start, nb.le, next + '\n' + block, bb.start + next.length + 1 + relS, bb.start + next.length + 1 + relE);
    }
  }

  function smartEnter(ed) {
    var ta = ed.ta, v = ta.value, pos = ta.selectionStart, end = ta.selectionEnd, b = lineBounds(v, pos);
    var line = v.slice(b.ls, pos), indent = /^[ \t]*/.exec(v.slice(b.ls, b.le))[0], u = unit(), lang = A.langAt(v, pos, L.langOf(ed.path));
    var prev = v.charAt(pos - 1), next = v.charAt(end);
    if (lang === 'md') {
      var lm = /^(\s*)([-*+]|\d+\.)\s(.*)$/.exec(v.slice(b.ls, b.le));
      if (lm && pos === b.le) {
        if (!lm[3].trim()) { applyEdit(ed, b.ls, b.le, '', b.ls); return true; }
        var mark = /^\d+/.test(lm[2]) ? (parseInt(lm[2], 10) + 1) + '.' : lm[2];
        applyEdit(ed, pos, end, '\n' + lm[1] + mark + ' '); return true;
      }
    }
    var extra = false, closer = null;
    if (prev === '{' || prev === '[' || prev === '(') { extra = true; closer = { '{': '}', '[': ']', '(': ')' }[prev]; }
    else if ((lang === 'python') && /:\s*$/.test(line) && !/^\s*#/.test(line)) extra = true;
    else if (lang === 'html' && prev === '>' && /<[A-Za-z][^<>]*>$/.test(line) && !/<\/|\/>$/.test(line.slice(-3))) {
      var nm = /<([A-Za-z][\w:-]*)[^<>]*>$/.exec(line);
      if (nm && !L.VOID[nm[1].toLowerCase()]) { extra = true; closer = '</' + nm[1]; }
    }
    if (extra && closer && v.substr(end, closer.length) === closer) {
      var ins = '\n' + indent + u + '\n' + indent;
      applyEdit(ed, pos, end, ins, pos + 1 + indent.length + u.length); return true;
    }
    applyEdit(ed, pos, end, '\n' + indent + (extra ? u : '')); return true;
  }

  function onKeyDown(ed, e) {
    var ta = ed.ta, mod = e.ctrlKey || e.metaKey, k = e.key;
    if (state.ac.open) {
      if (k === 'ArrowDown') { e.preventDefault(); moveAC(1); return; }
      if (k === 'ArrowUp') { e.preventDefault(); moveAC(-1); return; }
      if (k === 'Enter' || k === 'Tab') { e.preventDefault(); acceptAC(state.ac.index); return; }
      if (k === 'Escape') { e.preventDefault(); hideAC(); return; }
    }
    if (mod && k === ' ') { e.preventDefault(); triggerComplete(ed, true); return; }
    if (mod && k === '/') { e.preventDefault(); toggleComment(ed); return; }
    if (mod && !e.shiftKey && (k === 'd' || k === 'D')) { e.preventDefault(); duplicateLines(ed); return; }
    if (mod && e.shiftKey && (k === 'k' || k === 'K')) { e.preventDefault(); deleteLines(ed); return; }
    if (mod && k === ']') { e.preventDefault(); indentLines(ed, false); return; }
    if (mod && k === '[') { e.preventDefault(); indentLines(ed, true); return; }
    if (e.altKey && !mod && (k === 'ArrowUp' || k === 'ArrowDown')) { e.preventDefault(); moveLines(ed, k === 'ArrowUp' ? -1 : 1); return; }
    if (mod || e.altKey) return;

    var v = ta.value, s = ta.selectionStart, en = ta.selectionEnd;
    if (k === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) { indentLines(ed, true); return; }
      if (s !== en && v.slice(s, en).indexOf('\n') !== -1) { indentLines(ed, false); return; }
      if (s === en && !ed.big) {
        var ex = A.expandAt(v, s, L.langOf(ed.path));
        if (ex) { insertWithCursor(ed, ex.from, ex.to, ex.text); return; }
      }
      var tab = state.settings.tabSize || 2, col = s - (v.lastIndexOf('\n', s - 1) + 1);
      applyEdit(ed, s, en, new Array(tab - (col % tab) + 1).join(' ')); return;
    }
    if (k === 'Enter' && !e.shiftKey) { e.preventDefault(); smartEnter(ed); return; }
    if (k === 'Backspace' && s === en && s > 0) {
      var pair = v.charAt(s - 1) + v.charAt(s);
      if (PAIR_STRINGS[pair]) { e.preventDefault(); applyEdit(ed, s - 1, s + 1, '', s - 1); return; }
      var b = lineBounds(v, s), before = v.slice(b.ls, s), tabN = state.settings.tabSize || 2;
      if (before.length && /^ +$/.test(before) && before.length % tabN === 0) { e.preventDefault(); applyEdit(ed, s - tabN, s, '', s - tabN); return; }
      return;
    }
    if (e.key.length === 1) {
      var lang = L.langOf(ed.path), closers = ')]}"\'`';
      if (k in PAIRS) {
        var isQuote = PAIRS[k] === k;
        if (s !== en) { e.preventDefault(); var sel = v.slice(s, en); applyEdit(ed, s, en, k + sel + PAIRS[k], s + 1, s + 1 + sel.length); return; }
        if (isQuote && v.charAt(s) === k) { e.preventDefault(); ta.setSelectionRange(s + 1, s + 1); App.caretChanged(); return; }
        if (isQuote && (lang === 'md' || lang === 'txt') && k !== '`' && k !== '"') return;
        var pv = v.charAt(s - 1), nx = v.charAt(s);
        if (isQuote && (/[\w]/.test(pv) || pv === k || /\w/.test(nx))) return;
        if (!isQuote && nx && !/[\s)\]}>,;:.]/.test(nx)) return;
        e.preventDefault(); applyEdit(ed, s, s, k + PAIRS[k], s + 1); return;
      }
      if (closers.indexOf(k) !== -1 && v.charAt(s) === k && s === en) { e.preventDefault(); ta.setSelectionRange(s + 1, s + 1); App.caretChanged(); return; }
    }
  }

  function renderEditorLayersFast(ed) {
    clearTimeout(ed.rafT);
    if (ed.rafPending) return;
    ed.rafPending = true;
    requestAnimationFrame(function () { ed.rafPending = false; if (ed.path === state.activeTab && state.editors[ed.path] === ed) { App.renderEditorLayers(ed); App.caretChanged(); } });
  }

  Object.assign(App, { applyEdit: applyEdit, onInput: onInput, onKeyDown: onKeyDown, hideAC: hideAC, triggerComplete: triggerComplete, renderEditorLayersFast: renderEditorLayersFast,
    insertWithCursor: insertWithCursor, indentLines: indentLines, toggleComment: toggleComment, collectWords: collectWords, duplicateLines: duplicateLines, deleteLines: deleteLines });
})();
