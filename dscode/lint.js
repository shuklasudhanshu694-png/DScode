(function (root) {
  'use strict';
  var L = root.DSLang || (typeof require !== 'undefined' ? require('./lang.js') : null);
  var set = L.set;

  var CSS_PROPS = set('accent-color align-content align-items align-self all animation animation-delay animation-direction animation-duration animation-fill-mode animation-iteration-count animation-name animation-play-state animation-timeline animation-timing-function appearance aspect-ratio backdrop-filter backface-visibility background background-attachment background-blend-mode background-clip background-color background-image background-origin background-position background-position-x background-position-y background-repeat background-size block-size border border-block border-block-end border-block-start border-bottom border-bottom-color border-bottom-left-radius border-bottom-right-radius border-bottom-style border-bottom-width border-collapse border-color border-image border-inline border-inline-end border-inline-start border-left border-left-color border-left-style border-left-width border-radius border-right border-right-color border-right-style border-right-width border-spacing border-style border-top border-top-color border-top-left-radius border-top-right-radius border-top-style border-top-width border-width bottom box-decoration-break box-shadow box-sizing break-after break-before break-inside caption-side caret-color clear clip clip-path color color-scheme column-count column-fill column-gap column-rule column-rule-color column-rule-style column-rule-width column-span column-width columns contain container container-name container-type content content-visibility counter-increment counter-reset cursor direction display empty-cells field-sizing fill filter flex flex-basis flex-direction flex-flow flex-grow flex-shrink flex-wrap float font font-display font-family font-feature-settings font-kerning font-optical-sizing font-size font-size-adjust font-stretch font-style font-synthesis font-variant font-variant-caps font-variant-numeric font-variation-settings font-weight forced-color-adjust gap grid grid-area grid-auto-columns grid-auto-flow grid-auto-rows grid-column grid-column-end grid-column-gap grid-column-start grid-gap grid-row grid-row-end grid-row-gap grid-row-start grid-template grid-template-areas grid-template-columns grid-template-rows hanging-punctuation height hyphens image-rendering inline-size inset inset-block inset-block-end inset-block-start inset-inline inset-inline-end inset-inline-start isolation justify-content justify-items justify-self left letter-spacing line-break line-clamp line-height list-style list-style-image list-style-position list-style-type margin margin-block margin-block-end margin-block-start margin-bottom margin-inline margin-inline-end margin-inline-start margin-left margin-right margin-top mask mask-image mask-size max-block-size max-height max-inline-size max-width min-block-size min-height min-inline-size min-width mix-blend-mode object-fit object-position offset opacity order orphans outline outline-color outline-offset outline-style outline-width overflow overflow-anchor overflow-wrap overflow-x overflow-y overscroll-behavior overscroll-behavior-x overscroll-behavior-y padding padding-block padding-block-end padding-block-start padding-bottom padding-inline padding-inline-end padding-inline-start padding-left padding-right padding-top page-break-after page-break-before page-break-inside paint-order perspective perspective-origin place-content place-items place-self pointer-events position print-color-adjust quotes resize right rotate row-gap scale scroll-behavior scroll-margin scroll-padding scroll-snap-align scroll-snap-stop scroll-snap-type scrollbar-color scrollbar-gutter scrollbar-width shape-outside size size-adjust src tab-size table-layout text-align text-align-last text-decoration text-decoration-color text-decoration-line text-decoration-style text-decoration-thickness text-indent text-justify text-overflow text-shadow text-size-adjust text-transform text-underline-offset text-wrap top touch-action transform transform-origin transform-style transition transition-behavior transition-delay transition-duration transition-property transition-timing-function translate unicode-bidi unicode-range user-select vertical-align view-transition-name visibility white-space widows width will-change word-break word-spacing word-wrap writing-mode z-index zoom');

  function editDistance(a, b) {
    var m = a.length, n = b.length, d = [], i, j;
    for (i = 0; i <= m; i++) { d[i] = [i]; }
    for (j = 0; j <= n; j++) d[0][j] = j;
    for (i = 1; i <= m; i++) for (j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
    return d[m][n];
  }
  function suggest(word, dict) {
    var best = null, bestD = 3, keys = Object.keys(dict);
    for (var i = 0; i < keys.length; i++) {
      if (Math.abs(keys[i].length - word.length) > 2) continue;
      var d = editDistance(word, keys[i]);
      if (d < bestD) { bestD = d; best = keys[i]; }
    }
    return best;
  }

  function checkBrackets(blanked, lineOffset) {
    var stack = [], pairs = { ')': '(', ']': '[', '}': '{' }, errors = [], line = 1;
    for (var i = 0; i < blanked.length; i++) {
      var c = blanked.charAt(i);
      if (c === '\n') { line++; continue; }
      if (c === '(' || c === '[' || c === '{') stack.push({ c: c, line: line });
      else if (pairs[c]) {
        var top = stack.pop();
        if (!top) { errors.push({ line: line + lineOffset, msg: "Unmatched closing '" + c + "'", type: 'error' }); }
        else if (top.c !== pairs[c]) { errors.push({ line: line + lineOffset, msg: "Mismatched '" + c + "': opened as '" + top.c + "' on line " + (top.line + lineOffset), type: 'error' }); }
      }
      if (errors.length >= 5) return errors;
    }
    stack.forEach(function (s) { errors.push({ line: s.line + lineOffset, msg: "Unclosed '" + s.c + "'", type: 'error' }); });
    return errors;
  }

  var AsyncFunction = null;
  try { AsyncFunction = Object.getPrototypeOf(async function () {}).constructor; } catch (e) {}

  function stripModuleSyntax(code) {
    return code
      .replace(/^[ \t]*import\s+[\s\S]*?\bfrom\s*['"][^'"]+['"]\s*;?/gm, function (m) { return m.replace(/[^\n]/g, ' '); })
      .replace(/^[ \t]*import\s*['"][^'"]+['"]\s*;?/gm, function (m) { return m.replace(/[^\n]/g, ' '); })
      .replace(/^([ \t]*)export\s+default\s+/gm, '$1         ')
      .replace(/^([ \t]*)export\s+(?=(?:async\s+)?(?:function|class|const|let|var)\b)/gm, '$1       ')
      .replace(/^[ \t]*export\s*\{[\s\S]*?\}\s*(?:from\s*['"][^'"]+['"])?\s*;?/gm, function (m) { return m.replace(/[^\n]/g, ' '); });
  }

  function tryParse(src) {
    try { new AsyncFunction(src); return null; } catch (e) { return e && e.message ? String(e.message) : 'Syntax error'; }
  }
  function isDefinitive(msg) { return !!msg && !/end of input|Unterminated template|Unexpected end/i.test(msg); }

  function lintJS(code, ctx) {
    ctx = ctx || {};
    var errors = [], lang = ctx.lang || 'js', tokens = L.scanJS(code, lang === 'ts');
    var blanked = L.blankNonCode(code, tokens);
    var bracketErrors = checkBrackets(blanked, ctx.lineOffset || 0);
    errors = errors.concat(bracketErrors);
    var jsx = /\.(jsx|tsx)$/i.test(ctx.path || '');
    if (!bracketErrors.length && AsyncFunction && lang !== 'ts' && !jsx && code.length < 400000 && !ctx.skipSyntax) {
      var noComments = code.split('');
      tokens.forEach(function (t) { if (t.t === 'comment') for (var i = t.s; i < t.e; i++) if (noComments[i] !== '\n') noComments[i] = ' '; });
      var src = stripModuleSyntax(noComments.join('')), msg = tryParse(src);
      if (msg) {
        var lines = src.split('\n'), lo = 1, hi = lines.length;
        if (isDefinitive(msg)) {
          while (lo < hi) {
            var mid = (lo + hi) >> 1;
            if (isDefinitive(tryParse(lines.slice(0, mid).join('\n')))) hi = mid; else lo = mid + 1;
          }
        } else lo = lines.length;
        errors.push({ line: lo + (ctx.lineOffset || 0), msg: msg, type: 'error' });
      }
    }
    var re = /\bdebugger\b/g, m;
    while ((m = re.exec(blanked)) !== null) errors.push({ line: L.lineOf(code, m.index) + (ctx.lineOffset || 0), msg: "'debugger' statement left in code", type: 'warning' });
    tokens.forEach(function (t) {
      if (t.t === 'comment') {
        var tm = /\b(TODO|FIXME|HACK|XXX)\b/.exec(code.slice(t.s, t.e));
        if (tm) errors.push({ line: L.lineOf(code, t.s + tm.index) + (ctx.lineOffset || 0), msg: tm[1] + ' comment', type: 'info' });
      }
    });
    return errors;
  }

  function lintJSON(code, ctx) {
    ctx = ctx || {};
    var off = ctx.lineOffset || 0;
    if (!code.trim()) return [];
    try { JSON.parse(code); return []; } catch (e) {
      var msg = String(e.message), line = code.split('\n').length, pm = /position (\d+)/.exec(msg), lm = /line (\d+) column (\d+)/.exec(msg), sn = /"((?:[^"\\]|\\.)*)" is not valid JSON/.exec(msg);
      if (lm) line = parseInt(lm[1], 10);
      else if (pm) line = L.lineOf(code, parseInt(pm[1], 10));
      else if (sn) {
        var snippet = sn[1].replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        var at = code.lastIndexOf(snippet);
        if (at !== -1) line = L.lineOf(code, at + snippet.length - 1);
      }
      return [{ line: line + off, msg: msg.replace(/\s*\(line \d+ column \d+\)/, '').replace(/,\s*\.\.\.[\s\S]*$/, '').replace(/,\s*"[\s\S]*$/, ''), type: 'error' }];
    }
  }

  function lintCSS(code, ctx) {
    ctx = ctx || {};
    var off = ctx.lineOffset || 0, tokens = L.scanCSS(code), errors = [];
    var blanked = L.blankNonCode(code, tokens);
    errors = errors.concat(checkBrackets(blanked, off));
    tokens.forEach(function (t) {
      if (t.t !== 'prop') return;
      var name = code.slice(t.s, t.e).toLowerCase();
      if (name.charAt(0) !== '-' && !CSS_PROPS[name]) {
        var sg = suggest(name, CSS_PROPS);
        errors.push({ line: L.lineOf(code, t.s) + off, msg: "Unknown CSS property '" + name + "'" + (sg ? ". Did you mean '" + sg + "'?" : ''), type: 'warning' });
      }
      var colon = code.indexOf(':', t.e), rest = code.slice(colon + 1, colon + 1 + 400), stop = rest.search(/[;}]/);
      var value = stop === -1 ? rest : rest.slice(0, stop);
      if (!/\S/.test(value.replace(/\/\*[\s\S]*?\*\//g, ''))) errors.push({ line: L.lineOf(code, t.s) + off, msg: "Empty value for '" + name + "'", type: 'warning' });
      var vb = blanked.slice(colon + 1, colon + 1 + (stop === -1 ? 400 : stop)).replace(/\([^)]*\)/g, '()');
      if (/\n\s*-{0,2}[a-zA-Z][\w-]*\s*:/.test(vb)) errors.push({ line: L.lineOf(code, t.s) + off, msg: "Possibly missing ';' after '" + name + "' value", type: 'warning' });
    });
    return errors;
  }

  var OPTIONAL_CLOSE = set('li p td th tr thead tbody tfoot option optgroup dt dd colgroup html head body');
  var BLOCK = set('address article aside blockquote div dl fieldset footer form h1 h2 h3 h4 h5 h6 header hr main nav ol p pre section table ul');
  var URL_ATTRS = { a: 'href', link: 'href', img: 'src', script: 'src', source: 'src', video: 'src', audio: 'src', iframe: 'src', embed: 'src', track: 'src' };

  function resolveRef(ref, from) {
    var clean = ref.split(/[?#]/)[0].replace(/\\/g, '/');
    if (!clean) return null;
    var base = clean.charAt(0) === '/' ? [] : from.split('/').slice(0, -1);
    clean.replace(/^\/+/, '').split('/').forEach(function (p) { if (!p || p === '.') return; if (p === '..') base.pop(); else base.push(p); });
    return base.join('/');
  }
  function isExternalRef(ref) { return /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref) || /[{<$]/.test(ref) || ref === ''; }

  function lintHTML(code, ctx) {
    ctx = ctx || {};
    ctx.dirs = ctx.dirs || {};
    var xml = !!ctx.xml, off = ctx.lineOffset || 0, errors = [], nodes = L.parseHTML(code), stack = [], ids = {};
    var hasHtml = false, hasDoctype = false, hasTitle = false, hasHead = false, hasCharset = false;
    function err(index, msg, type) { errors.push({ line: L.lineOf(code, index) + off, msg: msg, type: type || 'error' }); }

    nodes.forEach(function (nd) {
      if (nd.type === 'comment' && nd.unterminated) err(nd.s, 'Unterminated comment', 'error');
      else if (nd.type === 'doctype') { if (/^<!doctype/i.test(nd.text)) hasDoctype = true; }
      else if (nd.type === 'open') {
        if (nd.unterminated) err(nd.s, 'Unterminated tag <' + nd.name + '> (missing > or closing quote)', 'error');
        if (nd.name === 'html') hasHtml = true;
        if (nd.name === 'head') hasHead = true;
        if (nd.name === 'title') hasTitle = true;
        var seen = {};
        nd.attrs.forEach(function (a) {
          if (seen[a.name]) err(a.ns, "Duplicate attribute '" + a.name + "' on <" + nd.name + '>', 'warning');
          seen[a.name] = true;
          if (a.name === 'id' && a.value) {
            if (ids[a.value]) err(a.ns, "Duplicate id '" + a.value + "' (first used on line " + ids[a.value] + ')', 'error');
            else ids[a.value] = L.lineOf(code, a.ns) + off;
          }
          if (nd.name === 'meta' && a.name === 'charset') hasCharset = true;
        });
        if (!xml) {
          if (nd.name === 'img' && !seen.alt) err(nd.s, '<img> is missing an alt attribute', 'warning');
          if (nd.name === 'html' && !seen.lang) err(nd.s, '<html> is missing a lang attribute', 'warning');
          if (nd.name === 'a' && seen.target) {
            var tv = nd.attrs.filter(function (a) { return a.name === 'target'; })[0], rv = nd.attrs.filter(function (a) { return a.name === 'rel'; })[0];
            if (tv && tv.value === '_blank' && !(rv && /noopener|noreferrer/.test(rv.value || ''))) err(nd.s, 'target="_blank" without rel="noopener"', 'info');
          }
          var attrName = URL_ATTRS[nd.name];
          if (attrName && ctx.files && ctx.path) {
            nd.attrs.forEach(function (a) {
              if (a.name !== attrName || a.value == null || isExternalRef(a.value)) return;
              if (nd.name === 'a' && /\/$/.test(a.value)) return;
              var target = resolveRef(a.value, ctx.path);
              if (target && !ctx.files[target] && !ctx.dirs[target]) err(a.ns, "Linked file not found in workspace: '" + a.value + "'", 'warning');
            });
          }
        }
        var isVoid = !xml && L.VOID[nd.name];
        if (!xml && stack.length) {
          var top = stack[stack.length - 1].name;
          if ((top === nd.name && /^(li|p|option|dt|dd|tr|td|th)$/.test(nd.name)) ||
              ((top === 'td' || top === 'th') && /^(td|th|tr)$/.test(nd.name)) ||
              (top === 'tr' && nd.name === 'tr') || (top === 'p' && BLOCK[nd.name]) ||
              (top === 'option' && nd.name === 'optgroup') || (top === 'dt' && nd.name === 'dd') || (top === 'dd' && nd.name === 'dt')) stack.pop();
        }
        if (!isVoid && !nd.selfClose) stack.push({ name: nd.name, s: nd.s });
      } else if (nd.type === 'close') {
        if (!xml && L.VOID[nd.name]) { err(nd.s, 'Void element <' + nd.name + '> must not have a closing tag', 'warning'); return; }
        var idx = -1;
        for (var i = stack.length - 1; i >= 0; i--) if (stack[i].name === nd.name) { idx = i; break; }
        if (idx === -1) { err(nd.s, 'Closing tag </' + nd.name + '> has no matching opening tag', 'error'); return; }
        for (var k = stack.length - 1; k > idx; k--) {
          if (xml || !OPTIONAL_CLOSE[stack[k].name]) err(stack[k].s, 'Unclosed <' + stack[k].name + '> (closed implicitly by </' + nd.name + '>)', 'error');
        }
        stack.length = idx;
      } else if (nd.type === 'raw') {
        var lang = L.rawLang(nd), inner = code.slice(nd.s, nd.e), innerOff = L.lineOf(code, nd.s) - 1 + off;
        var sub = [];
        if (lang === 'js' && inner.trim()) sub = lintJS(inner, { lineOffset: innerOff, lang: 'js' });
        else if (lang === 'css' && inner.trim()) sub = lintCSS(inner, { lineOffset: innerOff });
        else if (lang === 'json' && inner.trim()) sub = lintJSON(inner, { lineOffset: innerOff });
        errors = errors.concat(sub.filter(function (e) { return e.type !== 'info'; }));
      }
    });
    stack.forEach(function (s) { if (xml || !OPTIONAL_CLOSE[s.name]) err(s.s, 'Unclosed <' + s.name + '>', 'error'); });
    if (!xml && hasHtml) {
      if (!hasDoctype) errors.push({ line: 1 + off, msg: 'Missing <!DOCTYPE html> (browser will use quirks mode)', type: 'warning' });
      if (hasHead && !hasTitle) errors.push({ line: 1 + off, msg: 'Document has no <title>', type: 'warning' });
      if (hasHead && !hasCharset) errors.push({ line: 1 + off, msg: 'Missing <meta charset="UTF-8">', type: 'info' });
    }
    return errors;
  }

  function lintPython(code) {
    var errors = [], lines = code.split('\n'), logical = [], depthStack = [], triple = null, tripleLine = 0, cont = false, cur = null;
    var openers = { '(': ')', '[': ']', '{': '}' }, closers = { ')': '(', ']': '[', '}': '{' };
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i], j = 0, text = '', colon0 = false, startNew = !triple && !depthStack.length && !cont;
      cont = false;
      if (triple) {
        var ce = line.indexOf(triple);
        if (ce === -1) continue;
        j = ce + 3; triple = null; text = '0';
      }
      if (startNew) {
        if (!line.trim() || /^\s*#/.test(line)) continue;
        cur = { line: i + 1, indentRaw: /^[ \t]*/.exec(line)[0], text: '', colon0: false, lastChar: '' };
        logical.push(cur);
      }
      while (j < line.length) {
        var c = line.charAt(j);
        if (c === '#') break;
        var sm = /^(?:[rRbBuUfF]{1,2})?('''|"""|'|")/.exec(line.slice(j, j + 5));
        if (sm && !/\w/.test(line.charAt(j - 1) || ' ')) {
          var q = sm[1], k = j + sm[0].length;
          if (q.length === 3) {
            var ce2 = line.indexOf(q, k);
            if (ce2 === -1) { triple = q; tripleLine = i + 1; j = line.length; text += '0'; break; }
            j = ce2 + 3; text += '0'; continue;
          }
          var closed = false;
          while (k < line.length) {
            var ch = line.charAt(k);
            if (ch === '\\') { k += 2; continue; }
            if (ch === q) { closed = true; k++; break; }
            k++;
          }
          if (!closed && line.charAt(line.length - 1) !== '\\') errors.push({ line: i + 1, msg: 'Unterminated string literal', type: 'error' });
          j = k; text += '0'; continue;
        }
        if (openers[c]) depthStack.push({ c: c, line: i + 1 });
        else if (closers[c]) {
          var top = depthStack.pop();
          if (!top) errors.push({ line: i + 1, msg: "Unmatched '" + c + "'", type: 'error' });
          else if (top.c !== closers[c]) errors.push({ line: i + 1, msg: "Closing '" + c + "' does not match '" + top.c + "' from line " + top.line, type: 'error' });
        } else if (c === ':' && !depthStack.length && line.charAt(j + 1) !== '=') colon0 = true;
        text += depthStack.length && !openers[c] ? ' ' : c;
        j++;
      }
      if (cur) {
        cur.text += text; if (colon0) cur.colon0 = true;
        var trimmed = line.replace(/#.*$/, '').trimRight();
        if (/\\$/.test(line)) cont = true;
        cur.lastChar = trimmed.charAt(trimmed.length - 1) || cur.lastChar;
        cur.endLine = i + 1;
      }
    }
    if (triple) errors.push({ line: tripleLine, msg: 'Unterminated triple-quoted string', type: 'error' });
    depthStack.forEach(function (d) { errors.push({ line: d.line, msg: "Unclosed '" + d.c + "'", type: 'error' }); });

    var stack = [0], prev = null;
    function width(ws) { var w = 0; for (var t = 0; t < ws.length; t++) w = ws.charAt(t) === '\t' ? (Math.floor(w / 8) + 1) * 8 : w + 1; return w; }
    logical.forEach(function (lg) {
      var t = lg.text.trim(), w = width(lg.indentRaw);
      if (/ \t|\t /.test(lg.indentRaw) || (/\t/.test(lg.indentRaw) && / /.test(lg.indentRaw))) errors.push({ line: lg.line, msg: 'Inconsistent use of tabs and spaces in indentation', type: 'error' });
      if (prev) {
        var prevOpens = prev.lastChar === ':';
        if (w > stack[stack.length - 1]) {
          if (!prevOpens) errors.push({ line: lg.line, msg: 'Unexpected indent', type: 'error' });
          stack.push(w);
        } else {
          if (prevOpens) errors.push({ line: prev.line, msg: "Expected an indented block after ':'", type: 'error' });
          while (stack.length > 1 && w < stack[stack.length - 1]) stack.pop();
          if (w !== stack[stack.length - 1]) { errors.push({ line: lg.line, msg: 'Unindent does not match any outer indentation level', type: 'error' }); stack.push(w); }
        }
      } else if (w > 0) errors.push({ line: lg.line, msg: 'Unexpected indent', type: 'error' });
      var kw = /^(if|elif|else|while|for|with|def|class|try|except|finally|async\s+def|async\s+for|async\s+with)\b/.exec(t);
      if (kw && !lg.colon0) errors.push({ line: lg.line, msg: "Expected ':' at the end of '" + kw[1] + "' statement", type: 'error' });
      if (/^(if|elif|while)\b/.test(t)) {
        var flat = t.replace(/==|!=|<=|>=|:=|\+=|-=|\*=|\/=|%=|&=|\|=|\^=/g, '  ');
        if (/^(if|elif|while)\b[^=]*=[^=]/.test(flat)) errors.push({ line: lg.line, msg: "Invalid syntax: use '==' to compare, '=' assigns", type: 'error' });
      }
      if (/^print\s+[^(=\s]/.test(t)) errors.push({ line: lg.line, msg: "Python 3 requires print(...) with parentheses", type: 'warning' });
      prev = lg;
    });
    if (prev && prev.lastChar === ':') errors.push({ line: prev.line, msg: "Expected an indented block after ':'", type: 'error' });
    return errors;
  }

  function lintYAML(code) {
    var errors = [], lines = code.split('\n'), levels = [], blockIndent = -1;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!line.trim() || /^\s*#/.test(line)) continue;
      var indentStr = /^[ \t]*/.exec(line)[0], indent = indentStr.length;
      if (blockIndent !== -1) { if (indent > blockIndent) continue; blockIndent = -1; }
      if (/\t/.test(indentStr)) { errors.push({ line: i + 1, msg: 'YAML forbids tab characters for indentation', type: 'error' }); continue; }
      var km = /^(\s*)(?:-\s+)?("[^"]*"|'[^']*'|[^\s:#'"\[{][^:#]*?)\s*:(?:\s+(.*))?$/.exec(line.replace(/\s+#.*$/, ''));
      var valuePart = km ? (km[3] || '') : '';
      if (km) {
        var keyIndent = line.indexOf(km[2], km[1].length), key = km[2].replace(/^["']|["']$/g, '');
        while (levels.length && levels[levels.length - 1].indent > keyIndent) levels.pop();
        if (!levels.length || levels[levels.length - 1].indent < keyIndent) levels.push({ indent: keyIndent, keys: {} });
        var lv = levels[levels.length - 1];
        if (/^\s*-\s/.test(line)) lv.keys = {};
        if (lv.keys[key]) errors.push({ line: i + 1, msg: "Duplicate key '" + key + "' (first on line " + lv.keys[key] + ')', type: 'error' });
        else lv.keys[key] = i + 1;
        if (/^[|>][+-]?\d*$/.test(valuePart.trim())) blockIndent = indent;
      } else if (!/^\s*-(\s|$)/.test(line) && indent === 0 && !/^(---|\.\.\.)/.test(line.trim()) && !/^[\[{"']/.test(line.trim())) {
        errors.push({ line: i + 1, msg: "Expected 'key: value' mapping or '- ' list item", type: 'warning' });
      }
      var vv = valuePart.trim();
      if (/^"/.test(vv) && !/^"(?:[^"\\]|\\.)*"\s*$/.test(vv)) errors.push({ line: i + 1, msg: 'Unterminated double-quoted string', type: 'error' });
      if (/^'/.test(vv) && !/^'(?:[^']|'')*'\s*$/.test(vv)) errors.push({ line: i + 1, msg: 'Unterminated single-quoted string', type: 'error' });
    }
    return errors;
  }

  function lint(code, lang, ctx) {
    ctx = ctx || {};
    if (code.length > 600000) return [{ line: 1, msg: 'File is too large for live linting', type: 'info' }];
    ctx.lang = lang;
    var out;
    try {
      switch (lang) {
        case 'js': case 'ts': out = lintJS(code, ctx); break;
        case 'json': out = lintJSON(code, ctx); break;
        case 'css': out = ctx.path && /\.(scss|less)$/i.test(ctx.path) ? checkBrackets(L.blankNonCode(code, L.scanCSS(code)), 0) : lintCSS(code, ctx); break;
        case 'html': out = lintHTML(code, ctx); break;
        case 'xml': out = lintHTML(code, { xml: true }); break;
        case 'python': out = lintPython(code); break;
        case 'yaml': out = lintYAML(code); break;
        default: out = [];
      }
    } catch (e) {
      out = [{ line: 1, msg: 'Linter crashed: ' + e.message, type: 'info' }];
    }
    out.sort(function (a, b) { return a.line - b.line; });
    var seen = {};
    return out.filter(function (e) { var k = e.line + '|' + e.msg; if (seen[k]) return false; seen[k] = true; return true; }).slice(0, 200);
  }

  var api = { lint: lint, lintJS: lintJS, lintHTML: lintHTML, lintCSS: lintCSS, lintJSON: lintJSON, lintPython: lintPython, lintYAML: lintYAML, CSS_PROPS: CSS_PROPS, suggest: suggest, resolveRef: resolveRef };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DSLint = api;
})(typeof window !== 'undefined' ? window : globalThis);
