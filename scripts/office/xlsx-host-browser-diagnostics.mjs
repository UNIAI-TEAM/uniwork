// Real Shared host/shell geometry and XLSX negotiation composition in Chromium.
// Injected capability/session ports are diagnostics, never native Go acceptance.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { REPO_ROOT } from '../office-g0/paths.mjs';

const baseline = process.argv.includes('--baseline');
const base = '642d35bde1ec8aaec4526804b31e3334739436aa';
const evidence = path.join(REPO_ROOT, '.go-tmp/uni824-r5', baseline ? 'host-before' : 'host-after');
fs.mkdirSync(evidence, { recursive: true });
const scratch = path.join(REPO_ROOT, '.go-tmp', `uni824-host-browser-${process.pid}`);
fs.mkdirSync(scratch, { recursive: true });
process.env.TMP = scratch;
process.env.TEMP = scratch;
const viewRequire = createRequire(path.join(REPO_ROOT, 'packages/views/package.json'));
const { chromium } = createRequire(path.join(REPO_ROOT, 'e2e/package.json'))('@playwright/test');
const alias = Object.fromEntries(['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'].map(spec => [spec, viewRequire.resolve(spec)]));
const stub = new Map([
  ['@uniwork/core/auth', 'export const useSession=()=>({user:{id:"account"}});'],
  ['@uniwork/core/api/endpoints/office', 'export const getOfficeCapabilities=()=>new Promise(resolve=>window.resolveCapabilities=resolve);'],
  ['@uniwork/core/api/endpoints/config', 'export const getPublicConfig=async()=>({});'],
  ['./xlsx-runtime', 'export const createWebXlsxSessionRuntime=()=>({});'],
  ['./xlsx-adapter', `import React from 'react'; export const createXlsxDocumentsTransport=()=>({});
    export function createXlsxFormatAdapter({capability}) {return {capability,editorView:React.createElement('div',{role:'grid',tabIndex:0},'readonly workbook'),session:{
      editor:{getDirtyGeneration:()=>1},checkpoint:async()=>window.checkpoints++,dispose:async()=>{},recoverDraft:async()=>({status:'missing'}),
      coordinator:{getState:()=>({state:'ready',dirtyGeneration:1,lastSavedGeneration:1,error:null}),subscribe:()=>()=>{},setCapability:()=>{},markDirty:()=>{},save:async()=>window.saves++}}};}`],
  ['./editor-host-core', 'export const createOfficeEditorSession=()=>{throw new Error("unused diagnostic session factory");};'],
  ['@uniwork/views/office', `export {OfficeShell} from '${path.join(REPO_ROOT, 'packages/views/office/office-shell.tsx').replaceAll('\\', '/')}'; export const DesktopOpenAction=()=>null;`],
]);
const navigation = 'import React from "react"; export const registerLeaveGuard=()=>()=>{};export const AppLink=({href,children,...props})=>React.createElement("a",{href,...props},children);';
const app = `import React from 'react';import {createRoot} from 'react-dom/client';
  import {initI18n,setLocale} from './packages/core/i18n/index';
  import {XlsxOfficeEditorHost} from './apps/web/platform/office/xlsx-office-host';
  import {OfficeShell} from './packages/views/office/office-shell';
  initI18n();await setLocale('en');window.saves=0;window.checkpoints=0;
  const doc={id:'doc',title:'Workbook',organization_id:'org',workspace_id:'ws',revision:'1',file:{filename:'book.xlsx',mime_type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',version_id:'v1'}};
  let root=createRoot(document.getElementById('root'));const mode=new URLSearchParams(location.search).get('mode');
  if(mode==='pending'||mode==='readonly'||mode==='unavailable')root.render(<XlsxOfficeEditorHost document={doc} wsId='ws' readonly={mode==='readonly'}/>);
  else {
    const state={state:mode==='cancel'?'error':mode,dirtyGeneration:1,lastSavedGeneration:0,error:mode==='error'||mode==='cancel'?{code:'engine_timeout',message:'Office save could not be confirmed',action:'reconcile',retryable:true}:null};
    const coordinator={getState:()=>state,subscribe:()=>()=>{},save:async()=>{window.saves++;},cancel:async()=>{window.cancels=(window.cancels||0)+1;}};
    root.render(<OfficeShell title='Workbook' editor={<div style={{height:500}}>Workbook content</div>} editorReady saveCoordinator={coordinator}
      desktopAction={<button style={{minHeight:32}}>Edit in UniWork Office</button>} actions={<button style={{minHeight:32}}>Download file</button>}/>);
  }
  window.mounted=true;`;
const output = await build({ stdin: { contents: app, loader: 'tsx', resolveDir: REPO_ROOT },
  bundle: true, write: false, format: 'esm', platform: 'browser', jsx: 'automatic', alias,
  define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'error', plugins: [{ name: 'diagnostic-ports', setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => {
      if (stub.has(args.path)) return { path: args.path, namespace: 'port' };
      if (args.path === '@uniwork/views/navigation' || (args.path === '../navigation' && args.importer.includes('packages/views/layout'))) return { path: 'navigation', namespace: 'port' };
      return undefined;
    });
    builder.onLoad({ filter: /.*/, namespace: 'port' }, args => ({ contents: args.path === 'navigation' ? navigation : stub.get(args.path), resolveDir: REPO_ROOT, loader: 'tsx' }));
    if (baseline) builder.onLoad({ filter: /(?:xlsx-office-host|editor-host|office-shell)\.tsx$/ }, args => {
      const relative = path.relative(REPO_ROOT, args.path).replaceAll('\\', '/');
      return { contents: execFileSync('git', ['show', `${base}:${relative}`], { cwd: REPO_ROOT, encoding: 'utf8' }), loader: 'tsx', resolveDir: path.dirname(args.path) };
    });
  } }] });
