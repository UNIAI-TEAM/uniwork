import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mountController } from './xlsx-renderer-controller-harness.mjs';

const file = { sessionId: 'session', sha256: 'sha', styles: [], sheets: [
  { id: 's1', name: 'First', rowCount: 20, columnCount: 10 },
  { id: 's2', name: 'Second', rowCount: 20, columnCount: 10 },
] };

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
