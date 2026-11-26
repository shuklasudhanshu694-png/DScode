# DScode project — Organizer + Web IDE + Git Push Terminal

```
your-project/
├── index.html        Organizer: paste Markdown → review files → ZIP, or open in DScode
├── shared/           store.js (IndexedDB workspace, git SHA-1, cross-tab sync), parser.js (Markdown code-block/filename parser), zip.js
├── dscode/           The IDE (index.html, style.css, lang/lint/assist/preview/files/editing/tools/main .js)
├── terminal/         Git Push Terminal (strict CSP, gitclient.js = hardened GitHub client)
├── tests/            node tests/gitclient.test.js (39 Git checks) · node tests/parser.test.js (19 filename-detection checks)
├── tools/            organizer.template.html + build-organizer.js (inlines parser/zip into index.html)
└── _headers          Netlify security headers (CSP, frame blocking)
```

## Run it
`index.html` (the Organizer) is a **single self-contained file**: it works on its own, from `file://`, or on any host, with no other files. DScode and the Git terminal need the whole project folder (keep `shared/` next to them); if a file is missing they now say so on screen instead of silently doing nothing. When replacing a file, replace the **entire** file — pasting patch fragments (lines such as `=======`) into an existing file corrupts it. If you change `shared/parser.js` or `shared/zip.js`, run `node tools/build-organizer.js` to refresh `index.html`.

Serve over http(s) (Netlify, or `python3 -m http.server`). Opening via `file://` can give each page its own isolated storage, so the three tools would not share the workspace.
Deploy on Netlify: drag the folder in; `_headers` is picked up automatically.

## What was wrong in the version you uploaded
1. **Dead buttons (root cause):** `dscode/app.js` called `$('btnToggleTerminal')`, an element that does not exist. `null.addEventListener` threw inside `init()`, so every binding after it (sidebar toggle, new file, run, download…) never ran. Also `app.js` was missing its closing `})();`.
2. **Data loss:** the Organizer's "Open in DScode" overwrote the entire workspace in `localStorage`. It now writes to a separate inbox key; DScode merges it and asks before overwriting.
3. **Silent save failures:** `catch (e) {}` around `localStorage` (5 MB cap, text only). Replaced by IndexedDB with visible error toasts, a save indicator and binary-file support.
4. **Preview sandbox:** `allow-same-origin` + `allow-scripts` let any pasted code read your workspace. Removed (see Preview below).
5. **Git terminal:** `force: true` pushes (could silently destroy remote history); `res.json()` read twice on 403; repo names containing dots (e.g. `me.github.io`) mis-parsed; remote data inserted via `innerHTML` (XSS); push uploaded every file every time; no empty-repo handling; no conflict detection; no deletion handling.
6. Highlighting was regex-on-HTML (broke on strings/regex/template literals), bracket lint was line-based, undo history was destroyed by programmatic edits, `prompt()/confirm()` dialogs.

## Organizer: file-name detection and extras
**Why names were missed:** the old parser only looked at the single line directly above a code fence. A line such as `bash` between `.env.example` and the fence hid the name, dotfiles without a second dot (`.gitignore`) and extensionless names (`Dockerfile`) were not recognised, a `README.md` containing its own ``` blocks was cut at the first inner fence, and the project-tree block itself became a bogus `file.txt`.

`shared/parser.js` now:
- looks back up to 8 lines, skipping blanks, `---` separators and language words (`bash`, `json`, `js`…);
- accepts `## \`path\``, `### 1. \`path\``, `**path**`, `- \`path\``, `File: path`, a bare `path` line, and fence info such as ```` ```js title="src/app.js" ````, ```` ```js:src/app.js ````, ```` ```python main.py ````, plus a first-line comment (`// src/app.js`);
- recognises dotfiles and known extensionless names, and rejects prose, URLs and version numbers (`v1.0.0`) as file names;
- keeps nested fences inside Markdown files intact and ignores the tree block.

New in the Organizer: review list with include/exclude checkboxes, editable paths (guessed names are highlighted amber), preview / copy / download per file, duplicate-path guard, "remove top-level folder", copy path list, **Paste** button, drop a `.md`/`.txt` file on the box, `Ctrl+Enter` to organize, and a **History** (restore, delete one, clear all; on by default, switch off with the checkbox; stored only in this browser).
Empty folders from the tree are kept in the ZIP. DScode's *Import from text* uses the same parser (it has no tree matching, so use the Organizer when you want the tree's folder prefix).

