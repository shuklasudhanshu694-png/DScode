const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
let html = fs.readFileSync(path.join(__dirname, 'organizer.template.html'), 'utf8');
html = html.replace(/<!--INLINE:([^>]+)-->/g, (m, file) => {
  const code = fs.readFileSync(path.join(root, file), 'utf8');
  if (/<\/script/i.test(code)) throw new Error(file + ' contains </script');
  return '<script>\n' + code + '\n</script>';
});
if (/<<<<<<<|>>>>>>>|^=======$/m.test(html)) throw new Error('merge markers found');
fs.writeFileSync(path.join(root, 'index.html'), html);
console.log('index.html built (' + html.length + ' bytes, no external scripts)');
