// 단일 HTML 미리보기 만들기 (추가 설치 불필요)
// public/ 의 화면 코드 + Demo 데이터를 HTML 한 파일(dist/preview.html)로 합칩니다.
// 서버 없이 파일만으로 열어보거나 공유용 미리보기 링크를 만들 때 사용합니다.
// (서비스워커·홈 화면 설치는 실제 배포 주소에서만 동작합니다)

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(root, 'public');
const read = (p) => readFile(path.join(pub, p), 'utf8');

// 아주 단순한 ES 모듈 합치기: 이 프로젝트에서 쓰는 import/export 형태만 지원
const modules = new Map(); // id -> code
async function load(rel) {
  const id = path.posix.normalize(rel);
  if (modules.has(id)) return;
  modules.set(id, null);
  let src = await read(id);
  const deps = [];
  src = src.replace(/^import\s+(.+?)\s+from\s+'(.+?)';?\s*$/gm, (_, what, from) => {
    const dep = path.posix.join(path.posix.dirname(id), from);
    deps.push(dep);
    const ns = what.match(/^\*\s+as\s+(\w+)$/);
    return ns ? `const ${ns[1]} = __m[${JSON.stringify(dep)}];` : `const ${what.replace(/\s+as\s+/g, ': ')} = __m[${JSON.stringify(dep)}];`;
  });
  const names = [];
  src = src.replace(/^export\s+(async\s+function|function|const|let|class)\s+(\w+)/gm, (_, kind, name) => {
    names.push(name);
    return `${kind} ${name}`;
  });
  for (const d of deps) await load(d);
  modules.set(id, `__m[${JSON.stringify(id)}] = (() => {\n${src}\nreturn { ${names.join(', ')} };\n})();`);
}
await load('js/app.js');
// 의존 순서대로 (app.js 가 마지막)
const order = [...modules.keys()].reverse();
const sorted = [];
const seen = new Set();
function visit(id) {
  if (seen.has(id)) return;
  seen.add(id);
  const code = modules.get(id);
  for (const m of code.matchAll(/__m\["(.+?)"\]/g)) if (m[1] !== id) visit(m[1]);
  sorted.push(code);
}
order.forEach(visit);

const briefing = JSON.parse(await read('data/demo/briefing.json'));
const stats = JSON.parse(await read('data/demo/keyword-stats.json'));
const css = await read('css/app.css');
let html = await read('index.html');

const inline = JSON.stringify({ briefing, stats }).replace(/</g, '\\u003c');
const js = `window.__MOBIBRIEF_INLINE__ = ${inline};\n(() => {\nconst __m = {};\n${sorted.join('\n')}\n})();`;

html = html
  .replace(/<!doctype html>\s*<html lang="ko">\s*<head>/i, '')
  .replace(/<\/head>\s*<body>/i, '')
  .replace(/<\/body>\s*<\/html>\s*$/i, '')
  .replace(/<meta charset[^>]*>\s*/i, '')
  .replace(/<meta name="viewport"[^>]*>\s*/i, '')
  .replace(/<!-- @preview-strip-start -->[\s\S]*?<!-- @preview-strip-end -->\s*/g, '')
  .replace(/<link rel="(manifest|icon|apple-touch-icon)"[^>]*>\s*/g, '')
  .replace('<link rel="stylesheet" href="css/app.css">', `<style>\n${css}\n</style>`)
  .replace('<script type="module" src="js/app.js"></script>', () => `<script>\n${js}\n</script>`)
  .replace(/href="#\/(\w+)"/g, 'href="#$1"');

await mkdir(path.join(root, 'dist'), { recursive: true });
await writeFile(path.join(root, 'dist/preview.html'), html.trim() + '\n');
console.log(`✅ dist/preview.html 생성 (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB, 모듈 ${sorted.length}개)`);
