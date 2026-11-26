(function () {
  'use strict';
  if (!window.DSGit || !window.DSStore) {
    document.body.textContent = 'Git terminal could not start: gitclient.js or ../shared/store.js failed to load. Upload the whole project folder (keep shared/ next to terminal/) and reload.';
    return;
  }
  var G = window.DSGit, S = window.DSStore;
  var $ = function (id) { return document.getElementById(id); };
  var IDLE_MS = 20 * 60 * 1000, REMEMBER_KEY = 'dsgit-session-token';

  var client = G.createClient({ onRate: function (r) { st.rate = r; renderChips(); } });
  var st = {
    user: null, tokenKind: null, scopes: null, expiry: null, owner: null, repo: null, info: null, branch: null, branches: [], sync: null, remote: null, local: null, ws: null,
    plan: null, findings: [], ignored: [], tooLarge: [], excluded: {}, message: '', deleteMissing: false, resolutions: {}, busy: false, mode: 'auto', rate: null, progress: 0, repoList: null, empty: false,
    pendingMessage: '', localShas: null, repoFilter: '', idleTimer: null, lastStatusAt: 0
  };
  var history = [], histIdx = 0;

  function h(tag, props) {
    var e = document.createElement(tag), kids = Array.prototype.slice.call(arguments, 2);
    Object.keys(props || {}).forEach(function (k) {
      if (k === 'class') e.className = props[k]; else if (k === 'text') e.textContent = props[k];
      else if (k.indexOf('on') === 0) e.addEventListener(k.slice(2), props[k]); else if (props[k] !== false && props[k] !== null && props[k] !== undefined) e.setAttribute(k, props[k]);
    });
    kids.forEach(function (c) { if (c === null || c === undefined || c === false) return; e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function safe(t) { return client.redact(String(t)); }

  /* ---------- output ---------- */
  function log(text, cls) {
    var line = h('div', { class: 'l ' + (cls || ''), text: safe(text) }), box = $('log');
    box.appendChild(line); box.scrollTop = box.scrollHeight;
    while (box.childNodes.length > 1500) box.removeChild(box.firstChild);
  }
  function logLink(label, url) {
    if (!/^https:\/\/github\.com\//.test(url)) { log(label + ' ' + url, 'dim'); return; }
    var box = $('log'); box.appendChild(h('div', { class: 'l' }, label + ' ', h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', text: url }))); box.scrollTop = box.scrollHeight;
  }
  function fail(e) {
    var msg = e && e.message ? e.message : String(e);
    log('✖ ' + msg, 'err');
    if (e && e.code === 'auth') { lockSession('Token rejected — session cleared.'); }
    return null;
  }

  /* ---------- modal ---------- */
  function ask(o) {
    return new Promise(function (resolve) {
      var ov = $('modal'), input = $('mInput'), foot = $('mFoot');
      $('mTitle').textContent = o.title || ''; $('mBody').textContent = o.body || '';
      input.classList.toggle('hidden', o.input === undefined); input.type = o.secret ? 'password' : 'text'; if (o.input !== undefined) input.value = o.input;
      foot.innerHTML = '';
      function done(v) { ov.classList.add('hidden'); document.removeEventListener('keydown', key, true); resolve(v); }
      function key(e) { if (e.key === 'Escape') { e.preventDefault(); done(null); } else if (e.key === 'Enter' && o.input !== undefined) { e.preventDefault(); done(input.value); } }
      (o.buttons || [{ label: 'Cancel', value: null }, { label: 'OK', value: true, cls: 'primary' }]).forEach(function (b) {
        foot.appendChild(h('button', { class: 'btn ' + (b.cls || ''), text: b.label, onclick: function () { done(o.input !== undefined && b.value === true ? input.value : b.value); } }));
      });
      document.addEventListener('keydown', key, true); ov.classList.remove('hidden');
      setTimeout(function () { if (o.input !== undefined) { input.focus(); input.select(); } else foot.lastChild.focus(); }, 0);
    });
  }
  function confirmTyped(title, body, phrase) {
    return ask({ title: title, body: body + '\n\nType  ' + phrase + '  to confirm.', input: '', buttons: [{ label: 'Cancel', value: null }, { label: 'Confirm', value: true, cls: 'danger' }] }).then(function (v) { return v === phrase; });
  }

  /* ---------- session / token ---------- */
  function resetIdle() { clearTimeout(st.idleTimer); if (client.hasToken()) st.idleTimer = setTimeout(function () { lockSession('Session locked after 20 minutes of inactivity. Token wiped from memory.'); }, IDLE_MS); }
  ['keydown', 'click', 'mousemove'].forEach(function (ev) { document.addEventListener(ev, function () { if (client.hasToken()) resetIdle(); }, true); });
  function lockSession(msg) {
    client.clearToken(); try { sessionStorage.removeItem(REMEMBER_KEY); } catch (e) {}
    st.user = null; st.tokenKind = null; st.scopes = null; st.expiry = null; st.repoList = null; st.remote = null; st.plan = null; clearTimeout(st.idleTimer);
    if (msg) log('🔒 ' + msg, 'warn'); render();
  }

  function connect(username, token, remember) {
    token = String(token || '').trim();
    if (!token) { log('Enter a token first.', 'err'); return Promise.resolve(); }
    if (/\s/.test(token) || token.length < 20 || token.length > 255) { log('That does not look like a GitHub token.', 'err'); return Promise.resolve(); }
    client.setToken(token); st.busy = true; render(); log('Verifying token with api.github.com …', 'dim');
    return client.getUser().then(function (r) {
      var login = r.data.login;
      if (username && username.trim().toLowerCase() !== login.toLowerCase()) { client.clearToken(); throw G.GitError('input', 'The token belongs to @' + login + ', not @' + username.trim() + '. Nothing was saved.'); }
      st.user = login; st.tokenKind = G.tokenKind(token); st.scopes = r.meta.scopes; st.expiry = r.meta.expiry;
      if (remember) { try { sessionStorage.setItem(REMEMBER_KEY, token); } catch (e) {} } else { try { sessionStorage.removeItem(REMEMBER_KEY); } catch (e) {} }
      log('✔ Authenticated as @' + login + ' (' + st.tokenKind + ' token).', 'ok');
      var risky = (st.scopes || '').split(',').map(function (s) { return s.trim(); }).filter(function (s) { return /^(admin:|delete_repo|write:packages|workflow|write:org|site_admin)/.test(s); });
      if (risky.length) log('⚠ This classic token has broad scopes (' + risky.join(', ') + '). Prefer a fine-grained token limited to one repository with "Contents: Read and write".', 'warn');
      else if (st.tokenKind === 'classic') log('⚠ Classic tokens grant access to ALL your repos with the repo scope. A fine-grained token limited to this repository is safer.', 'warn');
      if (st.expiry) log('Token expires: ' + st.expiry, 'dim'); else if (st.tokenKind !== 'oauth/app') log('This token has no expiry date. Consider setting one.', 'warn');
      resetIdle();
      return S.loadSync().then(function (sync) {
        st.sync = sync;
        if (sync && sync.repo && !st.repo) { var ref = G.parseRepoRef(sync.repo); if (ref) return selectRepo(ref.owner + '/' + ref.repo, sync.branch, true); }
      });
    }).catch(function (e) { st.user = null; fail(e); }).then(function () { st.busy = false; render(); });
  }

  /* ---------- repo / branch ---------- */
  function selectRepo(input, wantBranch, keepSync) {
    var ref = G.parseRepoRef(input);
    if (!ref) { log('Invalid repository. Use owner/repo or a github.com URL.', 'err'); return Promise.resolve(); }
    st.busy = true; render();
    return client.getRepo(ref.owner, ref.repo).then(function (info) {
      st.owner = ref.owner; st.repo = ref.repo; st.info = info;
      if (info.permissions && info.permissions.push === false) log('⚠ Your token can read but NOT push to ' + info.full_name + '.', 'warn');
      log('Repository: ' + info.full_name + ' (' + (info.private ? 'private' : 'PUBLIC') + ', default branch ' + info.default_branch + ')', 'ok');
      return client.listBranches(ref.owner, ref.repo).then(function (bs) {
        st.branches = bs.map(function (b) { return b.name; }); st.empty = st.branches.length === 0;
        var syncMatches = st.sync && st.sync.repo === info.full_name;
        st.branch = wantBranch && (st.branches.indexOf(wantBranch) !== -1 || st.empty) ? wantBranch : (syncMatches && st.sync.branch) || info.default_branch;
        if (st.sync && !syncMatches && !keepSync) { log('Sync baseline belonged to ' + st.sync.repo + ' and was reset for the new repository.', 'warn'); st.sync = null; return S.clearSync(); }
      });
    }).then(function () { if (st.empty) { log('This repository is empty. The first push will create its initial commit.', 'warn'); } return refresh(); }).catch(fail).then(function () { st.busy = false; render(); });
  }

  function saveSyncRecord(commit, files) {
    st.sync = { repo: st.info.full_name, branch: st.branch, commit: commit, files: files, at: new Date().toISOString() };
    return S.saveSync(st.sync);
  }

  /* ---------- status ---------- */
  function loadWorkspace() {
    return S.requestFlush(500).then(function () { return S.loadWorkspace(); });
  }
  function refresh(localOnly) {
    if (!st.owner) return Promise.resolve();
    st.progress = 0; log('Reading workspace and comparing with GitHub …', 'dim');
    return loadWorkspace().then(function (ws) {
      st.ws = ws;
      var gi = ws.files['.gitignore'] ? ws.files['.gitignore'].content : '', ignore = G.makeIgnore(gi), included = {}, ignored = [], tooLarge = [];
      Object.keys(ws.files).forEach(function (p) {
        var f = ws.files[p];
        if (ignore(p) || st.excluded[p]) { ignored.push(p); return; }
        var size = f.binary ? Math.floor(f.content.length * 3 / 4) : f.content.length;
        if (size > G.BLOB_LIMIT) { tooLarge.push(p); return; }
        included[p] = f;
      });
      st.included = included; st.ignored = ignored; st.tooLarge = tooLarge;
      return G.localMap(included, function (f) { return S.gitBlobSha(S.fileBytes(f)); });
    }).then(function (local) {
      st.local = local;
      if (localOnly && st.remote) return st.remote;
      return st.empty ? { exists: false, head: null, files: {}, modes: {} } : G.remoteState(client, st.owner, st.repo, st.branch);
    }).then(function (rs) {
      st.remote = rs;
      var base = st.sync && st.sync.repo === st.info.full_name && st.sync.branch === st.branch ? st.sync.files : null;
      if (!rs.exists && !st.empty) log('Branch "' + st.branch + '" does not exist on GitHub yet. Create it from "' + st.info.default_branch + '" with the branch button.', 'warn');
      st.plan = G.planSync(st.local, base, rs.files, { deleteMissing: st.deleteMissing, resolutions: st.resolutions });
      st.findings = G.scanSecrets(st.included).filter(function (f) { var p = st.plan; return p.push.add.concat(p.push.modify).indexOf(f.path) !== -1 || !base; });
      if (!st.message) st.message = G.suggestMessage(st.plan);
      st.lastStatusAt = Date.now();
    }).catch(fail).then(function () { render(); });
  }

  function summary() {
    var p = st.plan; if (!p) return null;
    return { add: p.push.add.length, mod: p.push.modify.length, del: p.push.del.length, pull: p.pull.add.length + p.pull.modify.length + p.pull.del.length, conf: p.conflicts.length, skip: p.skippedDeletes.length };
  }

  /* ---------- pull ---------- */
  function pull(silent) {
    if (!st.plan) return Promise.resolve(false);
    var p = st.plan, n = p.pull.add.length + p.pull.modify.length + p.pull.del.length;
    if (!n) { if (!silent) log('Nothing to pull — workspace is up to date with ' + st.branch + '.', 'ok'); return Promise.resolve(true); }
    var theirs = Object.keys(st.resolutions).filter(function (x) { return st.resolutions[x] === 'theirs'; });
    var go = theirs.length ? ask({ title: 'Overwrite local changes?', body: 'You chose "take theirs" for ' + theirs.length + ' file(s). Your local version of these files will be replaced:\n\n' + theirs.slice(0, 10).join('\n'), buttons: [{ label: 'Cancel', value: false }, { label: 'Overwrite', value: true, cls: 'danger' }] }) : Promise.resolve(true);
    return go.then(function (ok) {
      if (!ok) return false;
      st.busy = true; render(); log('Pulling ' + n + ' change(s) from ' + st.branch + ' …', 'dim');
      return G.pullChanges(client, { owner: st.owner, repo: st.repo, plan: p, remote: st.remote, progress: setProgress }).then(function (res) {
        return S.requestFlush(500).then(function () { return S.loadWorkspace(); }).then(function (ws) {
          Object.keys(res.files).forEach(function (path) { ws.files[path] = { content: res.files[path].content, binary: res.files[path].binary, mime: '' }; });
          res.deletes.forEach(function (path) { delete ws.files[path]; });
          return S.saveWorkspace(ws).then(function () {
            var local2 = Object.assign({}, st.local), applied = Object.keys(res.files).concat(res.deletes);
            Object.keys(res.files).forEach(function (path) { local2[path] = st.remote.files[path]; }); res.deletes.forEach(function (path) { delete local2[path]; });
            var base = st.sync && st.sync.repo === st.info.full_name && st.sync.branch === st.branch ? st.sync.files : null;
            return saveSyncRecord(st.remote.head, G.nextBase(local2, base, st.remote.files, applied));
          });
        }).then(function () { log('✔ Pulled ' + Object.keys(res.files).length + ' file(s), removed ' + res.deletes.length + '. DScode was updated.', 'ok'); Object.keys(st.resolutions).forEach(function (x) { if (st.resolutions[x] === 'theirs') delete st.resolutions[x]; }); return true; });
      }).catch(function (e) { fail(e); return false; }).then(function (r) { st.busy = false; setProgress('', 0, 0); return refresh().then(function () { return r; }); });
    });
  }
  function setProgress(kind, i, n, path) {
    st.progress = n ? i / n : 0; var bar = document.querySelector('.progress > div'); if (bar) bar.style.width = Math.round(st.progress * 100) + '%';
    if (path) log('  ' + kind + ' ' + i + '/' + n + '  ' + path, 'dim');
  }

  /* ---------- push ---------- */
  function push(opts) {
    opts = opts || {};
    if (st.busy) return Promise.resolve();
    return refresh().then(function () {
      var p = st.plan; if (!p || !st.remote) return;
      if (!st.remote.exists && !st.empty) { log('Branch does not exist on GitHub. Create it first.', 'err'); return; }
      if (p.conflicts.length) { log('✖ ' + p.conflicts.length + ' conflict(s): the same file changed here and on GitHub. Resolve each one (keep mine / take theirs) before pushing.', 'err'); render(); return; }
      var pullN = p.pull.add.length + p.pull.modify.length + p.pull.del.length;
      var step1 = pullN ? ask({ title: 'GitHub has newer changes', body: pullN + ' change(s) on "' + st.branch + '" are not in your workspace yet.\nPull them first, then push?', buttons: [{ label: 'Cancel', value: false }, { label: 'Pull, then push', value: true, cls: 'primary' }] }).then(function (ok) { return ok ? pull(true).then(function (r) { return r ? refresh().then(function () { return true; }) : false; }) : false; }) : Promise.resolve(true);
      return step1.then(function (ok) {
        if (!ok) return;
        if (st.plan && st.plan.conflicts.length) { log('✖ ' + st.plan.conflicts.length + ' conflict(s) remain after pulling. Resolve them (keep mine / take theirs), then push again.', 'err'); render(); return; }
        return doPush(opts);
      });
    }).catch(fail);
  }

  function doPush(opts) {
    var p = st.plan, total = p.push.add.length + p.push.modify.length + p.push.del.length;
    if (!total) { log('Nothing to push — GitHub already has your files.', 'ok'); return; }
    var msg = (st.message || '').trim();
    if (!msg) { log('✖ Enter a commit message first.', 'err'); return; }
    if (msg.length > 5000) { log('✖ Commit message too long.', 'err'); return; }
    var chain = Promise.resolve(true);
    var pushPaths = p.push.add.concat(p.push.modify), findings = st.findings.filter(function (f) { return pushPaths.indexOf(f.path) !== -1; });
    if (findings.length) {
      chain = chain.then(function () {
        var lines = findings.slice(0, 12).map(function (f) { return '• ' + f.path + (f.line ? ':' + f.line : '') + ' — ' + f.rule + ' (' + f.preview + ')'; }).join('\n');
        return ask({ title: '⚠ Possible secrets detected', body: 'These files in this push look like they contain credentials:\n\n' + lines + (findings.length > 12 ? '\n…' : '') + '\n\nPushing secrets to GitHub (especially public repos) exposes them permanently, even if you delete them later.', buttons: [{ label: 'Cancel', value: 'cancel' }, { label: 'Exclude these files', value: 'exclude' }, { label: 'Push anyway…', value: 'anyway', cls: 'danger' }] }).then(function (c) {
          if (c === 'exclude') { findings.forEach(function (f) { st.excluded[f.path] = true; }); log('Excluded ' + Object.keys(st.excluded).length + ' file(s) from this session\'s pushes.', 'warn'); return refresh().then(function () { return 'again'; }); }
          if (c === 'anyway') return confirmTyped('Push secrets?', 'You are about to push likely credentials.', 'PUSH SECRETS').then(function (ok) { return ok; });
          return false;
        });
      });
    }
    return chain.then(function (r) {
      if (r === 'again') return doPush(opts);
      if (r === false) { log('Push cancelled.', 'warn'); return; }
      var isDefault = st.branch === st.info.default_branch, gate = Promise.resolve(true);
      if (isDefault && !st.info.private) gate = confirmTyped('Push to the default branch of a PUBLIC repository', 'This publishes ' + total + ' change(s) to ' + st.info.full_name + ' / ' + st.branch + ' immediately, visible to everyone.', st.branch);
      else if (isDefault) gate = ask({ title: 'Push to default branch', body: 'Push ' + total + ' change(s) to ' + st.info.full_name + ' / ' + st.branch + '?', buttons: [{ label: 'Cancel', value: false }, { label: 'Push', value: true, cls: 'primary' }] });
      return gate.then(function (ok) { if (!ok) { log('Push cancelled.', 'warn'); return; } return runPush(msg); });
    });
  }

  function runPush(msg) {
    st.busy = true; render();
    var p = st.plan, bytesOf = function (path) { return S.fileBytes(st.included[path]); };
    var start = st.empty ? G.bootstrapEmpty(client, { owner: st.owner, repo: st.repo, paths: Object.keys(st.included), bytesOf: bytesOf, message: msg }).then(function (b) {
      log('Created initial commit with ' + b.path + '.', 'ok'); st.empty = false;
      return client.listBranches(st.owner, st.repo).then(function (bs) { st.branches = bs.map(function (x) { return x.name; }); if (st.branches.indexOf(st.branch) === -1) st.branch = st.branches[0]; return G.remoteState(client, st.owner, st.repo, st.branch); }).then(function (rs) {
        st.remote = rs; var plan2 = G.planSync(st.local, null, rs.files, { deleteMissing: false }); st.plan = plan2; return plan2;
      });
    }) : Promise.resolve(p);
    return start.then(function (plan) {
      var n = plan.push.add.length + plan.push.modify.length + plan.push.del.length;
      if (!n) { log('✔ Everything was included in the initial commit.', 'ok'); return { commit: st.remote.head, remoteAfter: st.remote.files }; }
      log('Pushing ' + n + ' change(s) to ' + st.branch + ' (fast-forward only, never forced) …', 'dim');
      return G.pushChanges(client, { owner: st.owner, repo: st.repo, branch: st.branch, plan: plan, expectHead: st.remote.head, message: msg, localShas: st.local, bytesOf: bytesOf, progress: setProgress });
    }).then(function (res) {
      var applied = Object.keys(res.remoteAfter);
      return saveSyncRecord(res.commit, G.nextBase(st.local, st.sync && st.sync.branch === st.branch && st.sync.repo === st.info.full_name ? st.sync.files : null, res.remoteAfter, applied)).then(function () {
        log('✔ Pushed commit ' + res.commit.slice(0, 7) + ' to ' + st.info.full_name + '/' + st.branch, 'ok');
        logLink('View:', 'https://github.com/' + st.info.full_name + '/commit/' + res.commit); st.message = ''; st.resolutions = {};
      });
    }).catch(function (e) {
      if (e.code === 'stale' || e.notFastForward) log('✖ The branch moved on GitHub while pushing. Nothing was overwritten. Refresh, review the changes and push again.', 'err');
      else if (e.code === 'conflict' && e.empty) log('✖ Repository is empty; initialise it first.', 'err'); else fail(e);
    }).then(function () { st.busy = false; setProgress('', 0, 0); return refresh(); });
  }

  function createBranch(name, from) {
    if (!G.validBranch(name)) { log('Invalid branch name.', 'err'); return Promise.resolve(); }
    if (st.branches.indexOf(name) !== -1) { log('Branch already exists. Use checkout.', 'err'); return Promise.resolve(); }
    var src = from || st.branch; st.busy = true; render();
    return client.getRef(st.owner, st.repo, src).then(function (ref) {
      if (!ref) throw G.GitError('notfound', 'Source branch "' + src + '" does not exist.');
      return client.createRef(st.owner, st.repo, name, ref.sha).then(function () { st.branches.push(name); st.branch = name; log('✔ Created branch ' + name + ' from ' + src + ' and switched to it.', 'ok'); return saveSyncRecord(ref.sha, st.sync && st.sync.files ? st.sync.files : {}); });
    }).catch(fail).then(function () { st.busy = false; return refresh(); });
  }
  function checkout(name) {
    if (!G.validBranch(name)) { log('Invalid branch name.', 'err'); return Promise.resolve(); }
    st.busy = true; render();
    return G.remoteState(client, st.owner, st.repo, name).then(function (rs) {
      if (!rs.exists) throw G.GitError('notfound', 'Branch "' + name + '" does not exist on GitHub.');
      st.branch = name; log('Now tracking ' + name + '. Your workspace files were not touched; differences are shown against this branch.', 'ok');
      return saveSyncRecord(rs.head, rs.files);
    }).catch(fail).then(function () { st.busy = false; return refresh(); });
  }
  function openPR(title, body, base) {
    base = base || st.info.default_branch;
    if (st.branch === base) { log('✖ Current branch equals the base branch. Create a feature branch first.', 'err'); return Promise.resolve(); }
    st.busy = true; render();
    return client.createPR(st.owner, st.repo, { title: title, head: st.branch, base: base, body: body || '' }).then(function (pr) { log('✔ Pull request #' + pr.number + ' created.', 'ok'); logLink('Open:', pr.html_url); }).catch(fail).then(function () { st.busy = false; render(); });
  }

  /* ---------- dashboard ---------- */
  function renderChips() {
    var c = $('chips'); c.innerHTML = '';
    var add = function (t, cls) { c.appendChild(h('span', { class: 'chip ' + cls, text: t })); };
    add(client.hasToken() ? '🔒 token in memory only' : '🔓 not connected', client.hasToken() ? 'ok' : 'warn');
    if (st.user) add('@' + st.user + ' · ' + st.tokenKind, 'info');
    if (st.info) add(st.info.full_name + ' · ' + (st.info.private ? 'private' : 'public'), st.info.private ? 'ok' : 'warn');
    if (st.rate && st.rate.remaining !== null) add('API ' + st.rate.remaining + '/' + st.rate.limit, st.rate.remaining < 100 ? 'bad' : 'info');
  }

  function render() {
    renderChips();
    var d = $('dash'); d.innerHTML = '';
    $('promptLabel').textContent = (st.repo ? st.repo + (st.branch ? ':' + st.branch : '') : 'git') + '>';
    if (!client.hasToken()) { d.appendChild(connectCard()); return; }
    d.appendChild(accountCard());
    if (!st.info) { d.appendChild(repoCard()); return; }
    d.appendChild(branchCard()); d.appendChild(changesCard()); d.appendChild(commitCard());
  }

  function connectCard() {
    var user = h('input', { type: 'text', id: 'inUser', placeholder: 'GitHub username', autocomplete: 'off', spellcheck: 'false' }), tok = h('input', { type: 'password', id: 'inTok', placeholder: 'github_pat_… (fine-grained recommended)', autocomplete: 'off', spellcheck: 'false' });
    var rem = h('input', { type: 'checkbox', id: 'inRem' });
    var btn = h('button', { class: 'btn primary', text: 'Connect', onclick: function () { var t = tok.value, u = user.value, r = rem.checked; tok.value = ''; connect(u, t, r); } });
    tok.addEventListener('keydown', function (e) { if (e.key === 'Enter') btn.click(); });
    return h('div', { class: 'card' }, h('h4', { text: 'Connect to GitHub' }),
      h('p', { text: 'Your token is checked against api.github.com, kept only in this tab\'s memory, never written to disk, never shown again and wiped after 20 idle minutes.' }),
      h('div', { class: 'field' }, h('label', { text: 'Username (optional — verified against the token)' }), user),
      h('div', { class: 'field' }, h('label', { text: 'Personal Access Token' }), tok),
      h('label', { class: 'check' }, rem, 'Remember for this browser tab only (sessionStorage — convenient but readable by any script on this origin)'),
      h('div', { class: 'note' }, 'Create a fine-grained token at GitHub → Settings → Developer settings → Fine-grained tokens. Select ONLY the repository you push to, permission "Contents: Read and write" (add "Pull requests: Read and write" for PRs), and set a short expiry.'),
      btn);
  }

  function accountCard() {
    var kids = [h('h4', {}, 'Account', h('button', { class: 'mini', text: 'Wipe token & disconnect', onclick: function () { lockSession('Disconnected. Token removed from memory.'); } }))];
    kids.push(h('div', {}, '@' + st.user + ' — ' + st.tokenKind + ' token' + (st.expiry ? ', expires ' + st.expiry : '')));
    if (st.tokenKind === 'classic') kids.push(h('div', { class: 'note warn', text: 'Classic token: grants access to all repos it covers. Switch to a fine-grained token when you can.' }));
    return h.apply(null, ['div', { class: 'card' }].concat(kids));
  }

  function repoCard() {
    var inp = h('input', { type: 'text', placeholder: 'owner/repo or https://github.com/owner/repo', autocomplete: 'off', spellcheck: 'false' });
    var go = h('button', { class: 'btn primary', text: 'Use repository', onclick: function () { selectRepo(inp.value); } });
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') go.click(); });
    var list = h('div', { class: 'repo-list' });
    function paint() {
      list.innerHTML = '';
      (st.repoList || []).filter(function (r) { return !st.repoFilter || r.full_name.toLowerCase().indexOf(st.repoFilter) !== -1; }).slice(0, 40).forEach(function (r) {
        list.appendChild(h('div', { class: 'repo-item', onclick: function () { selectRepo(r.full_name); } }, h('span', { text: r.full_name }), h('span', { class: 'badge', text: r.private ? 'private' : 'public' })));
      });
    }
    var loadBtn = h('button', { class: 'btn', text: st.repoList ? 'Reload my repositories' : 'List my repositories', onclick: function () { client.listRepos(1).then(function (l) { st.repoList = l; render(); }).catch(fail); } });
    var filter = h('input', { type: 'text', placeholder: 'Filter…', autocomplete: 'off', oninput: function (e) { st.repoFilter = e.target.value.toLowerCase(); paint(); } });
    paint();
    var nm = h('input', { type: 'text', placeholder: 'new-repository-name', autocomplete: 'off', spellcheck: 'false' }), pub = h('input', { type: 'checkbox' });
    var create = h('button', { class: 'btn', text: 'Create repository', onclick: function () {
      if (!G.validRepo(nm.value)) { log('Invalid repository name.', 'err'); return; }
      client.createRepo(nm.value, !pub.checked, 'Created with DScode').then(function (r) { log('✔ Created ' + r.full_name + ' (' + (r.private ? 'private' : 'public') + ').', 'ok'); return selectRepo(r.full_name); }).catch(fail);
    } });
    return h('div', { class: 'card' }, h('h4', { text: 'Choose repository' }),
      h('div', { class: 'field' }, inp), h('div', { class: 'row' }, go, loadBtn), st.repoList ? filter : null, st.repoList ? list : null,
      h('h4', { text: 'Or create a new one' }), h('div', { class: 'field' }, nm), h('label', { class: 'check' }, pub, 'Make it public (default is private)'), create);
  }

  function branchCard() {
    var sel = h('select', { onchange: function (e) { checkout(e.target.value); } });
    st.branches.forEach(function (b) { sel.appendChild(h('option', { value: b, text: b, selected: b === st.branch ? 'selected' : false })); });
    if (st.branches.indexOf(st.branch) === -1 && st.branch) sel.appendChild(h('option', { value: st.branch, text: st.branch + ' (not on GitHub)', selected: 'selected' }));
    var newB = h('button', { class: 'btn', text: 'New branch…', disabled: st.busy ? 'disabled' : false, onclick: function () { ask({ title: 'New branch', body: 'Create from "' + st.branch + '" and switch to it:', input: 'feature/' }).then(function (v) { if (v) createBranch(v.trim()); }); } });
    var other = h('button', { class: 'btn', text: 'Change repository', onclick: function () { st.info = null; st.owner = null; st.repo = null; st.plan = null; render(); } });
    return h('div', { class: 'card' }, h('h4', { text: 'Branch' }), h('div', { class: 'row' }, sel, newB, other), st.info.default_branch === st.branch && !st.info.private ? h('div', { class: 'note warn', text: 'This is the default branch of a public repository. Pushing here publishes immediately — consider a feature branch + pull request.' }) : null);
  }

  function fileRow(k, path, extra) { return h('div', { class: 'f' }, h('span', { class: 'k ' + k, text: k }), h('span', { text: path + (extra ? ' ' + extra : '') })); }

  function changesCard() {
    var s = summary(), card = h('div', { class: 'card' }, h('h4', {}, 'Changes', h('button', { class: 'mini', text: 'Refresh', onclick: function () { refresh(); } })));
    if (!s) { card.appendChild(h('p', { text: 'Reading status…' })); return card; }
    card.appendChild(h('div', { text: '▲ push: +' + s.add + ' ~' + s.mod + ' −' + s.del + '    ▼ pull: ' + s.pull + '    ⚠ conflicts: ' + s.conf }));
    var list = h('div', { class: 'filelist' }), p = st.plan;
    p.push.add.forEach(function (x) { list.appendChild(fileRow('A', x)); }); p.push.modify.forEach(function (x) { list.appendChild(fileRow('M', x)); }); p.push.del.forEach(function (x) { list.appendChild(fileRow('D', x)); });
    p.pull.add.concat(p.pull.modify, p.pull.del).forEach(function (x) { list.appendChild(fileRow('P', x, '(on GitHub)')); });
    card.appendChild(list);
    if (!s.add && !s.mod && !s.del && !s.pull && !s.conf) card.appendChild(h('div', { class: 'note ok', text: '✔ Workspace and GitHub are identical.' }));
    if (s.skip) card.appendChild(h('div', { class: 'note', text: s.skip + ' file(s) exist on GitHub but are missing locally. They are NOT deleted unless you enable "propagate deletions".' }));
    if (p.conflicts.length) {
      var cl = h('div', { class: 'note bad' }, 'Conflicts — same file changed in both places:');
      p.conflicts.forEach(function (c) {
        cl.appendChild(h('div', { class: 'row' }, h('span', { class: 'k C', text: 'C' }), h('span', { text: c.path }),
          h('button', { class: 'mini', text: 'Keep mine', onclick: function () { st.resolutions[c.path] = 'mine'; refresh(); } }), h('button', { class: 'mini', text: 'Take theirs', onclick: function () { st.resolutions[c.path] = 'theirs'; refresh(); } }),
          h('button', { class: 'mini', text: 'Diff', onclick: function () { runCommand('diff ' + c.path); } })));
      });
      card.appendChild(cl);
    }
    var findInPush = st.findings.filter(function (f) { return p.push.add.concat(p.push.modify).indexOf(f.path) !== -1; });
    if (findInPush.length) card.appendChild(h('div', { class: 'note bad', text: '🛡 ' + findInPush.length + ' possible secret(s) in files to push: ' + findInPush.slice(0, 4).map(function (f) { return f.path + ' (' + f.rule + ')'; }).join(', ') + '. You will be asked before pushing.' }));
    if (st.tooLarge.length) card.appendChild(h('div', { class: 'note warn', text: 'Skipped (over 40 MB): ' + st.tooLarge.join(', ') }));
    var del = h('input', { type: 'checkbox', onchange: function (e) { st.deleteMissing = e.target.checked; refresh(); } }); del.checked = st.deleteMissing;
    card.appendChild(h('label', { class: 'check' }, del, 'Propagate local deletions to GitHub'));
    if (st.ignored.length) card.appendChild(h('div', { class: 'l dim', text: st.ignored.length + ' file(s) ignored (.gitignore / excluded).' }));
    return card;
  }

  function commitCard() {
    var ta = h('textarea', { placeholder: 'Commit message', oninput: function (e) { st.message = e.target.value; } }); ta.value = st.message || '';
    var s = summary() || { add: 0, mod: 0, del: 0, pull: 0, conf: 0 };
    var busy = st.busy ? 'disabled' : false;
    var pushBtn = h('button', { class: 'btn primary', text: '⬆ Push', disabled: busy, onclick: function () { push(); } });
    var pullBtn = h('button', { class: 'btn', text: '⬇ Pull' + (s.pull ? ' (' + s.pull + ')' : ''), disabled: busy, onclick: function () { pull(false); } });
    var prBtn = h('button', { class: 'btn', text: 'Open pull request…', disabled: busy, onclick: function () {
      ask({ title: 'Pull request title', body: 'From ' + st.branch + ' into ' + st.info.default_branch, input: st.message || '' }).then(function (t) { if (t && t.trim()) openPR(t.trim(), '', st.info.default_branch); });
    } });
    var bar = h('div', { class: 'progress' }, h('div', {}));
    return h('div', { class: 'card' }, h('h4', { text: 'Commit & sync' }), h('div', { class: 'field' }, ta), h('div', { class: 'row' }, pushBtn, pullBtn, prBtn), bar,
      h('p', { text: 'Pushes are fast-forward only — GitHub rejects them if the branch moved, and nothing is ever force-pushed or overwritten.' }));
  }

  /* ---------- manual commands ---------- */
  function tokenize(line) {
    var out = [], re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g, m;
    while ((m = re.exec(line)) !== null) out.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : m[2] !== undefined ? m[2] : m[3]);
    return out;
  }
  var HELP = ['Commands (a leading "git " is optional):', '  status                      what would be pushed / pulled', '  diff <path>                 line diff against GitHub', '  log [n]                     recent commits on this branch',
    '  branch                      list branches   |  branch <name>  create from current', '  checkout <branch>           track another branch (workspace untouched)', '  pull                        bring remote changes into the workspace',
    '  push [-m "msg"] [--delete-missing]', '  commit -m "msg"             set the commit message for the next push', '  remote                      show repository   |  remote set owner/repo', '  repo list | repo create <name> [--public]',
    '  pr create "title" [--base main]', '  scan                        secret scan of files to push', '  exclude <path> | include <path>   session-only push exclusions', '  whoami | auth login | auth logout | auth status', '  clear', '',
    'Tokens are never typed on this command line — use "auth login" (masked prompt).'];

  function requireAuth() { if (!client.hasToken()) { log('Not connected. Run: auth login', 'err'); return false; } return true; }
  function requireRepo() { if (!requireAuth()) return false; if (!st.info) { log('No repository selected. Run: remote set owner/repo', 'err'); return false; } return true; }

  function runCommand(raw) {
    var line = String(raw || '').trim(); if (!line) return Promise.resolve();
    log((st.repo || 'git') + '> ' + (/^auth\s+login/.test(line) ? line : line), 'cmd');
    var args = tokenize(line); if (args[0] === 'git') args.shift(); var cmd = args.shift();
    switch (cmd) {
      case 'help': case '?': log(HELP.join('\n'), 'dim'); return Promise.resolve();
      case 'clear': $('log').innerHTML = ''; return Promise.resolve();
      case 'whoami': log(st.user ? '@' + st.user : 'not connected'); return Promise.resolve();
      case 'auth':
        if (args[0] === 'login') return ask({ title: 'Paste token', body: 'The token is masked, kept in memory only and never logged.', input: '', secret: true, buttons: [{ label: 'Cancel', value: null }, { label: 'Connect', value: true, cls: 'primary' }] }).then(function (t) { if (t) return connect('', t, false); });
        if (args[0] === 'logout') { lockSession('Disconnected. Token removed from memory.'); return Promise.resolve(); }
        log(st.user ? 'Connected as @' + st.user + ' (' + st.tokenKind + ')' + (st.scopes ? ', scopes: ' + st.scopes : '') + (st.expiry ? ', expires ' + st.expiry : '') : 'Not connected.'); return Promise.resolve();
      case 'remote':
        if (args[0] === 'set') { if (!requireAuth()) return Promise.resolve(); return selectRepo(args[1] || ''); }
        log(st.info ? st.info.full_name + ' (' + (st.info.private ? 'private' : 'public') + ') tracking ' + st.branch : 'No repository selected.'); return Promise.resolve();
      case 'repo':
        if (!requireAuth()) return Promise.resolve();
        if (args[0] === 'list') return client.listRepos(1).then(function (l) { st.repoList = l; l.forEach(function (r) { log('  ' + r.full_name + (r.private ? '  (private)' : '')); }); render(); }).catch(fail);
        if (args[0] === 'create') { var nm = args[1], pub = args.indexOf('--public') !== -1; if (!nm) { log('Usage: repo create <name> [--public]', 'err'); return Promise.resolve(); } return client.createRepo(nm, !pub, 'Created with DScode').then(function (r) { log('✔ Created ' + r.full_name, 'ok'); return selectRepo(r.full_name); }).catch(fail); }
        log('Usage: repo list | repo create <name> [--public]', 'err'); return Promise.resolve();
      case 'status': if (!requireRepo()) return Promise.resolve(); return refresh().then(printStatus);
      case 'scan': if (!requireRepo()) return Promise.resolve(); return refresh().then(function () { if (!st.findings.length) log('✔ No secrets found in files to push.', 'ok'); st.findings.forEach(function (f) { log('⚠ ' + f.path + (f.line ? ':' + f.line : '') + ' — ' + f.rule + ' (' + f.preview + ')', 'warn'); }); });
      case 'exclude': if (args[0]) { st.excluded[args[0]] = true; log('Excluded ' + args[0] + ' (this session).', 'warn'); return refresh(); } log('Usage: exclude <path>', 'err'); return Promise.resolve();
      case 'include': if (args[0]) { delete st.excluded[args[0]]; return refresh(); } log('Usage: include <path>', 'err'); return Promise.resolve();
      case 'commit': { var mi = args.indexOf('-m'); if (mi === -1 || !args[mi + 1]) { log('Usage: commit -m "message"', 'err'); return Promise.resolve(); } st.message = args[mi + 1]; log('Commit message set.', 'ok'); render(); return Promise.resolve(); }
      case 'pull': if (!requireRepo()) return Promise.resolve(); return refresh().then(function () { return pull(false); });
      case 'push': { if (!requireRepo()) return Promise.resolve(); var m = args.indexOf('-m'); if (m !== -1 && args[m + 1]) st.message = args[m + 1]; if (args.indexOf('--delete-missing') !== -1) st.deleteMissing = true; return push(); }
      case 'branch':
        if (!requireRepo()) return Promise.resolve();
        if (!args[0]) { st.branches.forEach(function (b) { log((b === st.branch ? '* ' : '  ') + b, b === st.branch ? 'ok' : ''); }); return Promise.resolve(); }
        return createBranch(args[0]);
      case 'checkout': if (!requireRepo()) return Promise.resolve(); if (args[0] === '-b' && args[1]) return createBranch(args[1]); return checkout(args[0] || ''); 
      case 'log': if (!requireRepo()) return Promise.resolve(); return client.listCommits(st.owner, st.repo, st.branch, parseInt(args[0], 10) || 10).then(function (cs) { cs.forEach(function (c) { log(c.sha.slice(0, 7) + '  ' + c.commit.message.split('\n')[0] + '  — ' + (c.commit.author ? c.commit.author.name : '?') + ', ' + (c.commit.author ? c.commit.author.date.slice(0, 10) : '')); }); }).catch(fail);
      case 'diff': if (!requireRepo()) return Promise.resolve(); return printDiff(args[0]);
      case 'pr': if (!requireRepo()) return Promise.resolve(); if (args[0] === 'create' && args[1]) { var bi = args.indexOf('--base'); return openPR(args[1], '', bi !== -1 ? args[bi + 1] : undefined); } log('Usage: pr create "title" [--base main]', 'err'); return Promise.resolve();
      default: log('Unknown command: ' + cmd + '. Type help.', 'err'); return Promise.resolve();
    }
  }

  function printStatus() {
    var p = st.plan; if (!p) return;
    log('On branch ' + st.branch + ' of ' + st.info.full_name + (st.sync && st.sync.commit ? '  (synced at ' + st.sync.commit.slice(0, 7) + ')' : '  (never synced)'));
    p.push.add.forEach(function (x) { log('  A  ' + x, 'add'); }); p.push.modify.forEach(function (x) { log('  M  ' + x, 'warn'); }); p.push.del.forEach(function (x) { log('  D  ' + x, 'del'); });
    p.pull.add.concat(p.pull.modify, p.pull.del).forEach(function (x) { log('  P  ' + x + '   (changed on GitHub)', 'hunk'); });
    p.conflicts.forEach(function (c) { log('  C  ' + c.path + '   (' + c.kind + ')', 'err'); });
    p.skippedDeletes.forEach(function (x) { log('  -  ' + x + '   (missing locally, kept on GitHub)', 'dim'); });
    if (!p.push.add.length && !p.push.modify.length && !p.push.del.length && !p.pull.add.length && !p.pull.modify.length && !p.pull.del.length && !p.conflicts.length) log('Nothing to sync.', 'ok');
  }
  function printDiff(path) {
    if (!path) { log('Usage: diff <path>', 'err'); return Promise.resolve(); }
    var local = st.included && st.included[path], sha = st.remote && st.remote.files[path];
    if (!local && !sha) { log('Unknown path: ' + path, 'err'); return Promise.resolve(); }
    var getRemote = sha ? client.getBlob(st.owner, st.repo, sha).then(function (b) { var c = G.classify(path, G.b64ToBytes(b.content)); return c.binary ? null : c.text; }) : Promise.resolve('');
    return getRemote.then(function (rt) {
      if (rt === null || (local && local.binary)) { log('Binary file — ' + (sha && local && st.local[path] === sha ? 'identical' : 'differs') + '.', 'dim'); return; }
      var d = G.lineDiff(rt, local ? local.content : '');
      if (d.tooLarge) { log('File too large for an inline diff.', 'warn'); return; }
      if (!d.added && !d.removed) { log('No differences.', 'ok'); return; }
      log('--- GitHub/' + path + '\n+++ workspace/' + path + '   (+' + d.added + ' −' + d.removed + ')', 'dim');
      d.lines.forEach(function (l) { log((l[0] === '@' ? '' : l[0]) + ' ' + l[1], l[0] === '+' ? 'add' : l[0] === '-' ? 'del' : l[0] === '@' ? 'hunk' : 'dim'); });
    }).catch(fail);
  }

  /* ---------- init ---------- */
  function setMode(m) {
    st.mode = m; $('modeAuto').classList.toggle('active', m === 'auto'); $('modeManual').classList.toggle('active', m === 'manual');
    document.querySelector('.layout').classList.toggle('manual', m === 'manual');
    if (m === 'manual') $('cmd').focus();
  }
  function init() {
    $('modeAuto').addEventListener('click', function () { setMode('auto'); }); $('modeManual').addEventListener('click', function () { setMode('manual'); });
    $('btnClearLog').addEventListener('click', function () { $('log').innerHTML = ''; });
    $('cmd').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { var v = e.target.value; e.target.value = ''; if (v.trim()) { history.push(v); histIdx = history.length; } runCommand(v); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (histIdx > 0) e.target.value = history[--histIdx] || ''; }
      else if (e.key === 'ArrowDown') { e.preventDefault(); histIdx = Math.min(history.length, histIdx + 1); e.target.value = history[histIdx] || ''; }
    });
    window.addEventListener('pagehide', function () { client.clearToken(); });
    var wsTimer = null;
    S.onChange(function (kind) { if (kind === 'workspace' && client.hasToken() && st.info && !st.busy) { clearTimeout(wsTimer); wsTimer = setTimeout(function () { refresh(true); }, 900); } });
    log('Git Push Terminal — real GitHub API calls only. No mock data. Type help for commands.', 'dim');
    var saved = null; try { saved = sessionStorage.getItem(REMEMBER_KEY); } catch (e) {}
    render();
    if (saved) connect('', saved, true);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
