import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { REPO_ROOT } from '../office-g0/paths.mjs';

const renderer = path.join(REPO_ROOT, 'packages/office-upstream/shims/xlsx-renderer');
const upstream = path.join(REPO_ROOT, 'packages/office-upstream/upstream');
const source = ['controller.ts', 'shifted-navigation.ts'].map(name=>fs.readFileSync(path.join(renderer,name),'utf8')).join('\n');
const names = new Map();
for (const match of source.matchAll(/import\s+(?:type\s+)?(\{[\s\S]*?\}|\w+)\s+from\s+"([^"]+)"/g)) {
  const members = match[1].replace(/[{}]/g, '').split(',').map((name) => name.trim().replace(/^type\s+/, '')).filter(Boolean);
  names.set(match[2], [...new Set([...(names.get(match[2]) ?? []), ...members])]);
}
const result = await build({
  entryPoints: [path.join(renderer, 'controller.ts')], bundle: true, write: false,
  format: 'cjs', platform: 'node', logLevel: 'silent',
  plugins: [{ name: 'controller-runtime', setup(builder) {
    builder.onResolve({ filter: /^@genoffice\/xlsx-gateway\// }, (args) => ({
      path: path.join(upstream, 'packages/xlsx-gateway/src', args.path.split('/').slice(2).join('/')) + '.ts',
    }));
    builder.onResolve({ filter: /^@genoffice\/ui\/fonts\// }, () => ({ path: 'font', namespace: 'stub' }));
    builder.onResolve({ filter: /selection-format$/ }, () => ({ path: 'indent', namespace: 'stub' }));
    builder.onResolve({ filter: /^\.\/locale$/ }, () => ({ path: 'locale', namespace: 'stub' }));
    builder.onResolve({ filter: /^@univerjs\/|\/upstream\/.*renderer\// }, (args) => {
      if (args.path.endsWith('/edit-journal')) return undefined;
      return { path: args.path, namespace: 'stub' };
    });
    builder.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => {
      const exports = names.get(args.path) ?? [];
      const lines = ['const h=()=>globalThis.__xlsxControllerTest;'];
      if (args.path === 'indent') lines.push('export const INDENT_STEP_PX=9;');
      if (args.path === 'font') lines.push('export default "data:font/ttf;base64,AA==";');
      if (args.path === 'locale') lines.push('export const t=(key)=>key;');
      if (args.path === '@univerjs/core') {
        lines.push('export const CellValueType={STRING:1,NUMBER:2,BOOLEAN:3};');
      }
      for (const name of exports) {
        if (name === 'Direction') lines.push('export const Direction={UP:0,RIGHT:1,DOWN:2,LEFT:3};');
        else if (name === 'KeyCode') lines.push('export const KeyCode={TAB:9,ENTER:13};');
        else if (name === 'BooleanNumber') lines.push('export const BooleanNumber={TRUE:1,FALSE:0};');
        else if (name === 'LocaleType') lines.push('export const LocaleType={EN_US:"enUS"};');
        else if (name === 'ThemeService' || name === 'SheetInterceptorService') lines.push(`export const ${name}='${name}';`);
        else if (name === 'createUniver') lines.push('export function createUniver(options){h().factoryOptions=options;return h().runtime;}');
        else if (name === 'journalSuppression' || name === 'loadAutoHeightSuppression') lines.push(`export const ${name}={active:false};`);
        else if (name === 'loadWorkbookSkeleton') lines.push('export function loadWorkbookSkeleton(runtime,file){h().load(file);}');
        else if (name === 'loadVisibleRange') lines.push('export async function loadVisibleRange(runtime,ref,sheet){return h().loadRange(ref,sheet);}');
        else if (name === 'revealCellBelowFreeze') lines.push('export async function revealCellBelowFreeze(sheet,row,column){h().revealed={sheetId:sheet.getSheetId(),row,column};}');
        else if (name === 'sharedFormulaResolverFor') lines.push('export const sharedFormulaResolverFor=()=>()=>null;');
        else if (name === 'installFindRevealFix') lines.push('export const installFindRevealFix=()=>()=>{};');
        else if (name.startsWith('UniverPreset')) lines.push(`export default {};`);
        else if (name.startsWith('UniverSheets')) lines.push(`export function ${name}(config){return {name:'${name}',config};}`);
        else lines.push(`export const ${name}=(...args)=>({dispose(){}});`);
      }
      return { contents: lines.join('\n'), loader: 'js' };
    });
  } }],
});
const module = { exports: {} };
new Function('module', 'exports', result.outputFiles[0].text)(module, module.exports);
const { createXlsxRenderer } = module.exports;

