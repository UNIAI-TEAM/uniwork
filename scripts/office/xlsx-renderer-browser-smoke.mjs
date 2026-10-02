// Real Chromium regression for the built artifact and the production model
// bridge. Run after build-xlsx-browser.mjs; requires the existing e2e browser.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { REPO_ROOT } from '../office-g0/paths.mjs';

const require = createRequire(path.join(REPO_ROOT, 'packages/office-upstream/package.json'));
const browserRequire = createRequire(path.join(REPO_ROOT, 'e2e/package.json'));
const { chromium } = browserRequire('@playwright/test');
const modules = new Map();
const specs = [['react', 'R'], ['react/jsx-runtime', 'J'], ['react-dom', 'D'], ['react-dom/client', 'C'], ['i18next', 'I']];
const imports = specs.map(([spec, name]) => `import * as ${name} from ${JSON.stringify(require.resolve(spec).replaceAll('\\', '/'))};`).join('\n');
const externals = await build({ stdin: { contents: `${imports}\nexport {R,J,D,C,I};`, resolveDir: REPO_ROOT }, bundle: true, write: false, format: 'esm', platform: 'browser', define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'error' });
modules.set('/externals.mjs', externals.outputFiles[0].text);
const importMap = {};
for (const [spec, name] of specs) {
  const url = `/external-${name}.mjs`;
  importMap[spec] = url;
  const names = Object.keys(require(spec)).filter(key => /^[A-Za-z_$][\w$]*$/.test(key) && key !== 'default');
  modules.set(url, `import {${name} as M} from '/externals.mjs';\nexport default M.default ?? M;\n` + names.map(key => `export const ${key} = M.${key};`).join('\n'));
}
const bridge = await build({ entryPoints: [path.join(REPO_ROOT, 'packages/views/office/xlsx/xlsx-render-model-bridge.ts')], bundle: true, write: false, format: 'esm', platform: 'browser', logLevel: 'error' });
modules.set('/bridge.mjs', bridge.outputFiles[0].text);
const html = `<!doctype html><meta charset="utf-8"><script type="importmap">${JSON.stringify({ imports: importMap })}</script>
<body style="margin:0"><div id="grid" style="width:1100px;height:500px"></div><script type="module">
import { createXlsxRenderer, installXlsxRendererStyles } from '/artifact.mjs';
import { createXlsxModelHost } from '/bridge.mjs';
const model={revision:1,activeTab:0,date1904:false,styles:[],dxfStyles:[],sheets:[{id:'sheet-1',name:'Data',rowCount:50,columnCount:10,merges:[],columnWidths:[],rowsMeta:[],hyperlinks:[],cells:{A1:{v:'hello'},B2:{v:42}}}]};
window.messages=[];
installXlsxRendererStyles(document);
const host=createXlsxModelHost(model,{sessionId:'smoke',name:'test.xlsx',sha256:'a'.repeat(64)});
window.handle=createXlsxRenderer({container:document.getElementById('grid'),host,onMessage:m=>window.messages.push(m)});
await window.handle.loadWorkbook(host.file);
window.loaded=true;
</script>`;
const server = http.createServer((request, response) => {
  if (request.url === '/artifact.mjs') {
    response.writeHead(200, { 'Content-Type': 'text/javascript' });
    fs.createReadStream(path.join(REPO_ROOT, 'packages/office-upstream/dist/xlsx-renderer.mjs')).pipe(response);
  } else if (modules.has(request.url)) {
    response.writeHead(200, { 'Content-Type': 'text/javascript' });
    response.end(modules.get(request.url));
  } else if (request.url === '/') {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end(html);
  } else { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.addInitScript(() => {
    window.paint = [];
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text, ...args) {
      window.paint.push(String(text));
      return original.call(this, text, ...args);
    };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.loaded === true, null, { timeout: 60000 });
  await page.waitForFunction(() => window.paint.includes('hello') && window.paint.includes('42'));
  assert.equal(await page.evaluate(() => window.handle.getDirtyGeneration()), 0, 'open stays clean');
  await page.evaluate(() => window.handle.setCellText('sheet-1', 0, 0, 'changed'));
  await page.waitForFunction(() => window.paint.includes('changed'));
  assert.ok(await page.evaluate(() => window.handle.getDirtyGeneration()) > 0, 'actual edit emits dirty');
  await page.evaluate(() => { window.paint = []; window.handle.undo(); });
  await page.waitForFunction(() => window.paint.includes('hello'));
  await page.evaluate(() => { window.paint = []; window.handle.redo(); });
  await page.waitForFunction(() => window.paint.includes('changed'));
  await page.evaluate(() => window.handle.setDarkMode(true));
  await page.evaluate(() => { window.handle.dispose(); });
  assert.equal(await page.locator('#grid canvas').count(), 0, 'dispose removes the rendered grid');
  assert.deepEqual(errors, [], 'no browser runtime errors');
  console.log(JSON.stringify({ outcome: 'passed', checks: ['actual bridge/artifact', 'cell paint', 'clean open', 'edit', 'undo', 'redo', 'dark switch', 'dispose'], messages: await page.evaluate(() => window.messages) }));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
