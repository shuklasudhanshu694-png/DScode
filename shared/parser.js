(function (root) {
  'use strict';

  function set(s) { var o = Object.create(null); s.split(' ').forEach(function (w) { o[w] = true; }); return o; }

  var LANG_WORDS = set('bash sh shell zsh fish console terminal text txt plain plaintext output json jsonc json5 js javascript jsx ts typescript tsx html htm css scss sass less xml svg yaml yml toml ini env dotenv properties md markdown python py rb ruby go golang rust rs java kotlin swift php sql diff patch powershell ps1 bat cmd dockerfile makefile graphql gql vue svelte c cpp csharp cs dart lua r perl scala');
  var KNOWN_NAMES = /^(Dockerfile|Makefile|LICENSE|LICENCE|Procfile|Gemfile|Rakefile|Jenkinsfile|CODEOWNERS|Vagrantfile|Brewfile|Pipfile|README|CHANGELOG|NOTICE|AUTHORS)$/i;
  var OPEN_RE = /^(\s*)(`{3,}|~{3,})([^`]*)$/;
  var BARE_RE = /^\s*(`{3,}|~{3,})\s*$/;

  function isSeparator(t) { return /^([-*_=])(\s*\1){2,}$/.test(t); }
  function isLangWord(t) { return /^[A-Za-z0-9+#.-]{1,14}$/.test(t) && !!LANG_WORDS[t.toLowerCase()]; }

  function isPathLike(tok) {
    if (!tok || tok.length > 200 || /\s/.test(tok)) return false;
    if (/^(https?:|ftp:|mailto:|\/\/)/i.test(tok)) return false;
    if (!/^[\w@.\-\/\[\]()+~]+$/.test(tok)) return false;
    if (/\/$/.test(tok) || /^v?\d+(\.\d+)+$/i.test(tok)) return false;
    var last = tok.split('/').pop();
    if (!last || /^\.{1,2}$/.test(last)) return false;
    if (/\.[A-Za-z0-9]{1,12}$/.test(last) && /\.\d*[A-Za-z][A-Za-z0-9]*$/.test(last) && last.length > 2) return true;
    if (KNOWN_NAMES.test(last)) return 'known';
    return false;
  }

  function matchHint(line) {
    var s = String(line).trim();
    if (!s) return null;
    var decorated = false, m;
    if ((m = /^#{1,6}\s+(.*)$/.exec(s))) { s = m[1]; decorated = true; }
    if ((m = /^(?:[-*+]|\d+[.)])\s+(.*)$/.exec(s))) { s = m[1]; decorated = true; }
    var unbold = s.replace(/^(\*\*|__)(.+?)(\*\*|__)(\s*:)?\s*$/, '$2');
    if (unbold !== s) { s = unbold; decorated = true; }
    if ((m = /^(?:file(?:name)?|path)\s*[:\-]\s*(.*)$/i.exec(s))) { s = m[1]; decorated = true; }
    s = s.replace(/^[^\w`.\/@\[(]+/, '').trim();
    var bt = /`([^`]+)`/.exec(s);
    if (bt) {
      var t = bt[1].trim();
      if ((decorated || s.charAt(0) === '`') && isPathLike(t)) return t.replace(/^\.\//, '');
      return null;
    }
    s = s.replace(/[:：]\s*$/, '').trim();
    if (/^\S+$/.test(s)) { var pl = isPathLike(s); if (pl === true || (pl === 'known' && decorated)) return s.replace(/^\.\//, ''); }
    return null;
  }

  function parseInfo(info) {
    var out = { lang: '', path: null };
    info = String(info || '').trim();
    if (!info) return out;
    var m = /(?:title|file|filename|path|name)\s*=\s*["']?([^"'\s]+)["']?/i.exec(info);
    var toks = info.split(/\s+/), first = toks[0];
    if (m && isPathLike(m[1])) out.path = m[1];
    if (first.indexOf(':') > 0 && !out.path) { var p = first.slice(first.indexOf(':') + 1); if (isPathLike(p)) out.path = p; first = first.slice(0, first.indexOf(':')); }
    if (!out.path && toks.length > 1 && isPathLike(toks[1]) === true) out.path = toks[1];
    if (!out.path && isPathLike(first) === true && first.indexOf('.') > 0) { out.path = first; first = ''; }
    out.lang = first.replace(/[{}=].*$/, '').toLowerCase();
    return out;
  }

  function looksLikeTree(content, lang) {
    var lines = content.split('\n').filter(function (l) { return l.trim(); });
    if (lines.length < 2) return false;
    var box = lines.filter(function (l) { return /[├└│]/.test(l); }).length;
    if (box >= 2) return true;
    if ((lang === '' || lang === 'text' || lang === 'txt' || lang === 'plaintext') && /^[\w.\-]+\/\s*$/.test(lines[0].trim()) && lines.length >= 3) {
      var ok = lines.filter(function (l) { return /^[\s|+`\\'\-]*[\w.\-]+\/?(\s+(#|<-|←).*)?$/.test(l); }).length;
      return ok / lines.length > 0.8;
    }
    return false;
  }

  function firstLineHint(content) {
    var first = (content.split('\n')[0] || '').trim();
    var m = /^(?:\/\/|#|--|;|\/\*+|\*+|<!--)\s*(?:file(?:name)?\s*:\s*)?(\S+?)(?:\s|-->|\*\/|$)/i.exec(first);
    if (m && isPathLike(m[1]) === true) return m[1].replace(/^\.\//, '');
    return null;
  }

  function extractBlocks(text) {
    var lines = String(text).split(/\r?\n/), n = lines.length, i;

    function nextSignificant(k) {
      for (var j = k + 1; j < n; j++) {
        var t = lines[j].trim();
        if (!t || isSeparator(t) || isLangWord(t)) continue;
        return j;
      }
      return -1;
    }

    function lookback(open) {
      var res = { path: null, lang: '' };
      for (var k = open - 1; k >= Math.max(0, open - 8); k--) {
        var t = lines[k].trim();
        if (!t || isSeparator(t)) continue;
        if (isLangWord(t) && !/^[#`*]/.test(t)) { if (!res.lang) res.lang = t.toLowerCase(); continue; }
        res.path = matchHint(lines[k]);
        break;
      }
      return res;
    }

    var anchors = [];
    var anchorHints = Object.create(null);
    for (i = 0; i < n; i++) {
      if (!OPEN_RE.test(lines[i])) continue;
      var lb = lookback(i);
      var inf = parseInfo(OPEN_RE.exec(lines[i])[3]);
      if (lb.path || inf.path) { anchors.push(i); anchorHints[i] = true; }
    }

    var blocks = [];
    i = 0;
    while (i < n) {
      var m = OPEN_RE.exec(lines[i]);
      if (!m) { i++; continue; }
      var fence = m[2], ch = fence.charAt(0), len = fence.length, info = parseInfo(m[3]), look = lookback(i);
      var lang = info.lang || look.lang, path = info.path || look.path;
      var nextAnchor = n;
      for (var a = 0; a < anchors.length; a++) if (anchors[a] > i) { nextAnchor = anchors[a]; break; }

      var isMd = lang === 'md' || lang === 'markdown' || (path && /\.(md|markdown|mdx)$/i.test(path));
      var end = -1, k;
      if (isMd) {
        for (k = nextAnchor - 1; k > i; k--) {
          var bm = BARE_RE.exec(lines[k]);
          if (bm && bm[1].charAt(0) === ch && bm[1].length >= len) { end = k; break; }
        }
      }
      if (end === -1) {
        for (k = i + 1; k < n; k++) {
          var cm = BARE_RE.exec(lines[k]);
          if (cm && cm[1].charAt(0) === ch && cm[1].length >= len) { end = k; break; }
        }
      }
      if (end === -1) { i++; continue; }

      var content = lines.slice(i + 1, end).join('\n');
      if (!path && looksLikeTree(content, lang)) { i = end + 1; continue; }
      var hint = path || firstLineHint(content);
      blocks.push({ lang: lang, content: content, hint: hint ? hint.replace(/^\/+/, '') : null, line: i + 1, source: path ? (info.path ? 'fence info' : 'heading') : (hint ? 'first-line comment' : null) });
      i = end + 1;
    }
    return blocks;
  }

  var DEFAULT_NAMES = { html: 'index.html', htm: 'index.html', css: 'style.css', js: 'script.js', javascript: 'script.js', jsx: 'App.jsx', ts: 'main.ts', typescript: 'main.ts', tsx: 'App.tsx',
    json: 'data.json', md: 'README.md', markdown: 'README.md', py: 'main.py', python: 'main.py', yaml: 'config.yml', yml: 'config.yml', sh: 'run.sh', bash: 'run.sh', shell: 'run.sh',
    env: '.env', dotenv: '.env', sql: 'query.sql', xml: 'data.xml', toml: 'config.toml', ini: 'config.ini' };
  function defaultName(lang) { return DEFAULT_NAMES[(lang || '').toLowerCase()] || (lang ? 'file.' + lang : 'file.txt'); }

  var api = { extractBlocks: extractBlocks, matchHint: matchHint, isPathLike: isPathLike, parseInfo: parseInfo, looksLikeTree: looksLikeTree, defaultName: defaultName, DEFAULT_NAMES: DEFAULT_NAMES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DSParse = api;
})(typeof window !== 'undefined' ? window : globalThis);