export function mountController(options = {}, environment = {}) {
  const previousHarness = globalThis.__xlsxControllerTest;
  const previousWindow = globalThis.window;
  const previousDesktopApi = globalThis.desktopApi;
  const handlers = new Map();
  const events = [];
  const cells = new Map();
  let file;
  let activeSheet;
  let activeRange;
  const sheets = new Map();
  const h = {
    dark: [], disposed: false, editable: true,
    editing: false,
    emit(id, event = {}) { for (const handler of handlers.get(id) ?? []) handler(event); return event; },
    execute(event) {
      const before = h.emit('BeforeCommandExecute', { ...event });
      if (before.cancel) return false;
      events.push(event);
      h.emit('CommandExecuted', event);
      return true;
    },
    load(input) {
      file = input;
      for (const meta of input.sheets) {
        const sheet = {
          getSheetId: () => meta.id,
          getSheet: () => ({ getCellRaw: (row, column) => cells.get(`${meta.id}:${row}:${column}`) }),
          getRange(row, column) {
            const range = { startRow: row, endRow: row, startColumn: column, endColumn: column };
            return {
              getRange: () => range,
              activate() { workbook.setActiveRange(this); return this; },
              setValue(text) {
                const cell = typeof text === 'object' ? text : text.startsWith('=') ? { f: text, v: null } : { f: null, v: text };
                const event = { id: 'sheet.mutation.set-range-values', params: {
                  unitId: `file-${file.sha256}`, subUnitId: meta.id, cellValue: { [row]: { [column]: cell } },
                } };
                if (h.execute(event)) cells.set(`${meta.id}:${row}:${column}`, cell);
              },
              setNumberFormat(pattern) {
                h.execute({ id: 'sheet.mutation.set.numfmt', params: {
                  unitId: `file-${file.sha256}`, subUnitId: meta.id,
                  refMap: { x: { pattern } }, values: { x: { ranges: [range] } },
                } });
              },
            };
          },
        };
        sheets.set(meta.id, sheet);
      }
      activeSheet = sheets.get(input.sheets[0].id);
      activeRange = activeSheet.getRange(0, 0);
      h.execute({ id: 'sheet.mutation.set-range-values', params: {
        unitId: `file-${file.sha256}`, subUnitId: activeSheet.getSheetId(), cellValue: { 0: { 0: { v: 'load' } } },
      } });
    },
    async loadRange(ref, sheet) {
      const id = sheet.getSheetId();
      h.execute({ id: 'sheet.operation.set-scroll' });
      ref.current.loadedRanges.set(id, { startRow: 0, endRow: 9, startColumn: 0, endColumn: 9 });
    },
  };
  const workbook = {
    getId: () => `file-${file.sha256}`, getActiveSheet: () => activeSheet,
    getSheetBySheetId: (id) => sheets.get(id), getActiveRange: () => activeRange,
    getWorkbook: () => ({ getStyles: () => ({ getStyleByCell: (cell) => cell?.s }) }),
    setEditable(value) { h.editable = value; },
    isCellEditing: () => h.editing,
    async endEditingAsync() { h.editing = false; return true; },
    setActiveRange(range) { activeRange = range; h.emit('SelectionChanged'); },
    setActiveSheet(sheet) { activeSheet = sheet; activeRange = sheet.getRange(0, 0); h.emit('ActiveSheetChanged'); },
  };
  h.runtime = {
    univer: {
      __getInjector: () => ({ get: (token) => {
        if (token === 'SheetInterceptorService') {
          if (environment.requireWorkbookServices && !file) throw new Error('sheet services require a workbook unit');
          h.sheetInterceptorLookups = (h.sheetInterceptorLookups ?? 0) + 1;
        }
        return token === 'ThemeService' ? { setDarkMode: (dark) => h.dark.push(dark) } : {};
      } }),
      dispose: () => { h.disposed = true; },
    },
    univerAPI: {
      Event: new Proxy({}, { get: (_, key) => key }),
      getActiveWorkbook: () => file ? workbook : null,
      addEvent(id, handler) {
        if (!handlers.has(id)) handlers.set(id, new Set());
        handlers.get(id).add(handler);
        return { dispose: () => handlers.get(id).delete(handler) };
      },
      async undo() { h.undoCalls = (h.undoCalls ?? 0) + 1; },
      async redo() { h.redoCalls = (h.redoCalls ?? 0) + 1; },
      async executeCommand(id, params) { return h.execute({id,params}); },
      syncExecuteCommand(id, params) { return h.execute({id,params}); },
    },
  };
  globalThis.__xlsxControllerTest = h;
  globalThis.window = { setTimeout: (fn) => { fn(); return 0; } };
  const classes = new Set();
  const element = () => ({ id: '', className: '', style: {}, remove() {} });
  const attributes = new Map();
  const listeners = new Map();
  const container = { ...element(), setAttribute: (key, value) => attributes.set(key, value), removeAttribute: (key) => attributes.delete(key),
    addEventListener: (type, handler) => listeners.set(type,handler),
    removeEventListener: (type) => listeners.delete(type), contains: (element) => element === h.target,
    classList: { add: (value) => classes.add(value), remove: (value) => classes.delete(value) },
    ownerDocument: { createElement: element, fonts: environment.fonts }, appendChild() {} };
  const handle = createXlsxRenderer({ container, host: { async readRange() { return {}; } }, ...options });
  return {
    handle, h, workbook, events, container,
    key(event) {
      h.target ??= { id:'__editor___INTERNAL_EDITOR__DOCS_NORMAL', isContentEditable:true,
        getAttribute: () => 'editor', focus() {} };
      container.ownerDocument.activeElement = h.target;
      const input = {key:'Tab',shiftKey:true,target:h.target,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;},...event};
      listeners.get('keydown')?.(input);
      return input;
    },
    emitDom: (type) => listeners.get(type)?.(),
    close() {
      try { handle.dispose(); } finally {
        globalThis.__xlsxControllerTest = previousHarness;
        globalThis.window = previousWindow;
        globalThis.desktopApi = previousDesktopApi;
      }
    },
  };
}
