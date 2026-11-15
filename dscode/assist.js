(function (root) {
  'use strict';
  var L = root.DSLang || (typeof require !== 'undefined' ? require('./lang.js') : null);
  var X = root.DSLint || (typeof require !== 'undefined' ? require('./lint.js') : null);

  function words(s) { return s.split(' ').filter(Boolean); }

  var JS_SNIPPETS = {
    log: 'console.log($0);', fn: 'function name($0) {\n  \n}', afn: 'const name = async ($0) => {\n  \n};', arrow: 'const name = ($0) => {\n  \n};',
    for: 'for (let i = 0; i < $0; i++) {\n  \n}', forof: 'for (const item of $0) {\n  \n}', forin: 'for (const key in $0) {\n  \n}', foreach: '$0.forEach((item) => {\n  \n});',
    if: 'if ($0) {\n  \n}', ifelse: 'if ($0) {\n  \n} else {\n  \n}', try: 'try {\n  $0\n} catch (err) {\n  console.error(err);\n}', switch: 'switch ($0) {\n  case x:\n    break;\n  default:\n    break;\n}',
    class: 'class Name {\n  constructor($0) {\n  }\n}', fetch: 'const res = await fetch($0);\nif (!res.ok) throw new Error("HTTP " + res.status);\nconst data = await res.json();',
    qs: 'document.querySelector($0)', qsa: 'document.querySelectorAll($0)', gid: 'document.getElementById($0)', ael: 'addEventListener("click", ($0) => {\n  \n});',
    timeout: 'setTimeout(() => {\n  $0\n}, 1000);', interval: 'setInterval(() => {\n  $0\n}, 1000);', promise: 'new Promise((resolve, reject) => {\n  $0\n})',
    dom: 'document.addEventListener("DOMContentLoaded", () => {\n  $0\n});', imp: 'import { $0 } from "./module.js";', exp: 'export default $0;'
  };
  var PY_SNIPPETS = {
    def: 'def name($0):\n    ', class: 'class Name:\n    def __init__(self$0):\n        ', main: 'if __name__ == "__main__":\n    $0', for: 'for i in range($0):\n    ',
    forin: 'for item in $0:\n    ', if: 'if $0:\n    ', ifelse: 'if $0:\n    \nelse:\n    ', try: 'try:\n    $0\nexcept Exception as e:\n    print(e)', with: 'with open($0) as f:\n    ',
    lc: '[$0 for x in items]', imp: 'import $0', from: 'from $0 import '
  };

  var JS_MEMBERS = {
    document: words('getElementById() querySelector() querySelectorAll() createElement() createTextNode() createDocumentFragment() getElementsByClassName() getElementsByTagName() addEventListener() body head title documentElement cookie forms images readyState activeElement'),
    console: words('log() error() warn() info() table() time() timeEnd() group() groupEnd() assert() clear() dir() count()'),
    Math: words('abs() ceil() floor() round() max() min() pow() sqrt() cbrt() random() trunc() sign() hypot() sin() cos() tan() atan2() log() log2() log10() PI E'),
    JSON: words('stringify() parse()'),
    Object: words('keys() values() entries() assign() freeze() fromEntries() create() defineProperty() getPrototypeOf() hasOwn() is()'),
    Array: words('isArray() from() of()'),
    Promise: words('all() allSettled() race() any() resolve() reject()'),
    Number: words('isInteger() isFinite() isNaN() parseFloat() parseInt() MAX_SAFE_INTEGER MIN_SAFE_INTEGER EPSILON'),
    String: words('fromCharCode() fromCodePoint() raw()'),
    Date: words('now() parse() UTC()'),
    localStorage: words('getItem() setItem() removeItem() clear() key() length'),
    sessionStorage: words('getItem() setItem() removeItem() clear() key() length'),
    window: words('addEventListener() removeEventListener() innerWidth innerHeight scrollTo() open() close() location history localStorage sessionStorage matchMedia() requestAnimationFrame() getComputedStyle() postMessage()'),
    navigator: words('clipboard userAgent language onLine geolocation serviceWorker'),
    location: words('href origin pathname search hash reload() assign() replace()'),
    Intl: words('DateTimeFormat() NumberFormat() Collator() RelativeTimeFormat()')
  };
  var GENERIC_MEMBERS = words('map() filter() reduce() forEach() find() findIndex() findLast() some() every() includes() indexOf() lastIndexOf() slice() splice() push() pop() shift() unshift() join() sort() reverse() concat() flat() flatMap() fill() at() keys() values() entries() length split() trim() trimStart() trimEnd() toUpperCase() toLowerCase() replace() replaceAll() startsWith() endsWith() padStart() padEnd() repeat() match() matchAll() localeCompare() charAt() charCodeAt() substring() addEventListener() removeEventListener() classList querySelector() querySelectorAll() getAttribute() setAttribute() removeAttribute() appendChild() append() prepend() remove() closest() contains() innerHTML textContent innerText style value checked disabled children parentElement parentNode firstChild lastChild nextElementSibling previousElementSibling dataset focus() blur() click() getBoundingClientRect() scrollIntoView() then() catch() finally() toString() toFixed() toLocaleString() has() get() set() delete() add() clear() size json() text() blob() ok status');

  var HTML_TAGS = words('a abbr address article aside audio b blockquote body br button canvas caption code col colgroup dd details dialog div dl dt em fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 head header hr html i iframe img input label legend li link main mark menu meta nav noscript ol optgroup option output p picture pre progress script section select small source span strong style sub summary sup svg table tbody td template textarea tfoot th thead time title tr track u ul video');
  var TAGSET = L.set(HTML_TAGS.join(' '));
  var GLOBAL_ATTRS = words('class id style title lang hidden tabindex data- role aria-label aria-hidden contenteditable draggable dir spellcheck');
  var TAG_ATTRS = {
    a: words('href target rel download'), img: words('src alt width height loading srcset'), input: words('type name value placeholder required disabled checked min max step pattern autocomplete maxlength readonly autofocus'),
    button: words('type disabled name value'), form: words('action method enctype novalidate'), label: words('for'), link: words('rel href type media'), script: words('src defer async type crossorigin'),
    meta: words('name content charset property http-equiv'), select: words('name multiple required disabled'), option: words('value selected disabled'), textarea: words('name rows cols placeholder required maxlength'),
    video: words('src controls autoplay loop muted poster preload playsinline'), audio: words('src controls autoplay loop muted preload'), iframe: words('src sandbox allow loading allowfullscreen'), td: words('colspan rowspan'), th: words('colspan rowspan scope'),
    svg: words('viewBox xmlns width height fill'), canvas: words('width height'), source: words('src srcset type media'), ol: words('start type reversed')
  };
  var BOOL_ATTRS = L.set('hidden required disabled checked readonly autofocus multiple selected controls autoplay loop muted defer async novalidate playsinline allowfullscreen reversed contenteditable');
  var ATTR_VALUES = {
    type: words('text password email number tel url search date time datetime-local month week color range file checkbox radio submit reset button hidden module'),
    target: words('_blank _self _parent _top'), rel: words('stylesheet noopener noreferrer icon preload prefetch canonical'), loading: words('lazy eager'), method: words('get post'),
    autocomplete: words('on off email username current-password new-password'), preload: words('none metadata auto'), scope: words('row col rowgroup colgroup')
  };

  var CSS_VALUES = {
    display: words('block inline inline-block flex inline-flex grid inline-grid none contents table flow-root'), position: words('static relative absolute fixed sticky'),
    'flex-direction': words('row row-reverse column column-reverse'), 'flex-wrap': words('nowrap wrap wrap-reverse'),
    'justify-content': words('flex-start flex-end center space-between space-around space-evenly start end stretch'), 'align-items': words('stretch flex-start flex-end center baseline start end'),
    'align-self': words('auto stretch flex-start flex-end center baseline'), 'text-align': words('left right center justify start end'), 'text-decoration': words('none underline overline line-through'),
    'text-transform': words('none uppercase lowercase capitalize'), 'font-weight': words('normal bold bolder lighter 100 200 300 400 500 600 700 800 900'), 'font-style': words('normal italic oblique'),
    overflow: words('visible hidden scroll auto clip'), 'overflow-x': words('visible hidden scroll auto clip'), 'overflow-y': words('visible hidden scroll auto clip'),
    cursor: words('pointer default text move not-allowed grab grabbing wait crosshair help zoom-in zoom-out'), 'box-sizing': words('border-box content-box'), visibility: words('visible hidden collapse'),
    'white-space': words('normal nowrap pre pre-wrap pre-line break-spaces'), 'object-fit': words('fill contain cover none scale-down'), float: words('left right none'), clear: words('left right both none'),
    'pointer-events': words('auto none'), 'user-select': words('auto none text all'), 'background-repeat': words('repeat no-repeat repeat-x repeat-y'), 'background-size': words('auto cover contain'),
    'border-style': words('none solid dashed dotted double groove ridge inset outset'), 'list-style-type': words('none disc circle square decimal'), 'word-break': words('normal break-all keep-all break-word'),
    'scroll-behavior': words('auto smooth'), 'text-overflow': words('clip ellipsis'), 'vertical-align': words('baseline top middle bottom text-top text-bottom sub super'), 'place-items': words('center start end stretch'), 'place-content': words('center start end space-between space-around')
  };
  var CSS_COLORS = words('transparent currentColor black white red green blue yellow orange purple pink gray grey silver gold teal navy maroon lime aqua fuchsia olive coral crimson indigo violet tomato salmon khaki');
  var CSS_GENERIC_VALUES = words('inherit initial unset revert auto none 0 100% var() calc() min() max() clamp() rgb() rgba() hsl() hsla() url() linear-gradient() radial-gradient() !important');
  var CSS_AT = words('@media @import @font-face @keyframes @supports @layer @container @property @charset');
  var CSS_PSEUDO = words(':hover :focus :active :focus-visible :first-child :last-child :nth-child() :not() :is() :where() :has() :checked :disabled ::before ::after ::placeholder ::selection :root');
  var CSS_ABBR = {
    df: 'display: flex;', dg: 'display: grid;', db: 'display: block;', dn: 'display: none;', dib: 'display: inline-block;', pa: 'position: absolute;', pr: 'position: relative;', pf: 'position: fixed;', ps: 'position: sticky;',
    jcc: 'justify-content: center;', jcsb: 'justify-content: space-between;', aic: 'align-items: center;', fdc: 'flex-direction: column;', tac: 'text-align: center;', bbb: 'box-sizing: border-box;', cp: 'cursor: pointer;',
    ofh: 'overflow: hidden;', fw1: 'flex: 1;', gtc: 'grid-template-columns: repeat($0, 1fr);'
  };
  var CSS_NUM_ABBR = { m: 'margin', mt: 'margin-top', mb: 'margin-bottom', ml: 'margin-left', mr: 'margin-right', p: 'padding', pt: 'padding-top', pb: 'padding-bottom', pl: 'padding-left', pr: 'padding-right',
    w: 'width', h: 'height', mw: 'max-width', mh: 'max-height', fz: 'font-size', lh: 'line-height', br: 'border-radius', z: 'z-index', op: 'opacity', t: 'top', b: 'bottom', l: 'left', r: 'right', g: 'gap' };

  function lineStartOf(code, pos) { return code.lastIndexOf('\n', pos - 1) + 1; }

  function langAt(code, pos, base) {
    if (base !== 'html') return base;
    var nodes = L.parseHTML(code), res = 'html';
    for (var i = 0; i < nodes.length; i++) {
      var nd = nodes[i];
      if (nd.type === 'raw' && pos >= nd.s && pos <= nd.e) { var rl = L.rawLang(nd); return rl || 'html'; }
    }
    return res;
  }

  function inStringOrComment(lineBefore, lang) {
    var q = null, i;
    for (i = 0; i < lineBefore.length; i++) {
      var c = lineBefore.charAt(i);
      if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; }
      if (c === '"' || c === "'" || (c === '`' && lang !== 'python')) { q = c; continue; }
      if (lang === 'python' || lang === 'yaml' || lang === 'sh') { if (c === '#') return true; }
      else if (c === '/' && lineBefore.charAt(i + 1) === '/') return true;
    }
    return q === '"' || q === "'";
  }

  function rank(items, prefix) {
    var lp = prefix.toLowerCase();
    return items.filter(function (it) { return it.label.toLowerCase().indexOf(lp) === 0 && it.label !== prefix; }).sort(function (a, b) {
      var ac = a.label.indexOf(prefix) === 0 ? 0 : 1, bc = b.label.indexOf(prefix) === 0 ? 0 : 1;
      if (ac !== bc) return ac - bc;
      if (a.pri !== b.pri) return a.pri - b.pri;
      return a.label.length - b.label.length || a.label.localeCompare(b.label);
    });
  }

  function dedupe(items) { var seen = {}; return items.filter(function (it) { var k = it.label + '|' + it.kind; if (seen[k]) return false; seen[k] = true; return true; }); }

  function memberItems(list, kind) {
    return list.map(function (m) {
      var fn = /\(\)$/.test(m), name = m.replace(/\(\)$/, '');
      return { label: name, insert: fn ? name + '($0)' : name, kind: fn ? 'method' : kind || 'property', pri: 1 };
    });
  }

  function completeJS(ctx, prefix, from) {
    var code = ctx.code, before = code.slice(0, from), items = [];
    var dot = /([A-Za-z_$][\w$]*)\s*\.\s*$/.exec(before.slice(-80)), memberCtx = /\.\s*$/.test(before.slice(-3)) ;
    if (memberCtx) {
      var obj = dot ? dot[1] : null;
      if (obj && JS_MEMBERS[obj]) items = memberItems(JS_MEMBERS[obj]);
      else items = memberItems(GENERIC_MEMBERS);
      return { from: from, items: rank(dedupe(items), prefix).slice(0, 14) };
    }
    if (prefix.length < 2) return null;
    Object.keys(JS_SNIPPETS).forEach(function (k) { items.push({ label: k, insert: JS_SNIPPETS[k], kind: 'snippet', pri: 0 }); });
    Object.keys(L.JS_KW).forEach(function (k) { items.push({ label: k, insert: k, kind: 'keyword', pri: 2 }); });
    Object.keys(L.JS_BUILTIN).forEach(function (k) { items.push({ label: k, insert: k, kind: 'global', pri: 1 }); });
    (ctx.words || []).forEach(function (w) { items.push({ label: w, insert: w, kind: 'word', pri: 3 }); });
    return { from: from, items: rank(dedupe(items), prefix).slice(0, 12) };
  }

  function completePython(ctx, prefix, from) {
    if (prefix.length < 2) return null;
    var items = [];
    Object.keys(PY_SNIPPETS).forEach(function (k) { items.push({ label: k, insert: PY_SNIPPETS[k], kind: 'snippet', pri: 0 }); });
    Object.keys(L.PY_KW).forEach(function (k) { items.push({ label: k, insert: k, kind: 'keyword', pri: 2 }); });
    Object.keys(L.PY_BUILTIN).forEach(function (k) { items.push({ label: k, insert: k, kind: 'global', pri: 1 }); });
    (ctx.words || []).forEach(function (w) { items.push({ label: w, insert: w, kind: 'word', pri: 3 }); });
    return { from: from, items: rank(dedupe(items), prefix).slice(0, 12) };
  }

  function completeCSS(ctx, from, pos) {
    var code = ctx.code, before = code.slice(0, pos), openIdx = before.lastIndexOf('{'), closeIdx = before.lastIndexOf('}');
    var inBlock = openIdx > closeIdx, m, items = [];
    if (inBlock) {
      var stmt = before.slice(Math.max(before.lastIndexOf(';'), openIdx) + 1);
      var cm = /^\s*([-\w]+)\s*:\s*([\w-]*)$/.exec(stmt);
      if (cm) {
        var prop = cm[1].toLowerCase(), vp = cm[2], vfrom = pos - vp.length;
        (CSS_VALUES[prop] || []).forEach(function (v) { items.push({ label: v, insert: v + ';', kind: 'value', pri: 0 }); });
        if (/color|background|border|outline|fill|stroke|shadow/.test(prop)) CSS_COLORS.forEach(function (v) { items.push({ label: v, insert: v + ';', kind: 'value', pri: 1 }); });
        CSS_GENERIC_VALUES.forEach(function (v) { items.push({ label: v, insert: /\(\)$/.test(v) ? v.replace(/\(\)$/, '($0)') : v, kind: 'value', pri: 2 }); });
        var r = rank(dedupe(items), vp).slice(0, 12);
        return r.length ? { from: vfrom, items: r } : null;
      }
      var pm = /^\s*([-\w]*)$/.exec(stmt);
      if (pm && pm[1].length >= 1) {
        var pfrom = pos - pm[1].length;
        Object.keys(X.CSS_PROPS).forEach(function (k) { items.push({ label: k, insert: k + ': $0;', kind: 'property', pri: 0 }); });
        var rr = rank(items, pm[1]).slice(0, 12);
        return rr.length ? { from: pfrom, items: rr } : null;
      }
      return null;
    }
    if ((m = /(@[\w-]*)$/.exec(before.slice(-30)))) {
      CSS_AT.forEach(function (a) { items.push({ label: a, insert: a + ' $0', kind: 'at', pri: 0 }); });
      var ra = rank(items, m[1]); return ra.length ? { from: pos - m[1].length, items: ra } : null;
    }
    if ((m = /(::?[\w-]*)$/.exec(before.slice(-30)))) {
      CSS_PSEUDO.forEach(function (a) { items.push({ label: a, insert: a.replace(/\(\)$/, '($0)'), kind: 'pseudo', pri: 0 }); });
      var rp = rank(items, m[1]); return rp.length ? { from: pos - m[1].length, items: rp } : null;
    }
    return null;
  }

  function openTagStack(code) {
    var nodes = L.parseHTML(code), stack = [];
    nodes.forEach(function (nd) {
      if (nd.type === 'open' && !L.VOID[nd.name] && !nd.selfClose) stack.push(nd.name);
      else if (nd.type === 'close') { var i = stack.lastIndexOf(nd.name); if (i !== -1) stack.length = i; }
    });
    return stack;
  }

  function completeHTML(ctx, pos) {
    var code = ctx.code, before = code.slice(0, pos), lt = before.lastIndexOf('<'), gt = before.lastIndexOf('>'), items = [], m;
    if (lt > gt) {
      var tagText = before.slice(lt);
      if ((m = /^<(\/?)([A-Za-z][\w:-]*)?$/.exec(tagText))) {
        var closing = m[1] === '/', pref = m[2] || '';
        if (closing) {
          var stack = openTagStack(before.slice(0, lt));
          var top = stack[stack.length - 1];
          if (top && top.indexOf(pref.toLowerCase()) === 0) return { from: lt + 2, items: [{ label: top, insert: top + '>', kind: 'tag', pri: 0 }] };
          return null;
        }
        if (!pref) return null;
        HTML_TAGS.forEach(function (t) { items.push({ label: t, insert: L.VOID[t] ? t + ' $0>' : t + '>$0</' + t + '>', kind: 'tag', pri: 0 }); });
        var rt = rank(items, pref).slice(0, 12);
        return rt.length ? { from: lt + 1, items: rt } : null;
      }
      var attrM = /^<([A-Za-z][\w:-]*)(?:\s[\s\S]*?)?\s([\w:-]*)$/.exec(tagText);
      var valM = /\s([\w:-]+)=["']([\w-]*)$/.exec(tagText);
      if (valM && ATTR_VALUES[valM[1].toLowerCase()]) {
        ATTR_VALUES[valM[1].toLowerCase()].forEach(function (v) { items.push({ label: v, insert: v, kind: 'value', pri: 0 }); });
        var rv = rank(items, valM[2]).slice(0, 12);
        return rv.length ? { from: pos - valM[2].length, items: rv } : null;
      }
      if (attrM && !/=["'][^"']*$/.test(tagText)) {
        var tagName = attrM[1].toLowerCase(), ap = attrM[2];
        (TAG_ATTRS[tagName] || []).concat(GLOBAL_ATTRS).forEach(function (a) {
          items.push({ label: a, insert: BOOL_ATTRS[a] ? a : (a === 'data-' ? 'data-$0=""' : a + '="$0"'), kind: 'attribute', pri: 0 });
        });
        var ra = rank(items, ap).slice(0, 12);
        return ra.length && ap.length ? { from: pos - ap.length, items: ra } : null;
      }
    }
    return null;
  }

  function complete(ctx) {
    var code = ctx.code, pos = ctx.pos, lang = langAt(code, pos, ctx.lang), ls = lineStartOf(code, pos), lineBefore = code.slice(ls, pos);
    if (lang === 'html' || lang === 'xml') return completeHTML(ctx, pos);
    if (lang === 'css') return completeCSS(ctx, pos, pos);
    if (lang === 'js' || lang === 'ts' || lang === 'python') {
      if (inStringOrComment(lineBefore, lang)) return null;
      var m = /([A-Za-z_$][\w$]*)$/.exec(lineBefore), prefix = m ? m[1] : '', from = pos - prefix.length;
      if (!prefix && !/\.\s*$/.test(lineBefore)) return null;
      return lang === 'python' ? completePython(ctx, prefix, from) : completeJS(ctx, prefix, from);
    }
    if (lang === 'md' || lang === 'txt' || lang === 'sh' || lang === 'yaml' || lang === 'json') {
      var wm = /([A-Za-z_][\w-]*)$/.exec(lineBefore);
      if (!wm || wm[1].length < 3) return null;
      var wi = (ctx.words || []).map(function (w) { return { label: w, insert: w, kind: 'word', pri: 3 }; });
      var rw = rank(dedupe(wi), wm[1]).slice(0, 8);
      return rw.length ? { from: pos - wm[1].length, items: rw } : null;
    }
    return null;
  }

  function idxName(s, i, total) {
    return s.replace(/\$+/g, function (d) { var v = String(i + 1); while (v.length < d.length) v = '0' + v; return v; });
  }

  function parseEmmet(abbr) {
    var i = 0, n = abbr.length;
    function readName() { var m = /^[A-Za-z][\w:-]*|^\$+[\w-]*/.exec(abbr.slice(i)); if (m) { i += m[0].length; return m[0]; } return ''; }
    function readBalanced(open, close) {
      var depth = 0, start = i;
      for (; i < n; i++) { if (abbr[i] === open) depth++; else if (abbr[i] === close) { depth--; if (depth === 0) { i++; return abbr.slice(start + 1, i - 1); } } }
      return null;
    }
    function parseElement() {
      var el = { name: '', id: '', classes: [], attrs: [], text: '', count: 1, children: [] };
      el.name = readName();
      var guard = 0;
      while (i < n && guard++ < 200) {
        var c = abbr[i];
        if (c === '#') { i++; var im = /^[\w$-]+/.exec(abbr.slice(i)); if (!im) return null; el.id = im[0]; i += im[0].length; }
        else if (c === '.') { i++; var cm = /^[\w$-]+/.exec(abbr.slice(i)); if (!cm) return null; el.classes.push(cm[0]); i += cm[0].length; }
        else if (c === '[') {
          var body = readBalanced('[', ']'); if (body === null) return null;
          var re = /([\w:-]+)(?:=("[^"]*"|'[^']*'|[^\s\]]+))?/g, am;
          while ((am = re.exec(body)) !== null) el.attrs.push([am[1], am[2] ? am[2].replace(/^["']|["']$/g, '') : '']);
        }
        else if (c === '{') { var tb = readBalanced('{', '}'); if (tb === null) return null; el.text = tb; }
        else if (c === '*') { i++; var nm = /^\d+/.exec(abbr.slice(i)); if (!nm) return null; el.count = Math.min(parseInt(nm[0], 10), 100); i += nm[0].length; }
        else break;
      }
      return el;
    }
    var root = { children: [] }, parents = [root], last = [root];
    while (i < n) {
      var el = parseElement();
      if (!el) return null;
      if (!el.name && !el.id && !el.classes.length && !el.attrs.length && !el.text) return null;
      var created = [];
      parents.forEach(function (p) {
        for (var k = 0; k < el.count; k++) {
          var copy = JSON.parse(JSON.stringify(el)); copy.index = k; copy.total = el.count; copy.parent = p === root ? null : p;
          p.children.push(copy); created.push(copy);
        }
      });
      last = created;
      if (i >= n) break;
      var op = abbr[i];
      if (op === '>') { parents = last; i++; }
      else if (op === '+') { i++; }
      else if (op === '^') { var up = parents[0] && parents[0].parent; parents = up ? [up] : [root]; i++; }
      else return null;
    }
    return root;
  }

  function defaultTag(el, parentName) {
    if (el.name) return el.name;
    if (parentName === 'ul' || parentName === 'ol') return 'li';
    if (parentName === 'table' || parentName === 'tbody' || parentName === 'thead') return 'tr';
    if (parentName === 'tr') return 'td';
    if (parentName === 'select') return 'option';
    if (parentName === 'p' || parentName === 'span' || parentName === 'a' || parentName === 'button') return 'span';
    return 'div';
  }

  function renderEmmet(node, depth, parentName, state) {
    var out = [], pad = new Array(depth + 1).join('  ');
    node.children.forEach(function (el) {
      var name = idxName(defaultTag(el, parentName), el.index, el.total), attrs = '';
      if (el.id) attrs += ' id="' + idxName(el.id, el.index, el.total) + '"';
      if (el.classes.length) attrs += ' class="' + el.classes.map(function (c) { return idxName(c, el.index, el.total); }).join(' ') + '"';
      var given = {}; el.attrs.forEach(function (a) { given[a[0]] = true; attrs += ' ' + a[0] + '="' + idxName(a[1], el.index, el.total) + '"'; });
      if (name === 'a' && !given.href) attrs += ' href=""';
      if (name === 'img') { if (!given.src) attrs += ' src=""'; if (!given.alt) attrs += ' alt=""'; }
      if (name === 'input' && !given.type) attrs += ' type="text"';
      if (name === 'link' && !given.rel) attrs += ' rel="stylesheet"';
      if (name === 'link' && !given.href) attrs += ' href=""';
      var text = idxName(el.text, el.index, el.total);
      if (L.VOID[name]) { out.push(pad + '<' + name + attrs + '>'); return; }
      if (!el.children.length) {
        var inner = text;
        if (!inner && !state.cursor) { inner = '$0'; state.cursor = true; }
        out.push(pad + '<' + name + attrs + '>' + inner + '</' + name + '>');
      } else {
        out.push(pad + '<' + name + attrs + '>' + (text ? text : ''));
        out.push(renderEmmet(el, depth + 1, name, state));
        out.push(pad + '</' + name + '>');
      }
    });
    return out.join('\n');
  }

  var BOILERPLATE = '<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n  <title>Document</title>\n</head>\n<body>\n  $0\n</body>\n</html>';

  function emmet(abbr) {
    abbr = abbr.trim();
    if (!abbr) return null;
    if (abbr === '!' || abbr === 'html:5') return BOILERPLATE;
    if (abbr === 'meta:vp') return '<meta name="viewport" content="width=device-width, initial-scale=1.0">$0';
    if (abbr === 'link:css') return '<link rel="stylesheet" href="$0style.css">';
    if (abbr === 'script:src') return '<script src="$0"></script>';
    if (!/^[\w.#>+*^\[\]=\-{}$:"'@%\/ ]+$/.test(abbr)) return null;
    if (/^[A-Za-z][\w-]*$/.test(abbr) && !TAGSET[abbr.toLowerCase()]) return null;
    if (/\s/.test(abbr) && !/[{\[]/.test(abbr)) return null;
    var tree = null;
    try { tree = parseEmmet(abbr); } catch (e) { return null; }
    if (!tree || !tree.children.length) return null;
    var state = { cursor: false }, text = renderEmmet(tree, 0, '', state);
    if (!state.cursor) text += '$0';
    return text;
  }

  function cssExpand(word) {
    if (CSS_ABBR[word]) return CSS_ABBR[word];
    var m = /^([a-z]{1,2})(-?\d+(?:\.\d+)?)(p|e|r|%|px|em|rem|vh|vw|s|ms)?$/.exec(word);
    if (m && CSS_NUM_ABBR[m[1]]) {
      var u = m[3], prop = CSS_NUM_ABBR[m[1]];
      if (prop === 'z-index' || prop === 'opacity') u = '';
      else if (!u) u = m[2] === '0' ? '' : 'px';
      else if (u === 'p') u = '%'; else if (u === 'e') u = 'em'; else if (u === 'r') u = 'rem';
      return prop + ': ' + m[2] + u + ';';
    }
    return null;
  }

  function extractAbbr(text) {
    var i = text.length, depth = 0;
    while (i > 0) {
      var c = text.charAt(i - 1);
      if (c === '}' || c === ']') depth++;
      else if (c === '{' || c === '[') { if (depth > 0) depth--; else break; }
      else if (/\s/.test(c) && depth === 0) break;
      i--;
    }
    var t = text.slice(i);
    return t || null;
  }

  function expandAt(code, pos, baseLang) {
    var lang = langAt(code, pos, baseLang), ls = lineStartOf(code, pos), lineBefore = code.slice(ls, pos);
    if (lang === 'html') {
      var tok = extractAbbr(lineBefore);
      if (!tok) return null;
      tok = tok.replace(/^(?:<[^<>]*>)+/, '');
      if (!tok || tok.indexOf('<') !== -1) return null;
      var text = emmet(tok);
      if (!text) return null;
      return { from: pos - tok.length, to: pos, text: text };
    }
    if (lang === 'css') {
      var before = code.slice(0, pos);
      if (before.lastIndexOf('{') <= before.lastIndexOf('}')) return null;
      var wm = /(?:^|[\s;{])([\w-]+)$/.exec(lineBefore);
      if (!wm) return null;
      var exp = cssExpand(wm[1]);
      return exp ? { from: pos - wm[1].length, to: pos, text: exp } : null;
    }
    if (lang === 'js' || lang === 'ts' || lang === 'python') {
      var jm = /(?:^|[\s;{(])([A-Za-z]\w*)$/.exec(lineBefore), table = lang === 'python' ? PY_SNIPPETS : JS_SNIPPETS;
      if (jm && table[jm[1]] && !inStringOrComment(lineBefore, lang)) return { from: pos - jm[1].length, to: pos, text: table[jm[1]] };
    }
    return null;
  }

  function autoCloseTag(code, pos, lang) {
    if (langAt(code, pos, lang) !== 'html' && lang !== 'xml') return null;
    var chunk = code.slice(Math.max(0, pos - 400), pos), m = /<([A-Za-z][\w:-]*)(?:\s(?:[^<>"']|"[^"]*"|'[^']*')*)?>$/.exec(chunk);
    if (!m || /\/>$/.test(chunk)) return null;
    var name = m[1].toLowerCase();
    if (lang !== 'xml' && L.VOID[name]) return null;
    return m[1];
  }

  function commentStyle(lang) {
    if (lang === 'js' || lang === 'ts') return { line: '// ' };
    if (lang === 'python' || lang === 'yaml' || lang === 'sh') return { line: '# ' };
    if (lang === 'css') return { open: '/* ', close: ' */' };
    if (lang === 'html' || lang === 'xml' || lang === 'md') return { open: '<!-- ', close: ' -->' };
    return null;
  }

  function toggleComment(lines, lang) {
    var st = commentStyle(lang);
    if (!st) return null;
    var nonEmpty = lines.filter(function (l) { return l.trim(); });
    if (!nonEmpty.length) return lines.slice();
    if (st.line) {
      var tr = st.line.trim(), all = nonEmpty.every(function (l) { return l.trim().indexOf(tr) === 0; });
      var minIndent = Math.min.apply(null, nonEmpty.map(function (l) { return /^\s*/.exec(l)[0].length; }));
      return lines.map(function (l) {
        if (!l.trim()) return l;
        if (all) return l.replace(new RegExp('^(\\s*)' + tr.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&') + ' ?'), '$1');
        return l.slice(0, minIndent) + st.line + l.slice(minIndent);
      });
    }
    var o = st.open.trim(), c = st.close.trim(), allC = nonEmpty.every(function (l) { var t = l.trim(); return t.indexOf(o) === 0 && t.slice(-c.length) === c; });
    return lines.map(function (l) {
      if (!l.trim()) return l;
      var ind = /^\s*/.exec(l)[0];
      if (allC) { var t = l.trim(); return ind + t.slice(o.length).replace(/^ /, '').slice(0, -c.length).replace(/ $/, ''); }
      return ind + st.open + l.trim() + st.close;
    });
  }

  function formatJSON(code) {
    try { return { text: JSON.stringify(JSON.parse(code), null, 2) + '\n' }; } catch (e) { return { error: e.message }; }
  }

  var api = { complete: complete, emmet: emmet, expandAt: expandAt, autoCloseTag: autoCloseTag, toggleComment: toggleComment, formatJSON: formatJSON, langAt: langAt, cssExpand: cssExpand, commentStyle: commentStyle, openTagStack: openTagStack };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DSAssist = api;
})(typeof window !== 'undefined' ? window : globalThis);
