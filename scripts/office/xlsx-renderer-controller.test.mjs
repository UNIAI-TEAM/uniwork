import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mountController } from './xlsx-renderer-controller-harness.mjs';

const file = { sessionId: 'session', sha256: 'sha', styles: [], sheets: [
  { id: 's1', name: 'First', rowCount: 20, columnCount: 10 },
  { id: 's2', name: 'Second', rowCount: 20, columnCount: 10 },
] };

test('sheet-dependent render patches wait for a workbook unit and survive reload', async () => {
  const mounted = mountController({}, { requireWorkbookServices: true });
  try {
    assert.equal(mounted.h.sheetInterceptorLookups ?? 0, 0);
    await mounted.handle.loadWorkbook(file);
    assert.equal(mounted.h.sheetInterceptorLookups, 1);
    await mounted.handle.loadWorkbook({ ...file, sha256: 'next' });
    assert.equal(mounted.h.sheetInterceptorLookups, 2);
    assert.equal(mounted.handle.getDirtyGeneration(), 0);
  } finally { mounted.close(); }
});

test('controller load is clean and publishes the actual initial sheet selection', async () => {
  const edits = [];
  const selections = [];
  let dirty = 0;
  const mounted = mountController({ onEdits: (batch) => edits.push(...batch), onDirty: () => dirty++,
    onSelectionChange: (selection) => selections.push(selection) });
  try {
    await mounted.handle.loadWorkbook(file, { initialSheetId: 's2' });
    assert.equal(mounted.workbook.getActiveSheet().getSheetId(), 's2');
    assert.equal(selections.at(-1)?.sheetId, 's2');
    assert.equal(selections.at(-1)?.range.startRow, 0);
    assert.equal(dirty, 0);
    assert.deepEqual(edits, []);
    assert.equal(mounted.handle.getDirtyGeneration(), 0);
    assert.equal(mounted.handle.getJournal().cells.size, 0);
    const preset = mounted.h.factoryOptions.presets[0].config;
    for (const key of ['header', 'toolbar', 'contextMenu', 'formulaBar', 'footer', 'statusBarStatistic']) {
      assert.equal(preset[key], false, key);
    }
  } finally { mounted.close(); }
});

test('selection commands publish authoritative ranges before the late UI facade event is ready', async () => {
  const selections=[];
  const mounted=mountController({onSelectionChange:selection=>selections.push(selection)});
  try {
    await mounted.handle.loadWorkbook(file);
    const next=mounted.workbook.getActiveSheet().getRange(1,1);
    mounted.workbook.getActiveRange=()=>next;
    mounted.h.emit('CommandExecuted',{id:'sheet.operation.set-selections'});
    await Promise.resolve();
    assert.equal(selections.at(-1)?.range.startRow,1);
    assert.equal(selections.at(-1)?.range.startColumn,1);
    assert.equal(mounted.handle.getDirtyGeneration(),0);
    const count=selections.length;
    mounted.h.emit('SelectionChanged');
    assert.equal(selections.length,count,'late duplicate facade notification is harmless');
    mounted.h.emit('CommandExecuted',{id:'sheet.operation.set-selections'});
    mounted.close();
    await Promise.resolve();
    assert.equal(selections.length,count,'queued refresh is ignored after disposal');
  } finally {mounted.close();}
});

test('pending edit commit awaits the actual workbook facade and refuses failed/unfinished commits', async () => {
  const mounted = mountController();
  try {
    await mounted.handle.loadWorkbook(file);
    let save;
    mounted.workbook.endEditingAsync = async value => { save=value;return true; };
    mounted.workbook.isCellEditing = () => false;
    await mounted.handle.commitEdit();assert.equal(save,true);
    mounted.workbook.endEditingAsync = async () => false;
    await assert.rejects(mounted.handle.commitEdit(),/xlsx_cell_edit_commit_failed/);
    mounted.workbook.endEditingAsync = async () => true;
    mounted.workbook.isCellEditing = () => true;
    await assert.rejects(mounted.handle.commitEdit(),/xlsx_cell_edit_commit_failed/);
    mounted.workbook.isCellEditing = () => false;
    mounted.workbook.endEditingAsync = async () => {
      mounted.h.execute({id:'sheet.mutation.insert-row'});return true;
    };
    await assert.rejects(mounted.handle.commitEdit(),/xlsx_cell_edit_commit_failed/);
  } finally { mounted.close(); }
  const readonly = mountController({readOnly:true});
  try { await readonly.handle.loadWorkbook(file);await readonly.handle.commitEdit(); }
  finally { readonly.close(); }
});

