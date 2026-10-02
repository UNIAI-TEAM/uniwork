// Real Chromium regression for the built artifact and the production model
// bridge. Run after build-xlsx-browser.mjs; requires the existing e2e browser.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { REPO_ROOT } from '../office-g0/paths.mjs';

const require = createRequire(path.join(REPO_ROOT, 'packages/office-upstream/package.json'));
const browserRequire = createRequire(path.join(REPO_ROOT, 'e2e/package.json'));
const { chromium } = browserRequire('@playwright/test');
const evidenceDir = process.env.XLSX_RENDERER_SMOKE_REPORT_DIR;
const navigationBaseline = process.env.XLSX_NAVIGATION_BASELINE === '1';
const profile = path.join(REPO_ROOT, '.go-tmp', `xlsx-smoke-profile-${process.pid}`);
const models = new Map([['', { revision:1,activeTab:0,date1904:false,styles:[],dxfStyles:[],sheets:[{
  id:'sheet-1',name:'Data',rowCount:50,columnCount:10,merges:[],columnWidths:[],rowsMeta:[],hyperlinks:[],cells:{A1:{v:'hello'},B2:{v:42}},
}] }]]);
const fixtures = path.resolve(REPO_ROOT, '../../../office-g3g4/reports/g3-d3-xlsx/fixtures');
const corpus = ['features.xlsx', 'composite-seed.xlsx', 'styled2000.xlsx'];
const digests = {};
const declaredFont = structuredClone(models.get(''));
declaredFont.styles=[{fontFamily:'Verdana',fontSize:11,bold:false,italic:false,underline:false,strikethrough:false,wrapText:false,diagonalUp:false,diagonalDown:false}];
models.set('declared-font',declaredFont);
if (fs.existsSync(path.join(REPO_ROOT,'docs/office/g0/fixtures/files/sheets/xlsx-kitchen-sink.xlsx'))) {
  const scratch = path.join(REPO_ROOT, `.go-tmp/uni824-r5-smoke-${process.pid}`);
  fs.mkdirSync(scratch, { recursive:true });
  const readerPath = path.join(scratch, 'reader.mjs');
  const gatewayPath = path.join(scratch, 'gateway.mjs');
  await build({ stdin:{contents:`export {readXlsxRenderModel} from './packages/office-engine/src/xlsx/render-model.ts'; export {bindXlsxGateway} from './packages/office-engine/src/xlsx/vendor.ts';`, resolveDir:REPO_ROOT},
    bundle:true,format:'esm',platform:'node',outfile:readerPath,logLevel:'error' });
  await build({ entryPoints:[path.join(REPO_ROOT,'.go-tmp/xlsx-browser-build/upstream/packages/xlsx-gateway/src/gateway/xlsx-gateway.ts')],
    bundle:true,format:'esm',platform:'node',outfile:gatewayPath,nodePaths:[path.join(REPO_ROOT,'packages/office-upstream/node_modules')],logLevel:'error' });
  const reader = await import(pathToFileURL(readerPath).href);
  const gateway = reader.bindXlsxGateway(await import(pathToFileURL(gatewayPath).href));
  const kitchenBytes=new Uint8Array(fs.readFileSync(path.join(REPO_ROOT,'docs/office/g0/fixtures/files/sheets/xlsx-kitchen-sink.xlsx')));
  models.set('kitchen',await reader.readXlsxRenderModel(gateway,kitchenBytes));
  digests['xlsx-kitchen-sink.xlsx']=createHash('sha256').update(kitchenBytes).digest('hex');
  for (const name of corpus.filter(name=>fs.existsSync(path.join(fixtures,name)))) {
    const bytes = new Uint8Array(fs.readFileSync(path.join(fixtures,name)));
    digests[name] = createHash('sha256').update(bytes).digest('hex');
    models.set(name,await reader.readXlsxRenderModel(gateway,bytes));
  }
}
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
const model=await (await fetch('/model'+location.search)).json();
window.messages=[];
window.edits=[];
installXlsxRendererStyles(document);
const host=createXlsxModelHost(model,{sessionId:'smoke',name:'test.xlsx',sha256:'a'.repeat(64)});
window.handle=createXlsxRenderer({container:document.getElementById('grid'),host,readOnly:new URLSearchParams(location.search).has('readonly'),onMessage:m=>window.messages.push(m),onEdits:batch=>window.edits.push(...batch),onSelectionChange:selection=>window.selection=selection});
await window.handle.loadWorkbook(host.file);
window.loaded=true;
</script>`;
const server = http.createServer((request, response) => {
  const url = new URL(request.url,'http://localhost');
  if (url.pathname === '/model') {
    response.writeHead(200, {'Content-Type':'application/json'});
    response.end(JSON.stringify(models.get(url.searchParams.get('fixture') ?? '')));
  } else if (request.url === '/artifact.mjs') {
    response.writeHead(200, { 'Content-Type': 'text/javascript' });
    fs.createReadStream(path.join(REPO_ROOT, 'packages/office-upstream/dist/xlsx-renderer.mjs')).pipe(response);
  } else if (modules.has(request.url)) {
    response.writeHead(200, { 'Content-Type': 'text/javascript' });
    response.end(modules.get(request.url));
  } else if (url.pathname === '/') {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end(html);
  } else { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
console.log(JSON.stringify({harnessPid:process.pid,port:server.address().port,fixtureDigests:digests,
  artifactSha256:createHash('sha256').update(fs.readFileSync(path.join(REPO_ROOT,'packages/office-upstream/dist/xlsx-renderer.mjs'))).digest('hex')}));
let browser;
try {
  browser = await chromium.launchPersistentContext(profile, { headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.addInitScript(() => {
    window.paint = [];
    window.draws = [];
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text, ...args) {
      window.paint.push(String(text));
      window.draws.push({text:String(text),font:this.font,color:this.fillStyle,x:args[0],y:args[1]});
      return original.call(this, text, ...args);
    };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/?fixture=kitchen`);
  await page.waitForFunction(()=>window.loaded===true);
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('#grid canvas')).some(c=>c.width>500&&c.height>100)&&window.paint.length>20);
  // B2 center from the separately recorded actual skeleton geometry:
  // x115.333..184.667 / y40..60 on the original kitchen-sink sheet.
  await page.mouse.click(150,50);
  await page.waitForFunction(()=>window.selection?.range.startRow===1&&window.selection?.range.startColumn===1);
  console.log(JSON.stringify({originalKitchenB2:await page.evaluate(()=>window.selection)}));
  const shiftedEdits = [];
  for (const [key, text, row, column] of [['Shift+Tab','116',1,0], ['Shift+Enter','117',0,1]]) {
    await page.mouse.dblclick(150,50);
    await page.keyboard.press('Control+A');
    await page.keyboard.type(text);
    const editingTarget = await page.evaluate(() => ({ tag: document.activeElement?.tagName,
      html: document.activeElement?.outerHTML.slice(0,500), editing: document.activeElement?.isContentEditable }));
    await page.keyboard.press(key);
    await page.waitForTimeout(200);
    const observation = await page.evaluate(text => ({ selection: window.selection,
      committed: window.edits.some(edit => String(edit.value) === text),
      focusInGrid: document.getElementById('grid').contains(document.activeElement),
      nativeGridFocus: document.activeElement?.id==='__editor___INTERNAL_EDITOR__DOCS_NORMAL' && document.activeElement.isContentEditable,
      focus: document.activeElement?.outerHTML.slice(0,500) }), text);
    shiftedEdits.push({key,editingTarget,...observation});
    console.log(JSON.stringify({shiftedInlineEdit:shiftedEdits.at(-1)}));
    if (!navigationBaseline) {
      assert.ok(observation.committed, `${key} commits before any subsequent pointer`);
      assert.equal(observation.selection?.range.startRow,row,`${key} row`);
      assert.equal(observation.selection?.range.startColumn,column,`${key} column`);
      assert.ok(observation.focusInGrid, `${key} retains actual grid focus`);
      assert.ok(observation.nativeGridFocus, `${key} retains the native grid input, excluding sidebar controls`);
    }
    await page.keyboard.press('Escape');
    await page.mouse.click(150,50);
  }
  await page.keyboard.press('Shift+Tab');
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const shiftedTab=await page.evaluate(()=>window.selection);
  await page.mouse.click(150,50);
  await page.waitForFunction(()=>window.selection?.range.startRow===1&&window.selection?.range.startColumn===1);
  await page.keyboard.press('Shift+Enter');
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  console.log(JSON.stringify({shiftedNavigationObservation:{tab:shiftedTab,enter:await page.evaluate(()=>window.selection)}}));
  if (evidenceDir) fs.writeFileSync(path.join(evidenceDir,'shifted-inline-navigation.json'),JSON.stringify({navigationBaseline,shiftedEdits},null,2));
  if(evidenceDir)await page.screenshot({path:path.join(evidenceDir,'renderer-fixes-r3-kitchen-selection.png')});
  await page.mouse.move(1200,700);
  await page.evaluate(()=>window.handle.dispose());
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.loaded === true, null, { timeout: 60000 });
  await page.waitForFunction(() => window.paint.includes('hello') && window.paint.includes('42'));
  assert.ok(await page.evaluate(()=>window.draws.find(op=>op.text==='hello')?.font.includes('Arial')),'styleless workbook keeps renderer default');
  assert.equal(await page.evaluate(() => window.handle.getDirtyGeneration()), 0, 'open stays clean');
  const enterText = async text => {
    await page.mouse.dblclick(80,30);
    await page.keyboard.press('Control+A');
    await page.keyboard.type(text);
  };
  await enterText('keyboard-enter');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.edits.some(edit=>edit.value==='keyboard-enter'));
  await enterText('keyboard-tab');
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => window.edits.some(edit=>edit.value==='keyboard-tab'));
  const beforeEscape=await page.evaluate(()=>window.edits.length);
  await enterText('escape-cancelled');
  await page.keyboard.press('Escape');
  await page.evaluate(()=>window.handle.commitEdit());
  assert.equal(await page.evaluate(()=>window.edits.length),beforeEscape,'Escape cancels pending content');
  await enterText('explicit-commit');
  await page.evaluate(() => window.handle.commitEdit());
  assert.ok(await page.evaluate(() => window.edits.some(edit=>edit.value==='explicit-commit')), 'public commitEdit flushes the actual pending edit');
  await page.evaluate(() => window.handle.setCellText('sheet-1', 0, 0, 'changed'));
  await page.waitForFunction(() => window.paint.includes('changed'));
  assert.ok(await page.evaluate(() => window.handle.getDirtyGeneration()) > 0, 'actual edit emits dirty');
  await page.evaluate(() => { window.paint = []; window.handle.undo(); });
  await page.waitForFunction(() => window.paint.includes('explicit-commit'));
  await page.evaluate(() => { window.paint = []; window.handle.redo(); });
  await page.waitForFunction(() => window.paint.includes('changed'));
  if (evidenceDir) await page.screenshot({path:path.join(evidenceDir,'renderer-fixes-r3-keyboard.png')});
  await page.evaluate(() => window.handle.setDarkMode(true));
  await page.evaluate(() => { window.handle.dispose(); });
  assert.equal(await page.locator('#grid canvas').count(), 0, 'dispose removes the rendered grid');
  assert.deepEqual(errors, [], 'no browser runtime errors');
  await page.goto(`http://127.0.0.1:${server.address().port}/?readonly`);
  await page.waitForFunction(() => window.loaded === true && window.paint.includes('hello'));
  await enterText('forbidden');await page.keyboard.press('Enter');
  await page.evaluate(async () => { window.handle.setCellText('sheet-1',0,0,'forbidden');await window.handle.commitEdit(); });
  assert.deepEqual(await page.evaluate(() => window.edits), [], 'readonly native keyboard/public edits stay blocked');
  assert.equal(await page.evaluate(() => window.handle.getDirtyGeneration()), 0);
  await page.goto(`http://127.0.0.1:${server.address().port}/?fixture=declared-font`);
  await page.waitForFunction(()=>window.loaded===true&&window.draws.some(op=>op.text==='hello'));
  assert.ok(await page.evaluate(()=>window.draws.find(op=>op.text==='hello')?.font.includes('Verdana')),'declared non-Calibri font retained');
  await page.evaluate(()=>window.handle.dispose());
  for (const name of corpus.filter(name=>models.has(name))) {
    await page.goto(`http://127.0.0.1:${server.address().port}/?fixture=${name}`);
    await page.waitForFunction(() => window.loaded === true);
    // Reset observation history, then force a complete fresh frame. Prior
    // sheet paints must never prove text/font presence in the current frame.
    await page.evaluate(() => {window.draws=[];window.paint=[];});
    await page.setViewportSize({width:1441,height:900});
    await page.setViewportSize({width:1440,height:900});
    await page.waitForFunction(() => window.draws.length>30);
    if (name==='styled2000.xlsx') {
      await page.waitForFunction(() => window.draws.some(op=>op.text==='Cột 1') && window.draws.some(op=>op.text==='Cột 8'));
      assert.ok(await page.evaluate(()=>window.draws.filter(op=>/^Cột /.test(op.text)).every(op=>op.font.includes('Calibri'))));
      const header = await page.evaluate(()=>window.draws.find(op=>op.text==='Cột 1'));
      await page.evaluate(async()=>{window.draws=[];await window.handle.revealCell('sheet-1',1000,0);});
      await page.waitForFunction(()=>window.draws.some(op=>op.text==='Cột 1'));
      assert.ok(Math.abs((await page.evaluate(()=>window.draws.find(op=>op.text==='Cột 1').y))-header.y)<=2,'frozen header text remains in place after scroll');
      if (evidenceDir) await page.screenshot({path:path.join(evidenceDir,'renderer-fixes-r3-styled-frozen-scroll.png')});
    }
    if (name==='composite-seed.xlsx') {
      await page.waitForFunction(()=>window.draws.some(op=>op.text==='1.25E+09'));
      assert.ok(await page.evaluate(()=>window.draws.find(op=>op.text==='Doanh thu')?.font.includes('Calibri')),'unstyled workbook default retained');
    }
    if (name==='features.xlsx') {
      await page.waitForFunction(()=>window.draws.some(op=>op.color.toLowerCase()==='#9c0006'),null,{timeout:15000});
      const colors=await page.evaluate(()=>Array.from(document.querySelectorAll('#grid canvas')).filter(canvas=>canvas.width>0&&canvas.height>0).map(canvas=>{
        const data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let pink=0;
        for(let i=0;i<data.length;i+=4)if(data[i]===255&&data[i+1]===199&&data[i+2]===206&&data[i+3]===255)pink++;
        return pink;
      }));
      assert.ok(colors.some(count=>count>100),'conditional pink fill is actually painted');
      for (const value of ['99,999,999 ₫','457,000,000 ₫']) assert.ok(await page.evaluate(text=>window.draws.some(op=>op.text.replace(/\s/g,' ')===text&&op.color.toLowerCase()==='#9c0006'),value),'both D5/D7 conditional text colors are painted');
    }
    const draws=await page.evaluate(()=>window.draws);
    console.log(JSON.stringify({fixture:name,drawCount:draws.length,observed:draws.filter(op=>/^(Cột [1-8]|Doanh thu|1\.25E\+09|99,999,999\s₫|457,000,000\s₫)$/.test(op.text)),messages:await page.evaluate(()=>window.messages)}));
    if(evidenceDir) fs.writeFileSync(path.join(evidenceDir,`renderer-fixes-r3-${name.replace('.xlsx','')}-draws.json`),JSON.stringify(draws,null,2)+'\n');
    if (evidenceDir) await page.screenshot({path:path.join(evidenceDir,`renderer-fixes-r3-${name.replace('.xlsx','')}.png`)});
    await page.evaluate(()=>window.handle.dispose());
  }
  if(models.has('features.xlsx')) {
    await page.goto(`http://127.0.0.1:${server.address().port}/?fixture=features.xlsx&readonly`);
    await page.waitForFunction(()=>window.loaded===true&&window.draws.some(op=>op.color.toLowerCase()==='#9c0006'),null,{timeout:15000});
    for(const value of ['99,999,999 ₫','457,000,000 ₫']) assert.ok(await page.evaluate(text=>window.draws.some(op=>op.text.replace(/\s/g,' ')===text&&op.color.toLowerCase()==='#9c0006'),value),'readonly CF paints both D5/D7');
    const pink=await page.evaluate(()=>Array.from(document.querySelectorAll('#grid canvas')).filter(c=>c.width&&c.height).some(c=>{
      const data=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
      for(let i=0;i<data.length;i+=4)if(data[i]===255&&data[i+1]===199&&data[i+2]===206&&data[i+3]===255)return true;
      return false;
    }));
    assert.equal(pink,true,'readonly CF fill painted');
    await enterText('forbidden');await page.keyboard.press('Tab');
    await page.evaluate(async()=>{window.handle.setCellText('sheet-1',4,3,'forbidden');window.handle.setNumberFormat('0.00');window.handle.undo();window.handle.redo();await window.handle.commitEdit();});
    assert.deepEqual(await page.evaluate(()=>window.edits),[]);
    assert.equal(await page.evaluate(()=>window.handle.getDirtyGeneration()),0);
    if(evidenceDir)await page.screenshot({path:path.join(evidenceDir,'renderer-fixes-r3-features-readonly.png')});
    await page.evaluate(()=>window.handle.dispose());
  }
  assert.deepEqual(errors, [], 'no browser runtime errors in corpus/readonly mounts');
  console.log(JSON.stringify({ outcome: 'passed', checks: ['actual bridge/artifact','original kitchen B2 selection', 'cell paint', 'clean open', 'Enter commit','Tab commit','Escape cancel','pending edit commitEdit','edit', 'undo', 'redo', 'readonly keyboard/public gate','readonly original CF paint','styleless/default/non-Calibri fonts','fresh corpus CF/font/frozen/header/General frames', 'dark switch', 'dispose'],shiftedNavigation:navigationBaseline?'baseline diagnostic':'committed A2/B1 with grid focus',corpusNotRun:corpus.filter(name=>!models.has(name)) }));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
  const resolvedProfile = path.resolve(profile);
  assert.ok(resolvedProfile.startsWith(path.resolve(REPO_ROOT, '.go-tmp') + path.sep));
  fs.rmSync(resolvedProfile, { recursive:true, force:true });
}
