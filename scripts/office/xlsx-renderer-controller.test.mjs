import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mountController } from './xlsx-renderer-controller-harness.mjs';

const file = { sessionId: 'session', sha256: 'sha', styles: [], sheets: [
  { id: 's1', name: 'First', hidden: false, rowCount: 20, columnCount: 10, columnWidths: [] },
  { id: 's2', name: 'Second', hidden: false, rowCount: 20, columnCount: 10, columnWidths: [] },
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

test('bare shifted selection requests reverse movement without committing or dirtying', async () => {
  for (const key of ['Tab', 'Enter']) {
    for (const position of ['B2', 'A1', 'B2:C3']) {
      const mounted = mountController();
      try {
        await mounted.handle.loadWorkbook(file);
        const range = position === 'A1' ? mounted.workbook.getActiveSheet().getRange(0, 0) :
          mounted.workbook.getActiveSheet().getRange(1, 1);
        if (position === 'B2:C3') Object.assign(range.getRange(), { endRow: 2, endColumn: 2 });
        mounted.workbook.setActiveRange(range);
        let commits = 0;
        mounted.workbook.endEditingAsync = async () => { commits++; return true; };
        const input = mounted.key({ key });
        await new Promise(resolve => setImmediate(resolve));
        assert.ok(input.prevented && input.stopped, `${position} ${key}`);
        const target = mounted.workbook.getActiveRange().getRange();
        const expected = position === 'A1' ? { startRow: 0, startColumn: 0 } :
          key === 'Tab' ? { startRow: 1, startColumn: 0 } : { startRow: 0, startColumn: 1 };
        assert.equal(target.startRow, expected.startRow);
        assert.equal(target.startColumn, expected.startColumn);
        assert.equal(commits, 0);
        assert.equal(mounted.handle.getDirtyGeneration(), 0);
        assert.equal(mounted.handle.getJournal().cells.size, 0);
      } finally { mounted.close(); }
    }
  }
});

test('shifted native inline keys commit before reverse navigation, serialize concurrent keys and detach', async () => {
  const mounted = mountController();
  try {
    await mounted.handle.loadWorkbook(file);
    mounted.h.editing = true;
    let finish;
    mounted.workbook.endEditingAsync = () => new Promise(resolve => { finish=resolve; });
    const first = mounted.key({key:'Tab'});
    mounted.h.editing = false;
    const second = mounted.key({key:'Enter'});
    assert.ok(first.prevented && first.stopped && second.prevented);
    assert.deepEqual(mounted.workbook.getActiveRange().getRange(), {
      startRow: 0, endRow: 0, startColumn: 0, endColumn: 0,
    });
    finish(true);
    await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(mounted.workbook.getActiveRange().getRange(), {
      startRow: 0, endRow: 0, startColumn: 0, endColumn: 0,
    });
    mounted.h.editing=true;
    mounted.workbook.endEditingAsync=async()=>{mounted.h.editing=false;return true;};
    mounted.key({key:'Enter'});
    await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(mounted.workbook.getActiveRange().getRange(), {
      startRow: 0, endRow: 0, startColumn: 0, endColumn: 0,
    });
    mounted.close();
    assert.equal(mounted.key({key:'Tab'}).prevented,undefined);
  } finally {mounted.close();}
});

test('shifted keys leave ordinary keys, IME, formula controls, readonly and unloaded ranges untouched', async () => {
  for (const editing of [false, true]) {
  const mounted=mountController();
  try {
    await mounted.handle.loadWorkbook(file);
    mounted.h.editing=editing;
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
  try {await readonly.handle.loadWorkbook(file);readonly.h.editing=editing;assert.equal(readonly.key({}).prevented,undefined);}
  finally {readonly.close();}
  }
});

test('rejected commit, intervening pointer, scope replacement and disposal never navigate', async () => {
  for (const cause of ['reject','pointer','ordinary-key','replace','sheet','unit','selection','focus','dispose']) {
    const mounted=mountController();
    try {
      await mounted.handle.loadWorkbook(file);
      mounted.h.editing=true;
      let finish;
      mounted.workbook.endEditingAsync=()=>new Promise(resolve=>{finish=resolve;});
      mounted.key({});
      if(cause==='pointer')mounted.emitDom('pointerdown');
      if(cause==='ordinary-key')mounted.key({key:'ArrowRight',shiftKey:false});
      if(cause==='replace')await mounted.handle.loadWorkbook({...file,sha256:'next'});
      if(cause==='sheet')mounted.handle.selectSheet('s2');
      if(cause==='unit')mounted.h.runtime.univerAPI.getActiveWorkbook=()=>null;
      if(cause==='selection')mounted.workbook.setActiveRange(null);
      if(cause==='focus')mounted.container.ownerDocument.activeElement={id:'outside'};
      if(cause==='dispose')mounted.close();
      mounted.h.editing=false;finish(cause!=='reject');
      await new Promise(resolve=>setImmediate(resolve));
      assert.equal(mounted.events.filter(event=>event.id==='sheet.command.move-selection').length,0,cause);
    } finally {mounted.close();}
  }
});

test('bare shifted keys require a current selection and exact native focus, and suppress repeats', async () => {
  const mounted = mountController();
  try {
    await mounted.handle.loadWorkbook(file);
    mounted.workbook.setActiveRange(null);
    assert.equal(mounted.key({}).prevented, undefined);
    mounted.workbook.setActiveRange(mounted.workbook.getActiveSheet().getRange(1, 1));
    assert.equal(mounted.key({ target: { id: '__editor___INTERNAL_EDITOR__DOCS_NORMAL', isContentEditable: true } }).prevented, undefined);
    assert.ok(mounted.key({ repeat: true }).prevented);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(mounted.events.filter(event => event.id === 'sheet.command.move-selection').length, 0);
    mounted.close();
    assert.equal(mounted.key({}).prevented, undefined);
  } finally { mounted.close(); }
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

test('renderer command port runs allowlisted commands through the policy and refuses the rest', async () => {
  const mounted = mountController();
  try {
    assert.equal(await mounted.handle.executeCommand('sheet.command.set-bold'), false, 'no open workbook');
    await mounted.handle.loadWorkbook(file);
    assert.equal(await mounted.handle.executeCommand('sheet.command.set-bold'), true);
    // The port fills the active unit/sheet ids when a command omits them, so a
    // toolbar group can drive the active render without carrying renderer ids.
    assert.deepEqual(mounted.events.at(-1), { id: 'sheet.command.set-bold', params: { unitId: 'file-sha', subUnitId: 's1' } });
    assert.equal(await mounted.handle.executeCommand('sheet.command.set-font-size', { value: 14 }), true);
    assert.deepEqual(mounted.events.at(-1), { id: 'sheet.command.set-font-size', params: { unitId: 'file-sha', subUnitId: 's1', value: 14 } });
    assert.equal(await mounted.handle.executeCommand('sheet.operation.set-selections', { selections: [] }), true);
    assert.deepEqual(mounted.events.at(-1), { id: 'sheet.operation.set-selections', params: { unitId: 'file-sha', subUnitId: 's1', selections: [] } });
    assert.equal(await mounted.handle.executeCommand('sheet.mutation.insert-row'), false, 'policy refuses the command');
    assert.equal(mounted.events.some((event) => event.id === 'sheet.mutation.insert-row'), false);
    mounted.workbook.setActiveRange(null);
    assert.equal(await mounted.handle.executeCommand('sheet.command.set-bold'), false, 'no active range');
  } finally { mounted.close(); }
  const readonly = mountController({ readOnly: true });
  try {
    await readonly.handle.loadWorkbook(file);
    assert.equal(await readonly.handle.executeCommand('sheet.command.set-bold'), false);
    assert.equal(readonly.events.some((event) => event.id === 'sheet.command.set-bold'), false);
  } finally { readonly.close(); }
});

test('renderer format state mirrors the active range composed style and stays readable for readonly mounts', async () => {
  const mounted = mountController();
  try {
    assert.equal(mounted.handle.getActiveFormatState(), null, 'no active range before load');
    await mounted.handle.loadWorkbook(file);
    mounted.setCellStyle('s1', 0, 0, {
      ff: 'Verdana', fs: 14, bl: 1, it: 1, ul: { s: 1 }, st: { s: 1 },
      cl: { rgb: '#C00000' }, bg: { rgb: '#FFFF00' }, ht: 2, vt: 3, tb: 3, tr: { a: 45 },
    });
    assert.deepEqual(mounted.handle.getActiveFormatState(), {
      fontFamily: 'Verdana', fontSize: 14, bold: true, italic: true, underline: true, strike: true,
      textColor: '#C00000', fillColor: '#FFFF00', horizontalAlign: 2, verticalAlign: 3, wrap: true, textRotation: 45,
    });
    mounted.workbook.setActiveRange(mounted.workbook.getActiveSheet().getRange(1, 1));
    assert.deepEqual(mounted.handle.getActiveFormatState(), {
      fontFamily: null, fontSize: null, bold: false, italic: false, underline: false, strike: false,
      textColor: null, fillColor: null, horizontalAlign: null, verticalAlign: null, wrap: false, textRotation: null,
    });
    mounted.workbook.setActiveRange(null);
    assert.equal(mounted.handle.getActiveFormatState(), null);
  } finally { mounted.close(); }
  const readonly = mountController({ readOnly: true });
  try {
    await readonly.handle.loadWorkbook(file);
    readonly.setCellStyle('s1', 0, 0, { bl: 1 });
    assert.equal(readonly.handle.getActiveFormatState().bold, true);
  } finally { readonly.close(); }
});

test('row/column mutations journal through the controller and emit on the edit channel', async () => {
  const edits = [];
  let dirty = 0;
  const mounted = mountController({ onEdits: (batch) => edits.push(...batch), onDirty: () => dirty++ });
  try {
    await mounted.handle.loadWorkbook(file);
    const generation = mounted.handle.getDirtyGeneration();
    // A cell edit queued before the shift must move into post-operation space.
    mounted.handle.setCellText('s1', 0, 0, 'kept');
    mounted.h.execute({ id: 'sheet.mutation.insert-row', params: {
      unitId: 'file-sha', subUnitId: 's1', range: { startRow: 0, endRow: 1, startColumn: 0, endColumn: 0 },
    } });
    assert.deepEqual(edits.at(-1), { sheetId: 's1', structural: { kind: 'insert-rows', index: 0, count: 2 } });
    assert.equal(mounted.handle.getDirtyGeneration(), generation + 2);
    assert.equal(dirty, 2);
    const journal = mounted.handle.getJournal();
    assert.deepEqual(journal.structuralOps.get('s1'), [{ kind: 'insert-rows', index: 0, count: 2 }]);
    assert.deepEqual([...journal.cells.get('s1').values()].map((entry) => [entry.row, entry.value]), [[2, 'kept']]);
    // Structurally ignored shapes emit nothing.
    const before = edits.length;
    mounted.h.execute({ id: 'sheet.mutation.insert-row', params: { unitId: 'file-sha', subUnitId: 's1' } });
    assert.equal(edits.length, before);
  } finally { mounted.close(); }
});

test('outline commands run through the registered command service and journal level runs', async () => {
  const edits = [];
  let dirty = 0;
  const mounted = mountController({ onEdits: (batch) => edits.push(...batch), onDirty: () => dirty++ });
  try {
    await mounted.handle.loadWorkbook(file);
    assert.equal(await mounted.handle.executeCommand('uniwork.command.set-rows-outline', { start: 1, end: 3, action: 'group' }), true);
    assert.deepEqual(edits.at(-1), { sheetId: 's1', structural: { kind: 'set-rows-outline', start: 1, end: 3, level: 1 } });
    assert.equal(await mounted.handle.executeCommand('uniwork.command.set-rows-outline', { start: 1, end: 3, action: 'group' }), true);
    assert.deepEqual(edits.at(-1).structural, { kind: 'set-rows-outline', start: 1, end: 3, level: 2 });
    // A run already at the boundary is a no-op; malformed params never run.
    assert.equal(await mounted.handle.executeCommand('uniwork.command.set-cols-outline', { start: 2, end: 2, action: 'ungroup' }), false);
    assert.equal(await mounted.handle.executeCommand('uniwork.command.set-rows-outline', { start: 3, end: 1, action: 'group' }), false);
    assert.equal(await mounted.handle.executeCommand('uniwork.command.set-rows-outline', { start: 0, end: 1, action: 'nope' }), false);
    assert.deepEqual(mounted.handle.getJournal().structuralOps.get('s1'), [
      { kind: 'set-rows-outline', start: 1, end: 3, level: 1 },
      { kind: 'set-rows-outline', start: 1, end: 3, level: 2 },
    ]);
    assert.equal(dirty, 2);
  } finally { mounted.close(); }
  const readonly = mountController({ readOnly: true });
  try {
    await readonly.handle.loadWorkbook(file);
    assert.equal(await readonly.handle.executeCommand('uniwork.command.set-rows-outline', { start: 0, end: 1, action: 'group' }), false);
    assert.equal(readonly.handle.getJournal().structuralOps.size, 0);
  } finally { readonly.close(); }
});

test('column default-width command journals a null size and file outline levels seed the axis', async () => {
  const edits = [];
  let dirty = 0;
  const mounted = mountController({ onEdits: (batch) => edits.push(...batch), onDirty: () => dirty++ });
  try {
    const seeded = { ...file, sheets: [
      { ...file.sheets[0], columnWidths: [{ startColumn: 1, endColumn: 2, hidden: false, outlineLevel: 2, collapsed: true }] },
      file.sheets[1],
    ] };
    await mounted.handle.loadWorkbook(seeded);
    assert.equal(await mounted.handle.executeCommand('uniwork.command.set-cols-default-width', { start: 1, end: 2 }), true);
    assert.deepEqual(edits.at(-1), { sheetId: 's1', structural: { kind: 'set-col-size', start: 1, end: 2, size: null } });
    // The file's <col outlineLevel> is the base the first session group raises from.
    assert.equal(await mounted.handle.executeCommand('uniwork.command.set-cols-outline', { start: 1, end: 2, action: 'group' }), true);
    assert.deepEqual(edits.at(-1).structural, { kind: 'set-cols-outline', start: 1, end: 2, level: 3 });
    // Malformed spans never reach the journal.
    assert.equal(await mounted.handle.executeCommand('uniwork.command.set-cols-default-width', { start: 3, end: 2 }), false);
    assert.equal(await mounted.handle.executeCommand('uniwork.command.set-cols-default-width', { start: 0, end: 20000 }), false);
    assert.deepEqual(mounted.handle.getJournal().structuralOps.get('s1'), [
      { kind: 'set-col-size', start: 1, end: 2, size: null },
      { kind: 'set-cols-outline', start: 1, end: 2, level: 3 },
    ]);
    assert.equal(dirty, 2);
  } finally { mounted.close(); }
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
  } finally { mounted.close(); globalThis.FontFace = previous; }
});

test('hyperlink and outline edits emitted outside the batch carry the live sheet name', async () => {
  const edits = [];
  const mounted = mountController({ onEdits: (batch) => edits.push(...batch) });
  try {
    await mounted.handle.loadWorkbook(file);
    // Rename: the live name is journalled as the mutation runs, and the facade
    // rename mirrors what Univer does to the sheet (the host file still says
    // "First", so any edit through the structural channel must say "Budget").
    assert.equal(mounted.h.execute({ id: 'sheet.mutation.set-worksheet-name', params: {
      unitId: 'file-sha', subUnitId: 's1', name: 'Budget',
    } }), true);
    mounted.setSheetName('s1', 'Budget');

    assert.equal(mounted.h.execute({ id: 'uniwork.command.set-hyperlink', params: {
      unitId: 'file-sha', subUnitId: 's1', address: 'B2', target: 'https://example.com',
    } }), true);
    // The target is the vendored normalizer's output, which this harness stubs;
    // the live-name stamp is what this test proves, so pin those fields.
    const hyperlink = edits.at(-1);
    assert.deepEqual(
      { sheetId: hyperlink.sheetId, sheetName: hyperlink.sheetName, row: hyperlink.row, column: hyperlink.column },
      { sheetId: 's1', sheetName: 'Budget', row: 1, column: 1 },
    );
    assert.ok('target' in hyperlink);

    assert.equal(mounted.h.execute({ id: 'uniwork.command.set-rows-outline', params: {
      subUnitId: 's1', start: 1, end: 2, action: 'group',
    } }), true);
    assert.equal(edits.at(-1).sheetName, 'Budget');
    assert.equal(edits.at(-1).structural.kind, 'set-rows-outline');

    // A session-added sheet has no file entry at all; the live name is the only
    // name the bridge can resolve.
    assert.equal(mounted.h.execute({ id: 'sheet.mutation.insert-sheet', params: {
      unitId: 'file-sha', index: 2, sheet: { id: 's3', name: 'Scratch' },
    } }), true);
    mounted.addSheet('s3', 'Scratch');
    assert.equal(mounted.h.execute({ id: 'uniwork.command.set-hyperlink', params: {
      unitId: 'file-sha', subUnitId: 's3', address: 'A1', target: '#Budget!B2',
    } }), true);
    assert.equal(edits.at(-1).sheetName, 'Scratch');

    // Unchanged names stay byte-identical to the pre-B3 wire (no stamp).
    assert.equal(mounted.h.execute({ id: 'uniwork.command.set-hyperlink', params: {
      unitId: 'file-sha', subUnitId: 's2', address: 'A1', target: 'https://example.com',
    } }), true);
    assert.equal('sheetName' in edits.at(-1), false);
  } finally { mounted.close(); }
});

test('sheet mutations emit sheet edits, stamp live names and refuse out-of-policy ids', async () => {
  const edits = [];
  let dirty = 0;
  const mounted = mountController({ onEdits: (batch) => edits.push(...batch), onDirty: () => dirty++ });
  try {
    await mounted.handle.loadWorkbook(file);
    const generation = mounted.handle.getDirtyGeneration();

    // The live sheet list follows the Univer facade (rename/hide included).
    assert.deepEqual(mounted.handle.getSheets(), [
      { id: 's1', name: 'First', hidden: false }, { id: 's2', name: 'Second', hidden: false },
    ]);
    mounted.setSheetName('s1', 'Budget');
    mounted.setSheetHidden('s2', true);
    assert.deepEqual(mounted.handle.getSheets().map((sheet) => [sheet.name, sheet.hidden]), [['Budget', false], ['Second', true]]);
    mounted.setSheetName('s1', 'First');
    mounted.setSheetHidden('s2', false);

    // Rename: the emitted target is the pre-mutation live name.
    assert.equal(mounted.h.execute({ id: 'sheet.mutation.set-worksheet-name', params: {
      unitId: 'file-sha', subUnitId: 's1', name: 'Budget',
    } }), true);
    assert.deepEqual(edits.at(-1), {
      sheetId: 's1', sheetName: 'First', sheetOp: { kind: 'rename-sheet', newName: 'Budget' },
    });
    // A later cell edit into the renamed sheet carries the live name so the
    // bridge never resolves it through the stale host file.
    mounted.handle.setCellText('s1', 0, 0, 'kept');
    assert.deepEqual(edits.at(-1), {
      sheetId: 's1', sheetName: 'Budget', row: 0, column: 0, writeValue: true, value: 'kept',
    });

    // Add: the new sheet id/name/index ride the insert mutation.
    assert.equal(mounted.h.execute({ id: 'sheet.mutation.insert-sheet', params: {
      unitId: 'file-sha', index: 2, sheet: { id: 's3', name: 'Scratch' },
    } }), true);
    assert.deepEqual(edits.at(-1), { sheetId: 's3', sheetName: 'Scratch', sheetOp: { kind: 'add-sheet', index: 2 } });
    // The stub command service does not model the mutation, so the test adds
    // the sheet Univer created; cells into it pass the policy (live id set).
    mounted.addSheet('s3', 'Scratch');
    mounted.handle.setCellText('s3', 1, 1, 'new');
    assert.deepEqual(edits.at(-1), {
      sheetId: 's3', sheetName: 'Scratch', row: 1, column: 1, writeValue: true, value: 'new',
    });

    // Duplicate: the copy command marks its source, the insert mutation it
    // dispatches is captured as a duplicate with the live source name.
    assert.equal(mounted.h.execute({ id: 'sheet.command.copy-sheet', params: { subUnitId: 's1' } }), true);
    assert.equal(mounted.h.execute({ id: 'sheet.mutation.insert-sheet', params: {
      unitId: 'file-sha', index: 1, sheet: { id: 's4', name: 'Budget copy' },
    } }), true);
    assert.deepEqual(edits.at(-1), {
      sheetId: 's4', sheetName: 'Budget copy',
      sheetOp: { kind: 'duplicate-sheet', sourceSheetId: 's1', sourceName: 'Budget', index: 1 },
    });
    // An explicit add after a copy is NOT a duplicate (the marker was consumed
    // by the copy's insert mutation).
    assert.equal(mounted.h.execute({ id: 'sheet.mutation.insert-sheet', params: {
      unitId: 'file-sha', index: 4, sheet: { id: 's5', name: 'Plain' },
    } }), true);
    assert.deepEqual(edits.at(-1).sheetOp, { kind: 'add-sheet', index: 4 });

    // Reorder and hide/unhide.
    assert.equal(mounted.h.execute({ id: 'sheet.mutation.set-worksheet-order', params: {
      unitId: 'file-sha', subUnitId: 's2', fromOrder: 1, toOrder: 2,
    } }), true);
    assert.deepEqual(edits.at(-1), { sheetId: 's2', sheetName: 'Second', sheetOp: { kind: 'reorder-sheet', index: 2 } });
    assert.equal(mounted.h.execute({ id: 'sheet.mutation.set-worksheet-hidden', params: {
      unitId: 'file-sha', subUnitId: 's2', hidden: 1,
    } }), true);
    assert.deepEqual(edits.at(-1), { sheetId: 's2', sheetName: 'Second', sheetOp: { kind: 'set-sheet-hidden', hidden: true } });
    assert.equal(mounted.h.execute({ id: 'sheet.mutation.set-worksheet-hidden', params: {
      unitId: 'file-sha', subUnitId: 's2', hidden: 0,
    } }), true);
    assert.deepEqual(edits.at(-1).sheetOp, { kind: 'set-sheet-hidden', hidden: false });

    // Remove: the removed sheet's live name is captured before the journal mark.
    assert.equal(mounted.h.execute({ id: 'sheet.mutation.remove-sheet', params: {
      unitId: 'file-sha', subUnitId: 's2', subUnitName: 'Second',
    } }), true);
    assert.deepEqual(edits.at(-1), { sheetId: 's2', sheetName: 'Second', sheetOp: { kind: 'remove-sheet' } });

    // Tab colour has no gateway write path: the command stays refused and
    // never reaches the edit channel.
    const before = edits.length;
    assert.equal(mounted.h.execute({ id: 'sheet.command.set-tab-color', params: { subUnitId: 's1' } }), false);
    assert.equal(edits.length, before);
    // Unknown sheet / malformed names are refused before the mutation runs.
    assert.equal(mounted.h.execute({ id: 'sheet.mutation.set-worksheet-name', params: {
      unitId: 'file-sha', subUnitId: 'ghost', name: 'X',
    } }), false);
    assert.equal(mounted.h.execute({ id: 'sheet.mutation.set-worksheet-name', params: {
      unitId: 'file-sha', subUnitId: 's1', name: 'a/b',
    } }), false);
    assert.equal(edits.length, before);
    assert.equal(dirty, 10);
    assert.equal(mounted.handle.getDirtyGeneration(), generation + 10);
  } finally { mounted.close(); }

  const readonly = mountController({ readOnly: true });
  try {
    await readonly.handle.loadWorkbook(file);
    assert.equal(readonly.h.execute({ id: 'sheet.mutation.set-worksheet-name', params: {
      unitId: 'file-sha', subUnitId: 's1', name: 'Budget',
    } }), false);
    assert.equal(readonly.handle.getJournal().sheets.renamed.size, 0);
  } finally { readonly.close(); }
});