test('shifted native inline keys commit before reverse navigation, serialize concurrent keys and detach', async () => {
  const mounted = mountController();
  try {
    await mounted.handle.loadWorkbook(file);
    mounted.h.editing = true;
    let finish;
    mounted.workbook.endEditingAsync = () => new Promise(resolve => { finish=resolve; });
    const first = mounted.key({key:'Tab'});
    const second = mounted.key({key:'Enter'});
    assert.ok(first.prevented && first.stopped && second.prevented);
    assert.equal(mounted.events.filter(event=>event.id==='sheet.command.move-selection-enter-tab').length,0);
    mounted.h.editing=false;finish(true);
    await new Promise(resolve=>setImmediate(resolve));
    const movement = mounted.events.filter(event=>event.id==='sheet.command.move-selection-enter-tab');
    assert.equal(movement.length,1);
    assert.equal(movement[0].params.keycode,9);
    assert.equal(movement[0].params.direction,3);
    mounted.h.editing=true;
    mounted.workbook.endEditingAsync=async()=>{mounted.h.editing=false;return true;};
    mounted.key({key:'Enter'});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(mounted.events.at(-1).params.keycode,13);
    assert.equal(mounted.events.at(-1).params.direction,0);
    mounted.close();
    assert.equal(mounted.key({key:'Tab'}).prevented,undefined);
  } finally {mounted.close();}
});

test('shifted keys leave ordinary keys, IME, formula controls, readonly and unloaded ranges untouched', async () => {
  const mounted=mountController();
  try {
    await mounted.handle.loadWorkbook(file);
    mounted.h.editing=true;
    for (const input of [{shiftKey:false},{key:'Escape'},{ctrlKey:true},{altKey:true},{metaKey:true},{keyCode:229},{isComposing:true},
      {target:{id:'formula-input',isContentEditable:true}}]) {
      assert.equal(mounted.key(input).prevented,undefined);
    }
    mounted.emitDom('compositionstart');
    assert.equal(mounted.key({}).prevented,undefined);
    mounted.emitDom('compositionend');
    mounted.workbook.setActiveRange(mounted.workbook.getActiveSheet().getRange(15,0));
    assert.equal(mounted.key({}).prevented,undefined,'streaming range must be loaded');
  } finally {mounted.close();}
  const readonly=mountController({readOnly:true});
  try {await readonly.handle.loadWorkbook(file);readonly.h.editing=true;assert.equal(readonly.key({}).prevented,undefined);}
  finally {readonly.close();}
});

test('rejected commit, intervening pointer, scope replacement and disposal never navigate', async () => {
  for (const cause of ['reject','pointer','replace','dispose']) {
    const mounted=mountController();
    try {
      await mounted.handle.loadWorkbook(file);
      mounted.h.editing=true;
      let finish;
      mounted.workbook.endEditingAsync=()=>new Promise(resolve=>{finish=resolve;});
      mounted.key({});
      if(cause==='pointer')mounted.emitDom('pointerdown');
      if(cause==='replace')await mounted.handle.loadWorkbook({...file,sha256:'next'});
      if(cause==='dispose')mounted.close();
      mounted.h.editing=false;finish(cause!=='reject');
      await new Promise(resolve=>setImmediate(resolve));
      assert.equal(mounted.events.filter(event=>event.id==='sheet.command.move-selection-enter-tab').length,0,cause);
    } finally {mounted.close();}
  }
});

test('public formula/format/tab/theme commands preserve journals and ignore view commands', async () => {
  const edits = [];
  let dirty = 0;
  const mounted = mountController({ onEdits: (batch) => edits.push(...batch), onDirty: () => dirty++ });
  try {
    await mounted.handle.loadWorkbook(file);
    mounted.handle.setCellText('s1', 0, 0, '=B1*2');
    assert.equal(edits.at(-1).formula, '=B1*2');
    assert.equal(dirty, 1);
    mounted.handle.setNumberFormat('0.00');
    assert.equal(edits.at(-1).style.numberFormat, '0.00');
    const journal = mounted.handle.getJournal();
    const generation = mounted.handle.getDirtyGeneration();
    mounted.handle.selectSheet('s2');
    mounted.handle.setDarkMode(true);
    mounted.handle.refreshViewport();
    mounted.h.emit('SelectionChanged');
    mounted.h.emit('CommandExecuted', { id: 'sheet.operation.set-scroll' });
    assert.equal(mounted.handle.getDirtyGeneration(), generation);
    assert.equal(mounted.handle.getJournal(), journal);
    assert.deepEqual(mounted.h.dark, [true]);
    await mounted.handle.revealCell('s1', 3, 4);
    assert.equal(mounted.workbook.getActiveSheet().getSheetId(), 's1');
    assert.deepEqual(mounted.h.revealed, { sheetId: 's1', row: 3, column: 4 });
    mounted.handle.undo(); mounted.handle.redo();
    assert.equal(mounted.h.undoCalls, 1);
    assert.equal(mounted.h.redoCalls, 1);
  } finally { mounted.close(); }
});

