(function (root) {
  'use strict';

  function set(s) { var o = Object.create(null); s.split(' ').forEach(function (w) { o[w] = true; }); return o; }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function extOf(path) { var m = /\.([A-Za-z0-9]+)$/.exec(path || ''); return m ? m[1].toLowerCase() : ''; }
  function baseName(path) { return String(path || '').split('/').pop(); }

  var LANG_BY_EXT = {
    html: 'html', htm: 'html', xhtml: 'html', vue: 'html', css: 'css', scss: 'css', less: 'css',
    js: 'js', mjs: 'js', cjs: 'js', jsx: 'js', ts: 'ts', tsx: 'ts', json: 'json', webmanifest: 'json', map: 'json',
    py: 'python', md: 'md', markdown: 'md', yml: 'yaml', yaml: 'yaml', xml: 'xml', svg: 'xml',
    sh: 'sh', bash: 'sh', zsh: 'sh', env: 'sh', gitignore: 'sh', txt: 'txt'
  };
  var IMAGE_EXT = set('png jpg jpeg gif webp bmp ico avif svg');
  var BINARY_EXT = set('png jpg jpeg gif webp bmp ico avif pdf zip woff woff2 ttf otf eot mp3 mp4 webm ogg wav mov');
  var MIME = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon',
    avif: 'image/avif', svg: 'image/svg+xml', pdf: 'application/pdf', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
    mp3: 'audio/mpeg', mp4: 'video/mp4', webm: 'video/webm', ogg: 'audio/ogg', wav: 'audio/wav', html: 'text/html', css: 'text/css',
    js: 'text/javascript', mjs: 'text/javascript', json: 'application/json', txt: 'text/plain', md: 'text/markdown', xml: 'application/xml'
  };

  function langOf(path) {
    var name = baseName(path).toLowerCase();
    if (name === '.gitignore' || name === '.env' || name === 'dockerfile' || name === 'makefile') return 'sh';
    return LANG_BY_EXT[extOf(path)] || 'txt';
  }
  function mimeOf(path) { return MIME[extOf(path)] || 'application/octet-stream'; }
  function isBinaryPath(path) { return !!BINARY_EXT[extOf(path)]; }
  function isImagePath(path) { return !!IMAGE_EXT[extOf(path)]; }

  var JS_KW = set('break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new return super switch this throw try typeof var void while with yield async await static of from as enum');
  var TS_KW = set('interface type implements namespace declare readonly abstract private protected public keyof infer is satisfies');
  var JS_CONST = set('true false null undefined NaN Infinity');
  var JS_BUILTIN = set('window document console Math JSON Object Array String Number Boolean Date RegExp Map Set WeakMap WeakSet Promise Symbol Error TypeError RangeError Intl Proxy Reflect localStorage sessionStorage navigator location history fetch setTimeout setInterval clearTimeout clearInterval requestAnimationFrame parseInt parseFloat isNaN encodeURIComponent decodeURIComponent structuredClone globalThis URL URLSearchParams FormData Blob File FileReader');
  var REGEX_AFTER_KW = set('return typeof instanceof in of new delete void throw case do else yield await');
  var REGEX_AFTER_CHAR = '(,=:[!&|?{};+-*%<>~^';

  function scanTemplate(code, i) {
    var n = code.length, j = i + 1;
    while (j < n) {
      var c = code.charAt(j);
      if (c === '\\') { j += 2; continue; }
      if (c === '`') return j + 1;
      if (c === '$' && code.charAt(j + 1) === '{') {
        var k = j + 2, d = 1;
        while (k < n && d > 0) {
          var ch = code.charAt(k);
          if (ch === '"' || ch === "'") { k = scanQuoted(code, k); continue; }
          if (ch === '`') { k = scanTemplate(code, k); continue; }
          if (ch === '{') d++;
          else if (ch === '}') d--;
          k++;
        }
        j = k; continue;
      }
      j++;
    }
    return n;
  }

  function scanQuoted(code, i) {
    var q = code.charAt(i), n = code.length, j = i + 1;
    while (j < n) {
      var c = code.charAt(j);
      if (c === '\\') { j += 2; continue; }
      if (c === q) return j + 1;
      if (c === '\n') return j;
      j++;
    }
    return n;
  }

  function scanJS(code, ts) {
    var tokens = [], n = code.length, i = 0, prev = '', numRe = /0[xX][\da-fA-F_]+n?|0[bB][01_]+n?|0[oO][0-7_]+n?|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?n?/y;
    function push(t, s, e) { tokens.push({ t: t, s: s, e: e }); }
    while (i < n) {
      var c = code.charAt(i);
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
      if (c === '/' && code.charAt(i + 1) === '/') {
        var eol = code.indexOf('\n', i); if (eol === -1) eol = n;
        push('comment', i, eol); i = eol; continue;
      }
      if (c === '/' && code.charAt(i + 1) === '*') {
        var end = code.indexOf('*/', i + 2); end = end === -1 ? n : end + 2;
        push('comment', i, end); i = end; continue;
      }
      if (c === '"' || c === "'") { var qe = scanQuoted(code, i); push('string', i, qe); i = qe; prev = 'str'; continue; }
      if (c === '`') { var te = scanTemplate(code, i); push('string', i, te); i = te; prev = 'str'; continue; }
      if ((c >= '0' && c <= '9') || (c === '.' && /\d/.test(code.charAt(i + 1)))) {
        numRe.lastIndex = i; var nm = numRe.exec(code);
        if (nm) { push('number', i, i + nm[0].length); i += nm[0].length; prev = 'num'; continue; }
      }
      if (/[A-Za-z_$\u00a0-\uffff]/.test(c)) {
        var j = i + 1;
        while (j < n && /[\w$\u00a0-\uffff]/.test(code.charAt(j))) j++;
        var word = code.slice(i, j), k = j;
        while (k < n && (code.charAt(k) === ' ' || code.charAt(k) === '\t')) k++;
        var isCall = code.charAt(k) === '(', afterDot = prev === '.';
        if (afterDot) push(isCall ? 'func' : 'prop', i, j);
        else if (JS_KW[word] || (ts && TS_KW[word])) push('keyword', i, j);
        else if (JS_CONST[word]) push('const', i, j);
        else if (JS_BUILTIN[word]) push('builtin', i, j);
        else if (isCall) push('func', i, j);
        else if (/^[A-Z][a-zA-Z0-9]*$/.test(word) && word.length > 1) push('type', i, j);
        prev = (!afterDot && JS_KW[word]) ? 'kw:' + word : 'id';
        i = j; continue;
      }
      if (c === '/') {
        var allowed = prev === '' || (prev.length === 1 && REGEX_AFTER_CHAR.indexOf(prev) !== -1) || (prev.indexOf('kw:') === 0 && REGEX_AFTER_KW[prev.slice(3)]);
        if (allowed) {
          var r = i + 1, inClass = false, ok = false;
          while (r < n) {
            var rc = code.charAt(r);
            if (rc === '\n') break;
            if (rc === '\\') { r += 2; continue; }
            if (rc === '[') inClass = true;
            else if (rc === ']') inClass = false;
            else if (rc === '/' && !inClass) { ok = true; break; }
            r++;
          }
          if (ok) {
            r++;
            while (r < n && /[a-z]/.test(code.charAt(r))) r++;
            push('regex', i, r); i = r; prev = 'rx'; continue;
          }
        }
      }
      prev = c; i++;
    }
    return tokens;
  }

  function scanJSON(code) {
    var tokens = [], re = /("(?:[^"\\\n]|\\.)*"?)(\s*:)?|(-?\d+\.?\d*(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))/g, m;
    while ((m = re.exec(code)) !== null) {
      if (m[1] !== undefined) tokens.push({ t: m[2] ? 'prop' : 'string', s: m.index, e: m.index + m[1].length });
      else if (m[3] !== undefined) tokens.push({ t: 'number', s: m.index, e: m.index + m[0].length });
      else if (m[4] !== undefined) tokens.push({ t: 'const', s: m.index, e: m.index + m[0].length });
      else if (m[5] !== undefined) tokens.push({ t: 'comment', s: m.index, e: m.index + m[0].length });
      if (m[0].length === 0) re.lastIndex++;
    }
    return tokens;
  }

  var CSS_FUNC = /^[a-z-]+(?=\()/i;
  function scanCSS(code) {
    var tokens = [], n = code.length, i = 0, depth = 0, stmtStart = true;
    function push(t, s, e) { tokens.push({ t: t, s: s, e: e }); }
    while (i < n) {
      var c = code.charAt(i);
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
      if (c === '/' && code.charAt(i + 1) === '*') {
        var end = code.indexOf('*/', i + 2); end = end === -1 ? n : end + 2; push('comment', i, end); i = end; continue;
      }
      if (c === '"' || c === "'") { var qe = scanQuoted(code, i); push('string', i, qe); i = qe; stmtStart = false; continue; }
      if (c === '{') { depth++; stmtStart = true; i++; continue; }
      if (c === '}') { depth = Math.max(0, depth - 1); stmtStart = true; i++; continue; }
      if (c === ';') { stmtStart = true; i++; continue; }
      if (stmtStart) {
        if (c === '@') {
          var am = /^@[\w-]+/.exec(code.slice(i, i + 40));
          if (am) { push('at', i, i + am[0].length); i += am[0].length; stmtStart = false; continue; }
        }
        var rest = code.slice(i, i + 2000), stop = rest.search(/[{;}]/);
        var kind = stop === -1 ? '' : rest.charAt(stop);
        var pm = /^(--[\w-]+|-?[a-zA-Z][\w-]*)\s*:/.exec(rest);
        if (depth > 0 && kind !== '{' && pm) {
          push('prop', i, i + pm[1].length); i += pm[0].length; stmtStart = false; continue;
        }
        if (kind === '{' || depth === 0) {
          var selEnd = stop === -1 ? n : i + stop, k = i;
          while (k < selEnd) {
            var ch = code.charAt(k);
            if (ch === '/' && code.charAt(k + 1) === '*') { var ce = code.indexOf('*/', k + 2); ce = ce === -1 ? selEnd : Math.min(ce + 2, selEnd); push('comment', k, ce); k = ce; continue; }
            if (ch === '"' || ch === "'") { var se = scanQuoted(code, k); push('string', k, se); k = se; continue; }
            var sm = /^(?:[.#][\w-]+|::?[\w-]+(?:\([^)]*\))?|\[[^\]]*\]|[a-zA-Z][\w-]*|\*)/.exec(code.slice(k, selEnd));
            if (sm) { var cls = ch === ':' ? 'builtin' : (ch === '.' || ch === '#' ? 'type' : (ch === '[' ? 'attr' : 'tag')); push(cls, k, k + sm[0].length); k += sm[0].length; }
            else k++;
          }
          i = selEnd; stmtStart = false; continue;
        }
      }
      var num = /^-?(?:\d+\.?\d*|\.\d+)(?:%|[a-zA-Z]{1,4})?/.exec(code.slice(i, i + 24));
      if (num && !/[\w-]/.test(code.charAt(i - 1) || ' ')) { push('number', i, i + num[0].length); i += num[0].length; continue; }
      if (c === '#') {
        var hm = /^#[0-9a-fA-F]{3,8}\b/.exec(code.slice(i, i + 10));
        if (hm) { push('number', i, i + hm[0].length); i += hm[0].length; continue; }
      }
      if (/[a-zA-Z-]/.test(c)) {
        var wm = /^[a-zA-Z-][\w-]*/.exec(code.slice(i, i + 80));
        var after = code.charAt(i + wm[0].length);
        if (after === '(') push('func', i, i + wm[0].length);
        else if (/^(important|inherit|initial|unset|none|auto|solid|flex|grid|block|inline|absolute|relative|fixed|sticky|center|bold|normal|transparent)$/.test(wm[0])) push('const', i, i + wm[0].length);
        i += wm[0].length; continue;
      }
      i++;
    }
    return tokens;
  }

  var PY_KW = set('and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case');
  var PY_CONST = set('None True False self cls');
  var PY_BUILTIN = set('print len range int str float list dict set tuple bool type isinstance open input sum min max abs sorted enumerate zip map filter any all super object Exception ValueError TypeError KeyError IndexError');

  function scanPython(code) {
    var tokens = [], n = code.length, i = 0, prevWord = '';
    function push(t, s, e) { tokens.push({ t: t, s: s, e: e }); }
    while (i < n) {
      var c = code.charAt(i);
      if (c === '#') { var eol = code.indexOf('\n', i); if (eol === -1) eol = n; push('comment', i, eol); i = eol; continue; }
      var sm = /^(?:[rRbBuUfF]{1,2})?('''|"""|'|")/.exec(code.slice(i, i + 5));
      if (sm && (i === 0 || !/[\w]/.test(code.charAt(i - 1)) || /^[rRbBuUfF]/.test(sm[0]) === false)) {
        var q = sm[1], start = i, j = i + sm[0].length;
        if (q.length === 3) { var ce = code.indexOf(q, j); j = ce === -1 ? n : ce + 3; }
        else {
          while (j < n) {
            var ch = code.charAt(j);
            if (ch === '\\') { j += 2; continue; }
            if (ch === q) { j++; break; }
            if (ch === '\n') break;
            j++;
          }
        }
        push('string', start, Math.min(j, n)); i = Math.min(j, n); prevWord = ''; continue;
      }
      if (c === '@' && /^\s*$/.test(code.slice(code.lastIndexOf('\n', i - 1) + 1, i))) {
        var dm = /^@[\w.]+/.exec(code.slice(i, i + 80)); if (dm) { push('at', i, i + dm[0].length); i += dm[0].length; continue; }
      }
      if (/\d/.test(c) && !/[\w]/.test(code.charAt(i - 1) || ' ')) {
        var nm = /^(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*\.?[\d_]*(?:[eE][+-]?\d+)?j?)/.exec(code.slice(i, i + 40));
        if (nm) { push('number', i, i + nm[0].length); i += nm[0].length; continue; }
      }
      if (/[A-Za-z_]/.test(c)) {
        var k = i + 1; while (k < n && /\w/.test(code.charAt(k))) k++;
        var word = code.slice(i, k), prevDot = code.charAt(i - 1) === '.', next = code.charAt(k);
        if (prevWord === 'def' || prevWord === 'class') push(prevWord === 'def' ? 'func' : 'type', i, k);
        else if (!prevDot && PY_KW[word]) push('keyword', i, k);
        else if (!prevDot && PY_CONST[word]) push('const', i, k);
        else if (!prevDot && PY_BUILTIN[word]) push('builtin', i, k);
        else if (next === '(') push('func', i, k);
        prevWord = word; i = k; continue;
      }
      if (c !== ' ' && c !== '\t') prevWord = '';
      i++;
    }
    return tokens;
  }

  function scanLines(code, fn) {
    var tokens = [], pos = 0, lines = code.split('\n'), state = { inFence: false };
    for (var l = 0; l < lines.length; l++) {
      fn(lines[l], pos, tokens, state);
      pos += lines[l].length + 1;
    }
    return tokens;
  }

  function scanMarkdown(code) {
    return scanLines(code, function (line, pos, out, st) {
      var end = pos + line.length;
      if (/^\s*(```|~~~)/.test(line)) { st.inFence = !st.inFence; out.push({ t: 'comment', s: pos, e: end }); return; }
      if (st.inFence) { out.push({ t: 'string', s: pos, e: end }); return; }
      var h = /^(#{1,6})\s/.exec(line);
      if (h) { out.push({ t: 'keyword', s: pos, e: end }); return; }
      if (/^\s*>/.test(line)) { out.push({ t: 'comment', s: pos, e: end }); return; }
      var lm = /^(\s*(?:[-*+]|\d+\.)\s)/.exec(line);
      if (lm) out.push({ t: 'number', s: pos, e: pos + lm[1].length });
      var re = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\[[^\]\n]*\]\([^)\n]*\))/g, m;
      while ((m = re.exec(line)) !== null) out.push({ t: m[1] ? 'string' : (m[2] ? 'type' : 'func'), s: pos + m.index, e: pos + m.index + m[0].length });
    });
  }

  function scanYAML(code) {
    return scanLines(code, function (line, pos, out) {
      var cm = /(^|\s)#.*$/.exec(line), body = cm ? line.slice(0, cm.index + cm[1].length) : line;
      if (cm) out.push({ t: 'comment', s: pos + cm.index + cm[1].length, e: pos + line.length });
      var km = /^(\s*(?:-\s+)?)([^\s:#'"][^:#]*?|"[^"]*"|'[^']*')\s*:(?=\s|$)/.exec(body), valStart = 0;
      if (km) { out.push({ t: 'prop', s: pos + km[1].length, e: pos + km[1].length + km[2].length }); valStart = km[0].length; }
      var val = body.slice(valStart), vm;
      if ((vm = /^\s*("(?:[^"\\]|\\.)*"|'[^']*')/.exec(val))) out.push({ t: 'string', s: pos + valStart + vm[0].length - vm[1].length, e: pos + valStart + vm[0].length });
      else if ((vm = /^\s*(-?\d+\.?\d*)\s*$/.exec(val))) out.push({ t: 'number', s: pos + valStart + vm[0].indexOf(vm[1]), e: pos + valStart + vm[0].indexOf(vm[1]) + vm[1].length });
      else if ((vm = /^\s*(true|false|null|yes|no|~)\s*$/i.exec(val))) out.push({ t: 'const', s: pos + valStart + vm[0].indexOf(vm[1]), e: pos + valStart + vm[0].indexOf(vm[1]) + vm[1].length });
    });
  }

  function scanShell(code) {
    var tokens = [], re = /(#[^\n]*)|("(?:[^"\\]|\\.)*"|'[^']*')|(\$\{?[\w@#?*!-]+\}?)|\b(if|then|else|elif|fi|for|while|do|done|case|esac|function|return|export|local|in|echo|cd|exit)\b/g, m;
    while ((m = re.exec(code)) !== null) {
      if (m[1] !== undefined && (m.index === 0 || /[\s;]/.test(code.charAt(m.index - 1)))) tokens.push({ t: 'comment', s: m.index, e: m.index + m[0].length });
      else if (m[2] !== undefined) tokens.push({ t: 'string', s: m.index, e: m.index + m[0].length });
      else if (m[3] !== undefined) tokens.push({ t: 'const', s: m.index, e: m.index + m[0].length });
      else if (m[4] !== undefined) tokens.push({ t: 'keyword', s: m.index, e: m.index + m[0].length });
    }
    return tokens;
  }

  var VOID = set('area base br col embed hr img input link meta param source track wbr');
  var RAW = set('script style textarea title');

  function parseHTML(code) {
    var nodes = [], n = code.length, i = 0;
    while (i < n) {
      if (code.charAt(i) !== '<') {
        var nx = code.indexOf('<', i); if (nx === -1) nx = n;
        i = nx; continue;
      }
      if (code.substr(i, 4) === '<!--') {
        var ce = code.indexOf('-->', i + 4), stop = ce === -1 ? n : ce + 3;
        nodes.push({ type: 'comment', s: i, e: stop, unterminated: ce === -1 }); i = stop; continue;
      }
      if (code.charAt(i + 1) === '!' || code.charAt(i + 1) === '?') {
        var de = code.indexOf('>', i); de = de === -1 ? n : de + 1;
        nodes.push({ type: 'doctype', s: i, e: de, text: code.slice(i, de) }); i = de; continue;
      }
      var tm = /^<(\/?)([A-Za-z][\w:.-]*)/.exec(code.slice(i, i + 80));
      if (!tm) { i++; continue; }
      var node = { type: tm[1] ? 'close' : 'open', name: tm[2].toLowerCase(), s: i, nameS: i + 1 + tm[1].length, nameE: i + tm[0].length, attrs: [], selfClose: false, unterminated: false };
      var j = node.nameE, closed = false;
      while (j < n) {
        var ch = code.charAt(j);
        if (ch === '>') { closed = true; j++; break; }
        if (ch === '/' && code.charAt(j + 1) === '>') { node.selfClose = true; closed = true; j += 2; break; }
        if (/\s|\//.test(ch)) { j++; continue; }
        var am = /^[^\s"'<>\/=]+/.exec(code.slice(j, j + 200));
        if (!am) { j++; continue; }
        var attr = { name: am[0].toLowerCase(), ns: j, ne: j + am[0].length, value: null, vs: -1, ve: -1 };
        j += am[0].length;
        var k = j; while (k < n && /\s/.test(code.charAt(k))) k++;
        if (code.charAt(k) === '=') {
          k++; while (k < n && /\s/.test(code.charAt(k))) k++;
          var q = code.charAt(k);
          if (q === '"' || q === "'") {
            var qe = code.indexOf(q, k + 1);
            if (qe === -1) { attr.value = code.slice(k + 1); attr.vs = k; attr.ve = n; j = n; node.unterminated = true; node.attrs.push(attr); break; }
            attr.value = code.slice(k + 1, qe); attr.vs = k; attr.ve = qe + 1; j = qe + 1;
          } else {
            var um = /^[^\s>]+/.exec(code.slice(k, k + 500)); var ul = um ? um[0].length : 0;
            attr.value = um ? um[0] : ''; attr.vs = k; attr.ve = k + ul; j = k + ul;
          }
        }
        node.attrs.push(attr);
      }
      if (!closed) node.unterminated = true;
      node.e = j;
      nodes.push(node);
      i = j;
      if (node.type === 'open' && RAW[node.name] && !node.selfClose) {
        var closeRe = new RegExp('</' + node.name + '\\b', 'i'), tail = code.slice(i), cm = closeRe.exec(tail);
        var rawEnd = cm ? i + cm.index : n;
        nodes.push({ type: 'raw', name: node.name, s: i, e: rawEnd, attrs: node.attrs });
        i = rawEnd;
      }
    }
    return nodes;
  }

  function rawLang(node) {
    if (node.name === 'style') return 'css';
    if (node.name !== 'script') return null;
    var type = '';
    node.attrs.forEach(function (a) { if (a.name === 'type') type = (a.value || '').toLowerCase(); });
    if (!type || type === 'module' || /javascript|ecmascript|babel|jsx/.test(type)) return 'js';
    if (/json/.test(type)) return 'json';
    return null;
  }

  function scanHTML(code) {
    var tokens = [], nodes = parseHTML(code);
    nodes.forEach(function (nd) {
      if (nd.type === 'comment') tokens.push({ t: 'comment', s: nd.s, e: nd.e });
      else if (nd.type === 'doctype') tokens.push({ t: 'doctype', s: nd.s, e: nd.e });
      else if (nd.type === 'open' || nd.type === 'close') {
        tokens.push({ t: 'tag', s: nd.s, e: nd.nameE });
        nd.attrs.forEach(function (a) {
          tokens.push({ t: 'attr', s: a.ns, e: a.ne });
          if (a.vs !== -1) tokens.push({ t: 'string', s: a.vs, e: a.ve });
        });
        var tail = nd.e - (nd.selfClose ? 2 : 1);
        if (!nd.unterminated) tokens.push({ t: 'tag', s: tail, e: nd.e });
      } else if (nd.type === 'raw') {
        var lang = rawLang(nd);
        if (lang) {
          var sub = lang === 'js' ? scanJS(code.slice(nd.s, nd.e)) : (lang === 'css' ? scanCSS(code.slice(nd.s, nd.e)) : scanJSON(code.slice(nd.s, nd.e)));
          sub.forEach(function (tk) { tokens.push({ t: tk.t, s: tk.s + nd.s, e: tk.e + nd.s }); });
        }
      }
    });
    tokens.sort(function (a, b) { return a.s - b.s; });
    return tokens;
  }

  function scanXML(code) {
    var tokens = [], nodes = parseHTML(code);
    nodes.forEach(function (nd) {
      if (nd.type === 'comment') tokens.push({ t: 'comment', s: nd.s, e: nd.e });
      else if (nd.type === 'doctype') tokens.push({ t: 'doctype', s: nd.s, e: nd.e });
      else if (nd.type === 'open' || nd.type === 'close') {
        tokens.push({ t: 'tag', s: nd.s, e: nd.nameE });
        nd.attrs.forEach(function (a) { tokens.push({ t: 'attr', s: a.ns, e: a.ne }); if (a.vs !== -1) tokens.push({ t: 'string', s: a.vs, e: a.ve }); });
        if (!nd.unterminated) tokens.push({ t: 'tag', s: nd.e - (nd.selfClose ? 2 : 1), e: nd.e });
      }
    });
    return tokens;
  }

  function scan(code, lang) {
    switch (lang) {
      case 'js': return scanJS(code, false);
      case 'ts': return scanJS(code, true);
      case 'html': return scanHTML(code);
      case 'xml': return scanXML(code);
      case 'css': return scanCSS(code);
      case 'json': return scanJSON(code);
      case 'python': return scanPython(code);
      case 'md': return scanMarkdown(code);
      case 'yaml': return scanYAML(code);
      case 'sh': return scanShell(code);
      default: return [];
    }
  }

  function highlight(code, lang) {
    if (!code) return '';
    var tokens = scan(code, lang), out = [], last = 0;
    for (var i = 0; i < tokens.length; i++) {
      var tk = tokens[i];
      if (tk.s < last || tk.e <= tk.s) continue;
      if (tk.s > last) out.push(esc(code.slice(last, tk.s)));
      out.push('<span class="tok-' + tk.t + '">' + esc(code.slice(tk.s, tk.e)) + '</span>');
      last = tk.e;
    }
    out.push(esc(code.slice(last)));
    return out.join('');
  }

  function blankNonCode(code, tokens) {
    var chars = code.split('');
    tokens.forEach(function (tk) {
      if (tk.t === 'comment' || tk.t === 'string' || tk.t === 'regex') {
        for (var i = tk.s; i < tk.e && i < chars.length; i++) if (chars[i] !== '\n') chars[i] = ' ';
      }
    });
    return chars.join('');
  }

  function lineOf(code, index) {
    var line = 1;
    for (var i = 0; i < index && i < code.length; i++) if (code.charCodeAt(i) === 10) line++;
    return line;
  }

  var api = {
    set: set, esc: esc, extOf: extOf, baseName: baseName, langOf: langOf, mimeOf: mimeOf, isBinaryPath: isBinaryPath, isImagePath: isImagePath,
    scan: scan, scanJS: scanJS, scanCSS: scanCSS, scanJSON: scanJSON, scanPython: scanPython, parseHTML: parseHTML, rawLang: rawLang,
    highlight: highlight, blankNonCode: blankNonCode, lineOf: lineOf, VOID: VOID, RAW: RAW, JS_KW: JS_KW, JS_BUILTIN: JS_BUILTIN, PY_KW: PY_KW, PY_BUILTIN: PY_BUILTIN
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DSLang = api;
})(typeof window !== 'undefined' ? window : globalThis);
