const P = require('../shared/parser.js');
const F = '```';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const byHint = (blocks) => Object.fromEntries(blocks.map((b) => [b.hint || '(none)', b]));

// the user's exact example: name line, language word line, blank, bare fence
const ex1 = '`.env.example`\nbash\n\n' + F + '\nVITE_FB_API_KEY=AIza...\nVITE_FB_AUTH_DOMAIN=your-project.firebaseapp.com\n' + F + '\n';
let b = P.extractBlocks(ex1);
ok(b.length === 1 && b[0].hint === '.env.example' && b[0].lang === 'bash', 'user example: .env.example with "bash" line -> ' + JSON.stringify(b[0] && [b[0].hint, b[0].lang]));
ok(b[0].content.startsWith('VITE_FB_API_KEY'), 'content intact');

// full message shape from the two-user-locator reply
const msg = [
  '# Complete project — folder structure + every file', '', F, 'two-user-locator/', '├── .env.example', '├── .gitignore', '├── package.json', '├── src/', '│   └── main.js', '└── README.md', F, '', '---', '',
  '## `package.json`', '', F + 'json', '{ "name": "x" }', F, '',
  '## `.env.example`', '', F + 'bash', 'VITE_A=1', F, '',
  '## `.gitignore`', '', F, 'node_modules', 'dist', '.env', F, '',
  '## `src/main.js`', '', F + 'js', "import './x.js';", 'boot();', F, '',
  '## `public/sw.js`', '', F + 'js', "const CACHE = 'v1';", F, '',
  '### 3. `src/pages/home.js`', F + 'js', 'export default 1;', F, '',
  '**src/ui/toast.js**', '', F + 'javascript', 'export const t = 1;', F, '',
  '- `functions/package.json`', F + 'json', '{}', F, '',
  'File: tests/geo.test.js', F + 'js', 'test();', F, '',
  '## `Dockerfile`', F + 'dockerfile', 'FROM node:20', F, '',
  '## `README.md`', '', F + 'markdown', '# Locator', '', '## Setup', '', F + 'bash', 'npm install', F, '', F + 'bash', 'npm run dev', F, '', '## Data model', '', F, 'codes/{CODE} -> "r_abc123"', 'rooms/{roomId}/meta { code }', F, '', '## Deliberately left out', '', 'QR-code pairing', F, '',
  '---', '', '### What you have', '', '- **7 pages** (home, live)', '- Tests: geo unit tests', '', 'Run `npm install && cp .env.example .env`, then `npm run dev`.'
].join('\n');
b = P.extractBlocks(msg);
const h = byHint(b);
const names = b.map((x) => x.hint);
ok(!names.includes(null), 'no unnamed blocks, got ' + JSON.stringify(names));
ok(b.length === 11, 'block count 11, got ' + b.length);
ok(h['.env.example'] && h['.env.example'].content === 'VITE_A=1', '.env.example');
ok(h['.gitignore'] && h['.gitignore'].content === 'node_modules\ndist\n.env', '.gitignore bare fence');
ok(h['src/main.js'] && h['src/main.js'].content.includes('boot();'), 'src/main.js');
ok(h['src/pages/home.js'], 'numbered heading');
ok(h['src/ui/toast.js'], 'bold path');
ok(h['functions/package.json'], 'list item');
ok(h['tests/geo.test.js'], 'File: prefix');
ok(h['Dockerfile'] && h['Dockerfile'].lang === 'dockerfile', 'Dockerfile known name');
ok(!b.some((x) => /├──/.test(x.content)), 'tree block not treated as a file');
const rd = h['README.md'];
ok(rd && rd.content.includes('npm run dev') && rd.content.includes('codes/{CODE}') && rd.content.includes('QR-code pairing'), 'README keeps nested fences');
ok(rd && !rd.content.includes('What you have'), 'README stops before trailing prose');

// other formats
b = P.extractBlocks(F + 'js title="src/app.js"\nx\n' + F + '\n' + F + 'js:lib/util.js\ny\n' + F + '\n' + F + 'python main.py\nprint(1)\n' + F + '\n' + F + 'html\n<!-- templates/page.html -->\n<p>hi</p>\n' + F);
ok(b.map((x) => x.hint).join() === 'src/app.js,lib/util.js,main.py,templates/page.html', 'fence-info + first-line comment forms: ' + b.map((x) => x.hint).join());
// prose must not become a name
b = P.extractBlocks('Run `npm install` then edit `x.js`:\n\n' + F + 'bash\nnpm i\n' + F);
ok(b.length === 1 && b[0].hint === null && b[0].lang === 'bash', 'inline code in prose is not a filename');
// version numbers / urls
ok(P.matchHint('## v1.0.0') === null && P.matchHint('See https://x.com/a.js') === null && P.matchHint('## Overview') === null, 'non-paths rejected');
ok(P.isPathLike('.gitignore') === true && P.isPathLike('a/b/c.test.js') === true && P.isPathLike('src/') === false, 'isPathLike');
console.log('pass', pass, 'fail', fail); process.exit(fail ? 1 : 0);