## DScode features
- **Editor:** real tokenizers (JS/TS, HTML with embedded CSS/JS/JSON, CSS, JSON, Python, Markdown, YAML, shell); native undo preserved; auto-indent, auto-close pairs/tags, wrap-selection, soft-tab backspace, move/duplicate/delete line, comment toggle, bracket matching, squiggles + gutter markers, large-file mode (>1.5 MB).
- **Intelligence:** context-aware completion (DOM/console/Math members, HTML tags/attributes/values, CSS properties/values/pseudos, closing-tag suggestion, identifiers from all files), snippets, **Emmet** (`ul>li.item$*3>a`, `!`), CSS abbreviations (`m10`, `df`, `jcc`).
- **Linting (live):** JS uses the browser's own parser with a bisection to find the line; HTML (nesting, optional end tags, duplicate ids, missing alt/lang/doctype/title, **links to files that don't exist in the workspace**, embedded JS/CSS/JSON); CSS (unknown property with "did you mean", missing `;`, empty value); JSON with exact line; Python (indentation, missing `:`, `=` in `if`, brackets, py2 print); YAML (tabs, duplicate keys, quotes). *Lint all files* in the palette.
- **Preview:** inlines CSS/JS/images/fonts and local ES-module imports; console, runtime errors with the **original file:line**, JS REPL, `fetch`/XHR of workspace files, in-page link navigation, device widths, live reload, export as one standalone HTML.
- **Workspace:** folders, drag-and-drop move, OS drag-and-drop of files/folders, ZIP import/export (binary-safe), images viewer, rename/duplicate/delete with **Undo**, find/replace (regex, whole word), search/replace across files, Ctrl+P / Ctrl+Shift+P palette, Git badges (A/M, ● on folders, ⎇ status bar).
- Shortcuts: Ctrl+P open, Ctrl+Shift+P commands, Ctrl+Enter run, Ctrl+F / H find/replace, Ctrl+Shift+F search all, Ctrl+G go to line, Ctrl+/ comment, Ctrl+D duplicate, Alt+↑/↓ move line, Ctrl+Shift+K delete line, Ctrl+Space complete, Ctrl+B sidebar, Ctrl+` panel.

## Git Push Terminal — how it works and how it is secured
It talks to the GitHub REST API only (no mock data). It computes real **git blob SHA-1s** locally and does a **three-way comparison** (local / last-synced baseline / GitHub), so it uploads only changed files, pulls remote-only changes, and detects true conflicts.
- **Token:** held only in a JS closure (never `localStorage`, never in URLs/logs); masked input; cleared from the field immediately; wiped after 20 min idle, on disconnect and on page hide; optional per-tab `sessionStorage` is opt-in and off by default. Sent only as `Authorization: Bearer` to `https://api.github.com` with `credentials: omit`, `no-referrer`; responses from other hosts are rejected; any error text is scrubbed of tokens.
- **Verification:** token is validated with `GET /user`; username (if typed) must match; shows token type, scopes, expiry, rate limit; warns for classic/over-broad tokens and for "read-only" repo access.
- **Never destructive:** fast-forward-only ref updates (`force: false`); if the branch moved meanwhile, nothing is overwritten. Deletions are not propagated unless you enable it. Pulls never overwrite local edits except files you explicitly mark "take theirs".
- **Secret scanner** before every push (GitHub/AWS/Slack/Stripe/LLM keys, private keys, JWTs, high-entropy credentials, `.env`/`*.pem`/`id_rsa`…): exclude files, cancel, or type `PUSH SECRETS`. `.gitignore` is honoured.
- **Default-branch safety:** pushing to a public repo's default branch requires typing the branch name; "new branch → pull request" is built in.
- **Also:** branch create/switch, empty-repo bootstrap, repo create (private by default), PR creation, retries with backoff and secondary-rate-limit handling, per-path/branch validation, strict CSP with no inline script/style, manual commands (`status diff log branch checkout pull push commit remote repo pr scan exclude auth`). Tokens are never typed on the command line (`auth login` opens a masked prompt).

## Honest limitations
- Verified in headless Chromium and Node only; Firefox/Safari not tested.
- The Git bridge is the GitHub API, not real git: conflicts are file-level (no line merges), no submodules/symlinks/LFS, files >40 MB skipped, repos whose tree listing is truncated are refused, one repo at a time, commits are authored by the token owner.
- Python/YAML linting is heuristic, TS/JSX get bracket checks only (no type checking).
- Preview runs without same-origin for safety: `localStorage` is emulated (persisted by DScode), cookies/IndexedDB/service workers are unavailable; circular local ES-module imports are not supported.
- A token in browser memory is still exposed to XSS on the same origin — hence the CSP and the advice to use a fine-grained, single-repo, short-expiry token.
- Two tabs writing the same workspace: last write wins (the IDE flushes before a push/pull and adopts external changes with a toast).