const cssDir = path.join(REPO_ROOT, 'apps/web/.next/static/chunks');
const css = fs.readdirSync(cssDir).filter(name => name.endsWith('.css')).map(name => fs.readFileSync(path.join(cssDir, name), 'utf8')).join('\n');
assert.ok(css.includes('min-h-12'), 'use actual compiled UniWork stylesheet');
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/app.mjs') { response.setHeader('Content-Type', 'text/javascript'); response.end(output.outputFiles[0].text); }
  else if (pathname === '/styles.css') { response.setHeader('Content-Type', 'text/css'); response.end(css); }
  else { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><html><head><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script type="module" src="/app.mjs"></script></body></html>'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const result = { baseline, sourceRevision: baseline ? base : execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim(), pid: process.pid, origin,
  scope: 'real host/shell; fake capability/session/document ports; existing production CSS; no native Go acceptance', geometry: [], errors: [] };
try {
  browser = await chromium.launchPersistentContext(path.join(scratch, 'profile'), { headless: true, env: { ...process.env, TMP: scratch, TEMP: scratch } });
  const page = await browser.newPage();
  page.on('pageerror', error => result.errors.push(String(error)));
  const open = async (mode, width, dark) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1024 });
    await page.goto(`${origin}/?mode=${mode}`);
    assert.equal(new URL(page.url()).origin, origin);
    await page.waitForFunction(() => window.mounted && document.querySelector('[data-office-shell]'));
    await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), dark);
    await page.waitForTimeout(100);
  };
  for (const dark of [false, true]) for (const width of [390, 768, 1440]) for (const mode of ['ready', 'saving', 'error', 'cancel']) {
    await open(mode, width, dark);
    const measured = await page.evaluate(() => {
      const header = document.querySelector('header');
      const save = document.querySelector('button[aria-label="Save to UniWork"]');
      const button = save ?? [...document.querySelectorAll('button')].find(element => element.textContent === 'Download file');
      const rect = button.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return { header: header.getBoundingClientRect().toJSON(), button: rect.toJSON(), hit: hit?.tagName,
        reachable: hit === button || button.contains(hit), savePresent: !!save, main: document.querySelector('main').getBoundingClientRect().toJSON() };
    });
    result.geometry.push({ mode, width, dark, ...measured });
    await page.screenshot({ path: path.join(evidence, `${mode}-${width}-${dark ? 'dark' : 'light'}.png`) });
    if (!baseline && mode !== 'saving') {
      assert.ok(measured.reachable, `${mode}/${width}/${dark} actual button hit target`);
      await page.getByRole('button', { name: 'Save to UniWork', exact: true }).click();
      assert.equal(await page.evaluate(() => window.saves), 1);
    }
  }
  await open('pending', 768, false);
  result.pending = await page.evaluate(() => ({ alert: !!document.querySelector('[role="alert"]'), busy: !!document.querySelector('[role="status"][aria-busy="true"][aria-live="polite"]'), saves: window.saves, checkpoints: window.checkpoints }));
  if (!baseline) { assert.equal(result.pending.alert, false); assert.equal(result.pending.busy, true); }
  await page.evaluate(() => window.resolveCapabilities(null));
  await page.waitForFunction(() => document.querySelector('[data-testid="office-host-unbound"]'));
  result.unavailable = await page.evaluate(() => ({ alert: !!document.querySelector('[role="alert"]'), grid: !!document.querySelector('[role="grid"]') }));
  assert.ok(result.unavailable.alert && !result.unavailable.grid);
  await open('readonly', 768, false);
  await page.evaluate(() => window.resolveCapabilities({ documentId: 'doc', format: 'xlsx', engineVersion: 'test', operations: [{ operation: 'open', supported: true }] }));
  await page.waitForTimeout(200);
  result.readonly = await page.evaluate(() => ({ grid: !!document.querySelector('[role="grid"]'), save: !!document.querySelector('button[aria-label="Save to UniWork"]'), alert: !!document.querySelector('[role="alert"]'), checkpoints: window.checkpoints }));
  if (!baseline) assert.ok(result.readonly.grid && !result.readonly.save && !result.readonly.alert && !result.readonly.checkpoints);
  if (!baseline) {
    const before = JSON.parse(fs.readFileSync(path.join(REPO_ROOT,'.go-tmp/uni824-r5/host-before/receipt.json'),'utf8'));
    result.ordinaryHeightComparison = result.geometry.filter(row=>row.mode==='ready').map(row=>{
      const old=before.geometry.find(prior=>prior.mode==='ready'&&prior.width===row.width&&prior.dark===row.dark);
      assert.equal(row.header.height,old.header.height,`ordinary header height ${row.width}/${row.dark}`);
      return {width:row.width,dark:row.dark,before:old.header.height,after:row.header.height};
    });
  }
  assert.deepEqual(result.errors, []);
  result.outcome = baseline ? 'baseline observed' : 'passed';
} catch (error) { result.error = String(error.stack); throw error; }
finally {
  await browser?.close(); await new Promise(resolve => server.close(resolve));
  assert.ok(path.resolve(scratch).startsWith(path.resolve(REPO_ROOT, '.go-tmp') + path.sep));
  fs.rmSync(scratch, { recursive: true, force: true });
  result.cleanup = { browserClosed: true, serverClosed: true, ownProfileRemoved: true };
  fs.writeFileSync(path.join(evidence, 'receipt.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ outcome: result.outcome, error: result.error, receipt: path.join(evidence, 'receipt.json'), cleanup: result.cleanup }));
}
