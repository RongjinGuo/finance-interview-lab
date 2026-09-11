import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let html = await readFile(path.join(root, 'index.html'), 'utf8');
html = html.replace(/\s*<script src="src\/(?:visit-config|visits|account-config|accounts)\.js"><\/script>/g, '');
html = html.replace(/\s*<link rel="stylesheet" href="src\/account\.css">/g, '');
const css = await readFile(path.join(root, 'src/styles.css'), 'utf8');
html = html.replace('<link rel="stylesheet" href="src/styles.css">', () => `<style>\n${css}\n</style>`);
for (const name of ['questions', 'engine', 'app']) {
  const js = (await readFile(path.join(root, `src/${name}.js`), 'utf8')).replace(/<\/script/gi, '<\\/script');
  html = html.replace(`<script src="src/${name}.js"></script>`, () => `<script>\n${js}\n</script>`);
}
await mkdir(path.join(root, 'dist'), { recursive: true });
const output = path.join(root, 'dist', '财务面试练习室.html');
await writeFile(output, html);
console.log(`Built standalone HTML (${Math.round(Buffer.byteLength(html) / 1024)} KB): ${output}`);
