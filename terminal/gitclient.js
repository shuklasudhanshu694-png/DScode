(function (root) {
  'use strict';
  var API = 'https://api.github.com';
  var OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
  var REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
  var BLOB_LIMIT = 40 * 1024 * 1024;
  var BINARY_EXT = /\.(png|jpe?g|gif|webp|bmp|ico|avif|pdf|zip|gz|woff2?|ttf|otf|eot|mp3|mp4|webm|ogg|wav|mov)$/i;

  function GitError(code, message, extra) {
    var e = new Error(message); e.name = 'GitError'; e.code = code;
    if (extra) Object.keys(extra).forEach(function (k) { e[k] = extra[k]; });
    return e;
  }

  function validOwner(s) { return typeof s === 'string' && OWNER_RE.test(s); }
  function validRepo(s) { return typeof s === 'string' && REPO_RE.test(s) && s !== '.' && s !== '..'; }
  function validBranch(n) {
    if (typeof n !== 'string' || !n || n.length > 200 || n === '@') return false;
    if (/^[\/-]|\/$|\.$|\.lock$|\/\.|\.\.|\/\/|@\{/.test(n)) return false;
    if (/[\x00-\x20~^:?*\[\\\x7f]/.test(n)) return false;
    return true;
  }
  function parseRepoRef(input) {
    var s = String(input || '').trim(), m;
    if ((m = /^https:\/\/github\.com\/([^\/\s]+)\/([^\/\s#?]+)(?:[\/#?].*)?$/i.exec(s)) || (m = /^git@github\.com:([^\/\s]+)\/([^\/\s]+)$/i.exec(s)) || (m = /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/.exec(s))) {
      var owner = m[1], repo = m[2].replace(/\.git$/i, '');
      if (validOwner(owner) && validRepo(repo)) return { owner: owner, repo: repo };
    }
    return null;
  }
  function encPath(p) { return String(p).split('/').map(encodeURIComponent).join('/'); }
  function refPath(branch) { return branch.split('/').map(encodeURIComponent).join('/'); }

  var TOKEN_PATTERNS = [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g];
  function redactWith(text, token) {
    var s = String(text);
    if (token && token.length >= 8) s = s.split(token).join('***');
    TOKEN_PATTERNS.forEach(function (re) { s = s.replace(re, '***'); });
    return s;
  }

  function tokenKind(token) {
    if (/^github_pat_/.test(token)) return 'fine-grained';
    if (/^ghp_/.test(token)) return 'classic';
    if (/^gh[ousr]_/.test(token)) return 'oauth/app';
    return 'unknown';
  }

  function createClient(opts) {
    opts = opts || {};
    var token = null, doFetch = opts.fetch || function () { return root.fetch.apply(root, arguments); };
    var sleep = opts.sleep || function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    var timeoutMs = opts.timeout || 30000, rate = { remaining: null, limit: null, reset: null }, onRate = opts.onRate || function () {};

    function redact(s) { return redactWith(s, token); }

    function metaFrom(res) {
      var h = function (n) { return res.headers && res.headers.get ? res.headers.get(n) : null; };
      var m = { scopes: h('x-oauth-scopes'), expiry: h('github-authentication-token-expiration'), remaining: h('x-ratelimit-remaining'), limit: h('x-ratelimit-limit'), reset: h('x-ratelimit-reset'),
        accepted: h('x-accepted-github-permissions'), retryAfter: h('retry-after'), link: h('link') };
      if (m.remaining !== null) { rate = { remaining: +m.remaining, limit: +m.limit, reset: +m.reset }; onRate(rate); }
      return m;
    }

    function explain(status, data, meta) {
      var msg = data && data.message ? String(data.message) : 'HTTP ' + status;
      if (status === 401) return GitError('auth', 'GitHub rejected the token (401): it is wrong, expired or revoked. Create a new one and reconnect.', { status: status });
      if (status === 403 || status === 429) {
        if (meta.remaining === '0') return GitError('rate', 'GitHub API rate limit reached. Resets at ' + new Date((+meta.reset) * 1000).toLocaleTimeString() + '.', { status: status });
        if (/secondary rate limit|abuse/i.test(msg)) return GitError('rate', 'GitHub secondary rate limit hit — slow down and retry in a minute.', { status: status, retryAfter: meta.retryAfter });
        return GitError('forbidden', 'Forbidden (403): ' + msg + (meta.accepted ? '\nThis action needs permission: ' + meta.accepted : '') + '\nFor fine-grained tokens grant "Contents: Read and write" (plus "Pull requests: Read and write" for PRs) on this repository.', { status: status });
      }
      if (status === 404) return GitError('notfound', 'Not found (404). The repository/branch does not exist, or your token has no access to it (private repos return 404 when access is missing).', { status: status });
      if (status === 409) return GitError('conflict', 'Conflict (409): ' + msg, { status: status, empty: /empty/i.test(msg) });
      if (status === 422) {
        var det = data && data.errors ? ' ' + JSON.stringify(data.errors).slice(0, 300) : '';
        return GitError('validation', 'Rejected (422): ' + msg + det, { status: status, notFastForward: /fast.?forward/i.test(msg) });
      }
      return GitError(status >= 500 ? 'server' : 'http', 'GitHub error ' + status + ': ' + msg, { status: status });
    }

    function request(method, path, body, o) {
      o = o || {};
      if (!token) return Promise.reject(GitError('auth', 'No token loaded. Connect to GitHub first.'));
      var bare = String(path).split('?')[0];
      if (typeof path !== 'string' || path.charAt(0) !== '/' || /\/\/|\.\.|[\s\\]/.test(bare)) return Promise.reject(GitError('input', 'Refusing to call an unsafe API path.'));
      var url = API + path, attempt = 0, idempotent = method === 'GET' || o.idempotent;
      function once() {
        attempt++;
        var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null, timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs) : null;
        var init = { method: method, headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
          credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'follow', mode: 'cors' };
        if (ctrl) init.signal = ctrl.signal;
        if (body !== undefined && body !== null) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
        return doFetch(url, init).then(function (res) {
          if (timer) clearTimeout(timer);
          if (res.url && res.url.indexOf(API + '/') !== 0 && res.url !== API) throw GitError('input', 'Blocked: response came from an unexpected host.');
          var meta = metaFrom(res);
          return res.text().then(function (txt) {
            var data = null; if (txt) { try { data = JSON.parse(txt); } catch (e) { data = { message: txt.slice(0, 200) }; } }
            if (res.ok) return { status: res.status, data: data, meta: meta };
            var err = explain(res.status, data, meta), retryable = (err.code === 'server' && idempotent) || (err.code === 'rate' && !/limit reached/.test(err.message));
            if (retryable && attempt < 4) {
              var wait = meta.retryAfter ? Math.min(+meta.retryAfter * 1000, 20000) : 400 * Math.pow(2, attempt);
              return sleep(wait).then(once);
            }
            throw err;
          });
        }, function (e) {
          if (timer) clearTimeout(timer);
          if (e && e.name === 'GitError') throw e;
          if (idempotent && attempt < 3) return sleep(400 * Math.pow(2, attempt)).then(once);
          throw GitError('network', (e && e.name === 'AbortError' ? 'Request timed out.' : 'Network error — check your connection, an ad-blocker or a firewall blocking api.github.com.'));
        });
      }
      return once().catch(function (err) { if (err && err.message) err.message = redact(err.message); throw err; });
    }

    var R = function (o, r) { return '/repos/' + o + '/' + r; };
    function guard(owner, repo) { if (!validOwner(owner) || !validRepo(repo)) throw GitError('input', 'Invalid repository name.'); }

    var api = {
      setToken: function (t) { token = t || null; }, clearToken: function () { token = null; }, hasToken: function () { return !!token; }, redact: redact, getRate: function () { return rate; },
      request: request,
      getUser: function () { return request('GET', '/user'); },
      listRepos: function (page) { return request('GET', '/user/repos?per_page=50&sort=pushed&affiliation=owner,collaborator,organization_member&page=' + (page || 1)).then(function (r) { return r.data; }); },
      createRepo: function (name, isPrivate, description) {
        if (!validRepo(name)) return Promise.reject(GitError('input', 'Invalid repository name.'));
        return request('POST', '/user/repos', { name: name, private: isPrivate !== false, description: description || '', auto_init: false }).then(function (r) { return r.data; });
      },
      getRepo: function (o, r) { guard(o, r); return request('GET', R(o, r)).then(function (x) { return x.data; }); },
      listBranches: function (o, r) { guard(o, r); return request('GET', R(o, r) + '/branches?per_page=100').then(function (x) { return x.data; }); },
      getRef: function (o, r, branch) {
        guard(o, r); if (!validBranch(branch)) return Promise.reject(GitError('input', 'Invalid branch name.'));
        return request('GET', R(o, r) + '/git/ref/heads/' + refPath(branch)).then(function (x) { return x.data.object; }, function (e) { if (e.code === 'notfound' || (e.code === 'conflict' && e.empty)) return null; throw e; });
      },
      getCommit: function (o, r, sha) { guard(o, r); return request('GET', R(o, r) + '/git/commits/' + encodeURIComponent(sha)).then(function (x) { return x.data; }); },
      getTree: function (o, r, sha) { guard(o, r); return request('GET', R(o, r) + '/git/trees/' + encodeURIComponent(sha) + '?recursive=1').then(function (x) { return x.data; }); },
      getBlob: function (o, r, sha) { guard(o, r); return request('GET', R(o, r) + '/git/blobs/' + encodeURIComponent(sha)).then(function (x) { return x.data; }); },
      createBlob: function (o, r, b64) { guard(o, r); return request('POST', R(o, r) + '/git/blobs', { content: b64, encoding: 'base64' }, { idempotent: true }).then(function (x) { return x.data; }); },
      createTree: function (o, r, body) { guard(o, r); return request('POST', R(o, r) + '/git/trees', body, { idempotent: true }).then(function (x) { return x.data; }); },
      createCommit: function (o, r, body) { guard(o, r); return request('POST', R(o, r) + '/git/commits', body).then(function (x) { return x.data; }); },
      updateRef: function (o, r, branch, sha) {
        guard(o, r); if (!validBranch(branch)) return Promise.reject(GitError('input', 'Invalid branch name.'));
        return request('PATCH', R(o, r) + '/git/refs/heads/' + refPath(branch), { sha: sha, force: false }, { idempotent: true }).then(function (x) { return x.data; });
      },
      createRef: function (o, r, branch, sha) {
        guard(o, r); if (!validBranch(branch)) return Promise.reject(GitError('input', 'Invalid branch name.'));
        return request('POST', R(o, r) + '/git/refs', { ref: 'refs/heads/' + branch, sha: sha }).then(function (x) { return x.data; });
      },
      putContent: function (o, r, path, b64, message, branch) {
        guard(o, r); var body = { message: message, content: b64 }; if (branch) body.branch = branch;
        return request('PUT', R(o, r) + '/contents/' + encPath(path), body).then(function (x) { return x.data; });
      },
      listCommits: function (o, r, branch, n) {
        guard(o, r); if (!validBranch(branch)) return Promise.reject(GitError('input', 'Invalid branch name.'));
        return request('GET', R(o, r) + '/commits?sha=' + encodeURIComponent(branch) + '&per_page=' + Math.min(n || 10, 30)).then(function (x) { return x.data; });
      },
      createPR: function (o, r, body) { guard(o, r); return request('POST', R(o, r) + '/pulls', body).then(function (x) { return x.data; }); }
    };
    return api;
  }

  /* ---------- ignore rules ---------- */
  var DEFAULT_IGNORES = ['.git/', 'node_modules/', '.DS_Store', 'Thumbs.db'];
  function globToRegex(pat) {
    var out = '', i = 0;
    while (i < pat.length) {
      var c = pat.charAt(i);
      if (c === '*') { if (pat.charAt(i + 1) === '*') { out += '.*'; i += 2; if (pat.charAt(i) === '/') i++; continue; } out += '[^/]*'; }
      else if (c === '?') out += '[^/]';
      else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
      i++;
    }
    return out;
  }
  function makeIgnore(gitignoreText) {
    var rules = [];
    DEFAULT_IGNORES.concat(String(gitignoreText || '').split(/\r?\n/)).forEach(function (raw) {
      var line = raw.trim(); if (!line || line.charAt(0) === '#') return;
      var neg = false; if (line.charAt(0) === '!') { neg = true; line = line.slice(1); }
      var dirOnly = /\/$/.test(line); if (dirOnly) line = line.slice(0, -1);
      var rooted = line.charAt(0) === '/' || line.slice(0, -1).indexOf('/') !== -1; if (line.charAt(0) === '/') line = line.slice(1);
      var core = globToRegex(line), re = new RegExp((rooted ? '^' : '(^|/)') + core + (dirOnly ? '/' : '(/|$)'));
      rules.push({ re: re, neg: neg, dirOnly: dirOnly });
    });
    return function (path) {
      var ignored = false;
      rules.forEach(function (r) { if (r.re.test(path)) ignored = !r.neg; });
      return ignored;
    };
  }

  /* ---------- secret scanning ---------- */
  var SECRET_RULES = [
    { id: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g }, { id: 'GitHub fine-grained token', re: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g },
    { id: 'AWS access key', re: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g }, { id: 'Private key block', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/g },
    { id: 'Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g }, { id: 'Google API key', re: /\bAIza[0-9A-Za-z_\-]{35}\b/g },
    { id: 'Stripe live key', re: /\b(?:sk|rk)_live_[0-9a-zA-Z]{20,}\b/g }, { id: 'LLM API key', re: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_\-]{32,}\b/g },
    { id: 'JSON Web Token', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g }
  ];
  var GENERIC_RE = /(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?key|auth[_-]?token|token)["']?\s*[:=]\s*["']([A-Za-z0-9_\-\/+=.]{16,})["']/gi;
  var SENSITIVE_NAMES = /(^|\/)(\.env(\.(?!example|sample|template)[\w.-]+)?|[^\/]+\.(pem|key|p12|pfx|jks|keystore)|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|credentials\.json|service[-_]?account[^\/]*\.json|\.npmrc|\.netrc|\.pypirc)$/i;

  function entropy(s) {
    var freq = {}, i; for (i = 0; i < s.length; i++) freq[s.charAt(i)] = (freq[s.charAt(i)] || 0) + 1;
    var h = 0; Object.keys(freq).forEach(function (k) { var p = freq[k] / s.length; h -= p * Math.log(p) / Math.LN2; }); return h;
  }
  function mask(s) { return s.length <= 8 ? '••••' : s.slice(0, 4) + '…' + s.slice(-2); }

  function scanSecrets(files) {
    var findings = [];
    Object.keys(files).forEach(function (path) {
      var f = files[path];
      if (SENSITIVE_NAMES.test(path)) findings.push({ path: path, line: 0, rule: 'Sensitive file name', preview: path.split('/').pop() });
      if (f.binary || f.content.length > 2000000) return;
      var lines = f.content.split('\n');
      for (var i = 0; i < lines.length && findings.length < 200; i++) {
        var line = lines[i]; if (line.length > 2000) continue;
        SECRET_RULES.forEach(function (rule) {
          rule.re.lastIndex = 0; var m;
          while ((m = rule.re.exec(line)) !== null) findings.push({ path: path, line: i + 1, rule: rule.id, preview: mask(m[0]) });
        });
        GENERIC_RE.lastIndex = 0; var g;
        while ((g = GENERIC_RE.exec(line)) !== null) { if (entropy(g[1]) >= 3.3 && !/^(?:[a-z]+_?)+$/i.test(g[1])) findings.push({ path: path, line: i + 1, rule: 'Hard-coded credential', preview: mask(g[1]) }); }
      }
    });
    return findings;
  }

  /* ---------- planning ---------- */
  function planSync(local, base, remote, opts) {
    opts = opts || {}; var res = opts.resolutions || {};
    var plan = { push: { add: [], modify: [], del: [] }, pull: { add: [], modify: [], del: [] }, conflicts: [], same: 0, skippedDeletes: [] };
    var all = {}; [local, base || {}, remote].forEach(function (m) { Object.keys(m).forEach(function (p) { all[p] = true; }); });
    Object.keys(all).sort().forEach(function (p) {
      var L = local[p], B = base ? base[p] : undefined, Rm = remote[p];
      if (L === Rm) { plan.same++; return; }
      var hasBase = !!base, choice = res[p];
      function pushIt() { if (L === undefined) plan.push.del.push(p); else if (Rm === undefined) plan.push.add.push(p); else plan.push.modify.push(p); }
      function pullIt() { if (Rm === undefined) plan.pull.del.push(p); else if (L === undefined) plan.pull.add.push(p); else plan.pull.modify.push(p); }
      if (choice === 'mine') { pushIt(); return; }
      if (choice === 'theirs') { pullIt(); return; }
      if (!hasBase) {
        if (Rm === undefined) plan.push.add.push(p);
        else if (L === undefined) plan.pull.add.push(p);
        else plan.conflicts.push({ path: p, kind: 'both-differ', local: L, remote: Rm, base: null });
        return;
      }
      if (L === B) { pullIt(); return; }
      if (Rm === B) { if (L === undefined && !opts.deleteMissing) plan.skippedDeletes.push(p); else pushIt(); return; }
      plan.conflicts.push({ path: p, kind: L === undefined ? 'deleted-here-changed-there' : Rm === undefined ? 'changed-here-deleted-there' : 'both-changed', local: L || null, remote: Rm || null, base: B || null });
    });
    return plan;
  }

  function nextBase(local, base, remote, applied) {
    var out = {}, all = {}; [local, base || {}, remote].forEach(function (m) { Object.keys(m).forEach(function (p) { all[p] = true; }); });
    Object.keys(all).forEach(function (p) {
      var L = local[p], B = base ? base[p] : undefined, Rm = remote[p], settled = applied.indexOf(p) !== -1 || L === Rm || Rm === B;
      var v = settled ? Rm : B;
      if (v !== undefined) out[p] = v;
    });
    return out;
  }

  function suggestMessage(plan) {
    var a = plan.push.add, m = plan.push.modify, d = plan.push.del, total = a.length + m.length + d.length;
    if (!total) return '';
    var names = a.concat(m).slice(0, 3).map(function (p) { return p.split('/').pop(); });
    var verb = a.length && !m.length && !d.length ? 'Add' : d.length && !a.length && !m.length ? 'Remove' : 'Update';
    return verb + ' ' + (total === 1 ? (names[0] || d[0].split('/').pop()) : total + ' files' + (names.length ? ': ' + names.join(', ') + (a.length + m.length > 3 ? ', …' : '') : '')) + ' via DScode';
  }

  /* ---------- line diff ---------- */
  function lineDiff(aText, bText, ctx) {
    var a = aText.split('\n'), b = bText.split('\n'); ctx = ctx === undefined ? 2 : ctx;
    if (a.length > 2500 || b.length > 2500) return { tooLarge: true, lines: [] };
    var n = a.length, m = b.length, dp = [], i, j;
    for (i = 0; i <= n; i++) dp.push(new Uint16Array(m + 1));
    for (i = n - 1; i >= 0; i--) for (j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    var ops = []; i = 0; j = 0;
    while (i < n && j < m) { if (a[i] === b[j]) { ops.push([' ', a[i]]); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push(['-', a[i]]); i++; } else { ops.push(['+', b[j]]); j++; } }
    while (i < n) { ops.push(['-', a[i++]]); } while (j < m) { ops.push(['+', b[j++]]); }
    var keep = new Array(ops.length), k;
    for (k = 0; k < ops.length; k++) if (ops[k][0] !== ' ') for (var x = Math.max(0, k - ctx); x <= Math.min(ops.length - 1, k + ctx); x++) keep[x] = true;
    var out = [], gap = false;
    for (k = 0; k < ops.length; k++) { if (keep[k]) { if (gap) out.push(['@', '…']); gap = false; out.push(ops[k]); } else gap = true; }
    return { tooLarge: false, lines: out, added: ops.filter(function (o) { return o[0] === '+'; }).length, removed: ops.filter(function (o) { return o[0] === '-'; }).length };
  }

  /* ---------- bytes helpers ---------- */
  function b64ToBytes(b64) { var bin = atob(String(b64).replace(/\s/g, '')), out = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
  function bytesToB64(bytes) { var parts = []; for (var i = 0; i < bytes.length; i += 0x8000) parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))); return btoa(parts.join('')); }
  function classify(path, bytes) {
    if (BINARY_EXT.test(path)) return { binary: true };
    var n = Math.min(bytes.length, 8000); for (var i = 0; i < n; i++) if (bytes[i] === 0) return { binary: true };
    try { return { binary: false, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }; } catch (e) { return { binary: true }; }
  }

  function pool(items, limit, worker) {
    var idx = 0, results = new Array(items.length), failed = null;
    function next() {
      if (failed || idx >= items.length) return Promise.resolve();
      var i = idx++;
      return Promise.resolve(worker(items[i], i)).then(function (r) { results[i] = r; return next(); }, function (e) { failed = failed || e; });
    }
    var runners = []; for (var k = 0; k < Math.min(limit, items.length); k++) runners.push(next());
    return Promise.all(runners).then(function () { if (failed) throw failed; return results; });
  }

  /* ---------- remote state ---------- */
  function remoteState(client, owner, repo, branch) {
    return client.getRef(owner, repo, branch).then(function (ref) {
      if (!ref) return { exists: false, head: null, treeSha: null, files: {}, modes: {} };
      return client.getCommit(owner, repo, ref.sha).then(function (commit) {
        return client.getTree(owner, repo, commit.tree.sha).then(function (tree) {
          if (tree.truncated) throw GitError('truncated', 'This repository tree is too large for the GitHub API listing (truncated). Syncing it is refused to avoid partial data.');
          var files = {}, modes = {};
          tree.tree.forEach(function (it) { if (it.type === 'blob' && (it.mode === '100644' || it.mode === '100755')) { files[it.path] = it.sha; modes[it.path] = it.mode; } });
          return { exists: true, head: ref.sha, treeSha: commit.tree.sha, files: files, modes: modes };
        });
      });
    });
  }

  function localMap(workspaceFiles, shaOf) {
    var paths = Object.keys(workspaceFiles), map = {};
    return pool(paths, 6, function (p) { return shaOf(workspaceFiles[p]).then(function (sha) { map[p] = sha; }); }).then(function () { return map; });
  }

  function pushChanges(client, o) {
    var owner = o.owner, repo = o.repo, plan = o.plan, progress = o.progress || function () {};
    return remoteState(client, owner, repo, o.branch).then(function (rs) {
      if (!rs.exists) throw GitError('nobranch', 'Branch "' + o.branch + '" does not exist on GitHub.');
      if (o.expectHead && rs.head !== o.expectHead) throw GitError('stale', 'The branch changed on GitHub since the last status check. Refresh status and review again.');
      var changed = plan.push.add.concat(plan.push.modify), entries = [], haveSha = {};
      Object.keys(rs.files).forEach(function (p) { haveSha[rs.files[p]] = true; });
      var uploaded = 0;
      return pool(changed, 4, function (p) {
        var bytes = o.bytesOf(p); if (bytes.length > BLOB_LIMIT) throw GitError('toolarge', p + ' is larger than ' + (BLOB_LIMIT / 1048576) + ' MB and cannot be pushed through the API.');
        var sha = o.localShas[p];
        var done = function (s) { entries.push({ path: p, mode: rs.modes[p] || '100644', type: 'blob', sha: s }); progress('blob', ++uploaded, changed.length, p); };
        if (haveSha[sha]) { done(sha); return null; }
        return client.createBlob(owner, repo, bytesToB64(bytes)).then(function (b) { done(b.sha); });
      }).then(function () {
        plan.push.del.forEach(function (p) { entries.push({ path: p, mode: rs.modes[p] || '100644', type: 'blob', sha: null }); });
        if (!entries.length) throw GitError('nothing', 'There is nothing to push.');
        progress('tree', 0, 1, '');
        return client.createTree(owner, repo, { base_tree: rs.treeSha, tree: entries });
      }).then(function (tree) {
        progress('commit', 0, 1, '');
        return client.createCommit(owner, repo, { message: o.message, tree: tree.sha, parents: [rs.head] });
      }).then(function (commit) {
        progress('ref', 0, 1, '');
        return client.updateRef(owner, repo, o.branch, commit.sha).then(function () {
          var after = {}; Object.keys(rs.files).forEach(function (p) { after[p] = rs.files[p]; });
          changed.forEach(function (p) { after[p] = o.localShas[p]; }); plan.push.del.forEach(function (p) { delete after[p]; });
          return { commit: commit.sha, remoteAfter: after, count: entries.length };
        });
      });
    });
  }

  function pullChanges(client, o) {
    var paths = o.plan.pull.add.concat(o.plan.pull.modify), files = {}, done = 0, progress = o.progress || function () {};
    return pool(paths, 4, function (p) {
      return client.getBlob(o.owner, o.repo, o.remote.files[p]).then(function (b) {
        if (b.encoding !== 'base64') throw GitError('http', 'Unexpected blob encoding for ' + p);
        var bytes = b64ToBytes(b.content), cls = classify(p, bytes);
        files[p] = cls.binary ? { content: bytesToB64(bytes), binary: true } : { content: cls.text, binary: false };
        progress('pull', ++done, paths.length, p);
      });
    }).then(function () { return { files: files, deletes: o.plan.pull.del.slice() }; });
  }

  function bootstrapEmpty(client, o) {
    var first = o.paths.indexOf('README.md') !== -1 ? 'README.md' : o.paths.slice().sort()[0];
    return client.putContent(o.owner, o.repo, first, bytesToB64(o.bytesOf(first)), o.message).then(function (r) { return { path: first, commit: r.commit.sha }; });
  }

  var api = { GitError: GitError, createClient: createClient, parseRepoRef: parseRepoRef, validOwner: validOwner, validRepo: validRepo, validBranch: validBranch, redactWith: redactWith, tokenKind: tokenKind,
    makeIgnore: makeIgnore, scanSecrets: scanSecrets, planSync: planSync, nextBase: nextBase, suggestMessage: suggestMessage, lineDiff: lineDiff, remoteState: remoteState, localMap: localMap,
    pushChanges: pushChanges, pullChanges: pullChanges, bootstrapEmpty: bootstrapEmpty, classify: classify, b64ToBytes: b64ToBytes, bytesToB64: bytesToB64, pool: pool, BLOB_LIMIT: BLOB_LIMIT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DSGit = api;
})(typeof window !== 'undefined' ? window : globalThis);