test('readonly public and internal commands cannot mutate and rich clipboard is refused', async () => {
  const mounted = mountController({ readOnly: true });
  try {
    await mounted.handle.loadWorkbook(file);
    // Read-only is enforced by gates while trusted viewport loads can write.
    assert.equal(mounted.h.editable, true);
    mounted.handle.setCellText('s1', 0, 0, 'forbidden');
    mounted.handle.setNumberFormat('0.00');
    mounted.handle.undo(); mounted.handle.redo();
    assert.equal(mounted.h.undoCalls, undefined);
    assert.equal(mounted.handle.getDirtyGeneration(), 0);
    assert.equal(mounted.h.execute({ id: 'sheet.command.set-bold' }), false);
    assert.equal(mounted.h.execute({ id: 'sheet.mutation.insert-row' }), false);
    assert.equal(mounted.h.emit('BeforeSheetEditStart', { worksheet: mounted.workbook.getActiveSheet(), row: 0, column: 0 }).cancel, true);
    assert.equal(mounted.h.emit('BeforeClipboardPaste', { text: 'value' }).cancel, true);
  } finally { mounted.close(); }
  const editable = mountController();
  try {
    await editable.handle.loadWorkbook(file);
    assert.equal(editable.h.emit('BeforeClipboardPaste', { html: '<table></table>' }).cancel, true);
    assert.equal(editable.h.emit('BeforeClipboardPaste', { text: 'value' }).cancel, undefined);
    assert.equal(editable.h.execute({ id: 'doc.command.insert-text' }), true);
    assert.equal(editable.h.execute({ id: 'doc.command.ime-input' }), true);
    assert.equal(editable.h.execute({ id: 'doc.mutation.rich-text-editing' }), true);
    editable.handle.setCellText('s1', 15, 0, 'unseen');
    assert.equal(editable.handle.getDirtyGeneration(), 0);
  } finally { editable.close(); }
});

test('formula bar inputs preserve typed numbers/booleans/text and clear blank cells', async () => {
  const edits = [];
  const mounted = mountController({ onEdits: (batch) => edits.push(...batch) });
  try {
    await mounted.handle.loadWorkbook(file);
    for (const [input, expected] of [['42', 42], ['TRUE', true], ['FALSE', false], ['text', 'text'], ['', null]]) {
      mounted.handle.setCellText('s1', 0, 0, input);
      assert.equal(edits.at(-1).value, expected, input);
      assert.equal(edits.at(-1).formula, undefined);
    }
    mounted.handle.setCellText('s1', 0, 0, '=B1*2');
    assert.equal(edits.at(-1).formula, '=B1*2');
  } finally { mounted.close(); }
});

test('workbook skeleton waits for local font probes and exposes truthful font mappings', async () => {
  const previous = globalThis.FontFace;
  let resolveProbe;
  globalThis.FontFace = class {
    load() { return new Promise((resolve) => { resolveProbe = () => resolve(this); }); }
  };
  const mounted = mountController({}, { fonts: { add() {} } });
  try {
    const loaded = mounted.handle.loadWorkbook({ ...file, styles: [{ fontFamily: 'Verdana' }] });
    assert.equal(mounted.events.length, 0);
    resolveProbe();
    await loaded;
    assert.deepEqual(mounted.handle.getFontMappings(), [{ declared: 'Verdana', used: 'Verdana', source: 'local' }]);
    const copy = mounted.handle.getFontMappings();
    copy[0].used = 'wrong';
    assert.equal(mounted.handle.getFontMappings()[0].used, 'Verdana');
  } finally { mounted.close(); globalThis.FontFace = previous; }
});

test('disposing during font preparation prevents a late workbook installation', async () => {
  const previous = globalThis.FontFace;
  let resolveProbe;
  globalThis.FontFace = class {
    load() { return new Promise((resolve) => { resolveProbe = () => resolve(this); }); }
  };
  const mounted = mountController({}, { fonts: { add() {} } });
  try {
    const loaded = mounted.handle.loadWorkbook({ ...file, styles: [{ fontFamily: 'Verdana' }] });
    mounted.close();
    resolveProbe();
    await loaded;
    assert.equal(mounted.events.length, 0);
    assert.equal(mounted.h.disposed, true);
  } finally { globalThis.FontFace = previous; }
});
