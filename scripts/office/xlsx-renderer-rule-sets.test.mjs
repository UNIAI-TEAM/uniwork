import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { REPO_ROOT } from '../office-g0/paths.mjs';

// X01: the conditional-formatting / data-validation capture and its command
// policy, bundled the way xlsx-renderer-edits.test.mjs bundles the journal.
const renderer = path.join(REPO_ROOT, 'packages/office-upstream/shims/xlsx-renderer');
const upstream = path.join(REPO_ROOT, 'packages/office-upstream/upstream');
const bundled = await build({
  stdin: {
    contents: `export * from './rule-set-capture'; export * from './rule-set-policy'; export * from './dv-error-style'; export { canExecuteCommand } from './command-policy';
      export { createEditJournal, recordSheetDuplicate, recordSheetInsert } from '../../upstream/apps/sheets/src/renderer/edit-journal';`,
    resolveDir: renderer, loader: 'ts',
  },
  bundle: true, write: false, format: 'cjs', platform: 'node', logLevel: 'silent',
  plugins: [{
    name: 'journal-dependencies',
    setup(builder) {
      builder.onResolve({ filter: /^@univerjs\/core$/ }, () => ({ path: 'core', namespace: 'test' }));
      builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({
        contents: 'export const CellValueType={STRING:1,NUMBER:2,BOOLEAN:3}; export const CommandType={COMMAND:0,OPERATION:1,MUTATION:2};',
      }));
      builder.onResolve({ filter: /^\.\/locale$/ }, () => ({ path: 'locale', namespace: 'test-locale' }));
      builder.onLoad({ filter: /.*/, namespace: 'test-locale' }, () => ({ contents: 'export const t = (key) => key;' }));
      builder.onResolve({ filter: /^@genoffice\/xlsx-gateway\// }, (args) => ({
        path: path.join(upstream, 'packages/xlsx-gateway/src', args.path.split('/').slice(2).join('/')) + '.ts',
      }));
      builder.onResolve({ filter: /selection-format$/ }, () => ({ path: 'indent', namespace: 'test-indent' }));
      builder.onLoad({ filter: /.*/, namespace: 'test-indent' }, () => ({ contents: 'export const INDENT_STEP_PX=9;' }));
    },
  }],
});
const module = { exports: {} };
new Function('module', 'exports', bundled.outputFiles[0].text)(module, module.exports);
const { createEditJournal, recordSheetDuplicate, recordSheetInsert, ingestRuleSetMutation, snapshotSheetRules, ruleSetSheetReady, canExecuteCommand, restoreRuleSetFamily, ruleSetRestoreAllowed, readLiveRuleSet, settleDvErrorStyle, ensureDvHintStyle, askOnValidateCell } = module.exports;

const area = (startRow, endRow, startColumn, endColumn) => ({ startRow, endRow, startColumn, endColumn });
function state({ applied = ['s1'], ruleSets, ruleCounts } = {}) {
  return {
    file: { sessionId: 'book', sha256: 'sha', sheets: [{ id: 's1', name: 'Data', hidden: false, rowCount: 20, columnCount: 10, pivotRanges: [], ...(ruleSets ? { ruleSets } : {}), ...(ruleCounts ? { ruleCounts } : {}) }] },
    editJournal: createEditJournal(),
    loadedRanges: new Map([['s1', area(0, 9, 0, 4)]]),
    flags: { preloadComplete: false },
    closure: { pinned: new Map() },
    outline: new Map(),
    filterOrigins: new Map(),
    appliedDvSheets: new Set(applied),
  };
}
const cfRule = { cfId: 'cf-1', ranges: [area(1, 9, 1, 1)], stopIfTrue: false, rule: { type: 'highlightCell', subType: 'number', operator: 'greaterThan', value: 10, style: { bg: { rgb: '#FFC7CE' } } } };
const dvRule = { uid: 'dv-1', type: 'list', formula1: 'Yes,No', ranges: [area(1, 9, 2, 2)], allowBlank: true };
/** A fake Univer worksheet facade exposing the CF/DV model getters. */
const worksheet = (cf = [cfRule], dv = [dvRule]) => ({
  getConditionalFormattingRules: () => cf,
  getDataValidations: () => dv.map((rule) => ({ rule })),
});
const mutation = (id, params = { unitId: 'file-sha', subUnitId: 's1' }) => ({ id, type: 2, params });

test('a CF mutation snapshots the sheet rule model as a whole-sheet edit and marks the sheet dirty', () => {
  const book = state();
  const edits = ingestRuleSetMutation(book, mutation('sheet.mutation.add-conditional-rule'), () => worksheet());
  assert.deepEqual(edits, [{
    sheetId: 's1', ruleSet: 'conditionalFormats',
    rules: [{ ranges: [area(1, 9, 1, 1)], stopIfTrue: false, rule: cfRule.rule }],
  }]);
  assert.notEqual(edits[0].rules[0].rule, cfRule.rule, 'the snapshot never aliases the live model');
  assert.ok(book.editJournal.cfDirty.has('s1'));
});

test('a DV mutation snapshots validations without their ranges inside the rule object', () => {
  const book = state();
  const [edit] = ingestRuleSetMutation(book, mutation('data-validation.mutation.removeRule'), () => worksheet());
  assert.equal(edit.ruleSet, 'dataValidations');
  assert.deepEqual(edit.rules, [{ ranges: [area(1, 9, 2, 2)], rule: { uid: 'dv-1', type: 'list', formula1: 'Yes,No', allowBlank: true } }]);
  assert.ok(book.editJournal.dvDirty.has('s1'));
  // The last rule removed: an empty snapshot that clears the sheet's section.
  assert.deepEqual(ingestRuleSetMutation(book, mutation('data-validation.mutation.removeRule'), () => worksheet([], []))[0].rules, []);
});

test('suppressed installs, foreign units, unknown sheets and unrelated mutations emit nothing', () => {
  const book = state();
  const sheet = () => worksheet();
  assert.deepEqual(ingestRuleSetMutation(book, mutation('sheet.mutation.add-conditional-rule'), sheet, true), []);
  assert.deepEqual(ingestRuleSetMutation(book, mutation('sheet.mutation.add-conditional-rule', { unitId: 'file-other', subUnitId: 's1' }), sheet), []);
  assert.deepEqual(ingestRuleSetMutation(book, mutation('sheet.mutation.add-conditional-rule', { unitId: 'file-sha', subUnitId: 'gone' }), sheet), []);
  assert.deepEqual(ingestRuleSetMutation(book, mutation('sheet.mutation.set-range-values'), sheet), []);
  assert.deepEqual(ingestRuleSetMutation(null, mutation('sheet.mutation.add-conditional-rule'), sheet), []);
  assert.equal(book.editJournal.cfDirty.size, 0);
});

test('snapshotSheetRules tolerates a facade without the getters', () => {
  assert.deepEqual(snapshotSheetRules({}, 'conditionalFormats'), []);
  assert.deepEqual(snapshotSheetRules({}, 'dataValidations'), []);
});

test('rule-set edits wait for the file rules of a file sheet; a session sheet is always ready', () => {
  // Review r2 n-1: pass the family, as the policy does.
  for (const kind of ['conditionalFormats', 'dataValidations']) {
    assert.equal(ruleSetSheetReady(state(), 's1', kind), true);
    assert.equal(ruleSetSheetReady(state({ applied: [] }), 's1', kind), false);
    assert.equal(ruleSetSheetReady(state({ applied: [] }), 'session-sheet', kind), true);
  }
});

const command = (id, params) => ({ id, type: 0, params });
const scope = { unitId: 'file-sha', subUnitId: 's1' };

test('the policy admits the toolbar CF/DV commands with saveable rules', () => {
  const book = state();
  assert.equal(canExecuteCommand(command('sheet.command.add-conditional-rule', { ...scope, rule: cfRule }), book, false), true);
  assert.equal(canExecuteCommand(command('sheet.command.addDataValidation', { ...scope, rule: dvRule }), book, false), true);
  assert.equal(canExecuteCommand(command('sheets.command.clear-range-data-validation', { ...scope, ranges: [area(0, 3, 0, 0)] }), book, false), true);
  assert.equal(canExecuteCommand(command('sheet.command.clear-range-conditional-rule', { ...scope, ranges: [area(0, 3, 0, 0)] }), book, false), true);
  assert.equal(canExecuteCommand(command('sheet.command.clear-worksheet-conditional-rule', scope), book, false), true);
  for (const id of ['sheet.mutation.add-conditional-rule', 'sheet.mutation.delete-conditional-rule', 'data-validation.mutation.addRule', 'data-validation.mutation.updateRule']) {
    assert.equal(canExecuteCommand(mutation(id), book, false), true, id);
  }
});

test('the policy refuses unsaveable rules, bad areas, foreign scopes, unloaded sheets and read-only', () => {
  const book = state();
  const refuse = (event, target = book, readOnly = false) => assert.equal(canExecuteCommand(event, target, readOnly), false, event.id);
  refuse(command('sheet.command.add-conditional-rule', { ...scope, rule: { ...cfRule, rule: { type: 'formula' } } }));
  refuse(command('sheet.command.addDataValidation', { ...scope, rule: { ...dvRule, type: 'listMultiple' } }));
  refuse(command('sheet.command.addDataValidation', { ...scope, rule: { ...dvRule, ranges: [area(3, 1, 0, 0)] } }));
  refuse(command('sheet.command.addDataValidation', { ...scope, rule: { ...dvRule, ranges: [] } }));
  refuse(command('sheet.command.add-conditional-rule', { ...scope, rule: { ...cfRule, ranges: [area(0, 0, 0, 16_384)] } }));
  refuse(command('sheet.command.add-conditional-rule', { ...scope, rule: { ...cfRule, stopIfTrue: 'yes' } }));
  refuse(command('sheets.command.clear-range-data-validation', scope));
  refuse(command('sheet.command.add-conditional-rule', { unitId: 'file-other', subUnitId: 's1', rule: cfRule }));
  refuse(command('sheet.command.add-conditional-rule', { unitId: 'file-sha', rule: cfRule }));
  refuse(command('sheet.command.add-conditional-rule', { ...scope, rule: cfRule }), state({ applied: [] }));
  refuse(command('sheet.command.add-conditional-rule', { ...scope, rule: cfRule }), book, true);
  refuse(mutation('data-validation.mutation.addRule', { unitId: 'file-other', subUnitId: 's1' }));
  // Commands this slice does not bind stay default-deny.
  refuse(command('sheet.command.remove-all-data-validation', scope));
  refuse(command('sheet.command.move-conditional-rule', scope));
});

// Review M1/M2/m2 (dv-cf-fix).
const x14 = (conditionalFormats, dataValidations) => ({ conditionalFormats, dataValidations });

test('an x14 family is refused on its sheet and never snapshotted; the other family still works', () => {
  const bar = state({ ruleSets: x14('x14', 'classic') });
  assert.equal(canExecuteCommand(command('sheet.command.add-conditional-rule', { ...scope, rule: cfRule }), bar, false), false);
  assert.equal(canExecuteCommand(command('sheet.command.clear-range-conditional-rule', { ...scope, ranges: [area(0, 3, 0, 0)] }), bar, false), false);
  assert.equal(canExecuteCommand(command('sheet.command.clear-worksheet-conditional-rule', scope), bar, false), false);
  assert.equal(canExecuteCommand(command('sheet.command.addDataValidation', { ...scope, rule: dvRule }), bar, false), true);
  // A row insert re-emits the data bar through the CF ref-range handler: the
  // mutation runs (the grid must move it) but no snapshot is journalled; the
  // gateway shifts the file block itself.
  assert.equal(canExecuteCommand(mutation('sheet.mutation.set-conditional-rule'), bar, false), true);
  assert.deepEqual(ingestRuleSetMutation(bar, mutation('sheet.mutation.set-conditional-rule'), () => worksheet()), []);
  assert.equal(bar.editJournal.cfDirty.size, 0);
  assert.equal(ingestRuleSetMutation(bar, mutation('data-validation.mutation.addRule'), () => worksheet()).length, 1);

  const dv = state({ ruleSets: x14('none', 'x14') });
  assert.equal(canExecuteCommand(command('sheet.command.addDataValidation', { ...scope, rule: dvRule }), dv, false), false);
  assert.equal(canExecuteCommand(command('sheets.command.clear-range-data-validation', { ...scope, ranges: [area(0, 3, 0, 0)] }), dv, false), false);
  assert.deepEqual(ingestRuleSetMutation(dv, mutation('data-validation.mutation.removeRule'), () => worksheet()), []);
  assert.equal(canExecuteCommand(command('sheet.command.add-conditional-rule', { ...scope, rule: cfRule }), dv, false), true);
  assert.equal(ruleSetSheetReady(dv, 's1', 'dataValidations'), false);
});

test('a family the file ships no rules for is ready before the loader marks the sheet', () => {
  const fresh = state({ applied: [], ruleSets: x14('none', 'classic') });
  assert.equal(ruleSetSheetReady(fresh, 's1', 'conditionalFormats'), true);
  assert.equal(ruleSetSheetReady(fresh, 's1', 'dataValidations'), false);
  assert.equal(canExecuteCommand(command('sheet.command.add-conditional-rule', { ...scope, rule: cfRule }), fresh, false), true);
  assert.equal(canExecuteCommand(command('sheet.command.addDataValidation', { ...scope, rule: dvRule }), fresh, false), false);
  // Not locked for the session: once the loader installs the sheet, it is ready.
  fresh.appliedDvSheets.add('s1');
  assert.equal(canExecuteCommand(command('sheet.command.addDataValidation', { ...scope, rule: dvRule }), fresh, false), true);
});

test('the policy refuses CF rules the gateway serializer throws on and DV operators or error styles it cannot write', () => {
  const book = state();
  const cf = (rule) => canExecuteCommand(command('sheet.command.add-conditional-rule', { ...scope, rule: { ...cfRule, rule } }), book, false);
  const dv = (rule) => canExecuteCommand(command('sheet.command.addDataValidation', { ...scope, rule: { ...dvRule, ...rule } }), book, false);
  assert.equal(cf({ type: 'highlightCell', subType: 'timePeriod', operator: 'yesterday', style: {} }), false);
  assert.equal(cf({ type: 'highlightCell', subType: 'average', operator: 'equal', style: {} }), false);
  assert.equal(cf({ type: 'highlightCell', subType: 'number', operator: 'greaterThan', value: 'ten', style: {} }), false);
  assert.equal(cf({ type: 'iconSet', config: [{ iconType: '3Triangles', iconId: '0' }, { iconType: '3Triangles', iconId: '1' }] }), false);
  assert.equal(cf({ type: 'highlightCell', subType: 'text', operator: 'containsText', value: 'x', style: {} }), true);
  assert.equal(dv({ type: 'whole', operator: 'approximately', formula1: '1' }), false);
  assert.equal(dv({ errorStyle: 7 }), false);
  assert.equal(dv({ type: 'whole', operator: 'notBetween', formula1: '1', formula2: '9', errorStyle: 2 }), true);
});

// Review r2 M-B: the loader's installs are counted and dry-run (suppressed add
// mutations); a family whose live rules fall short of the file's raw count, or
// hold a rule the save cannot re-serialize, is refused and never snapshotted.
const classic = { conditionalFormats: 'classic', dataValidations: 'classic' };
const install = (book, id, rule) => ingestRuleSetMutation(book, mutation(id, { ...scope, rule }), () => worksheet(), true);
const timePeriod = { ...cfRule, cfId: 'cf-2', rule: { type: 'highlightCell', subType: 'timePeriod', operator: 'yesterday', style: {} } };
const addCf = (target, subUnitId = 's1') => canExecuteCommand(command('sheet.command.add-conditional-rule', { unitId: 'file-sha', subUnitId, rule: cfRule }), target, false);
const addDv = (target, subUnitId = 's1') => canExecuteCommand(command('sheet.command.addDataValidation', { unitId: 'file-sha', subUnitId, rule: dvRule }), target, false);

test('a family whose installed file rules fall short of the file count is refused and never snapshotted', () => {
  // The fixture shape of xlsx-classic-unsupported-cf.xlsx: 3 cfRule elements,
  // only one of which the loader can install, and 1 validation.
  const book = state({ applied: [], ruleSets: classic, ruleCounts: { conditionalFormats: 3, dataValidations: 1 } });
  install(book, 'sheet.mutation.add-conditional-rule', cfRule);
  install(book, 'data-validation.mutation.addRule', dvRule);
  book.appliedDvSheets.add('s1');
  assert.equal(addCf(book), false, 'the snapshot would silently delete the two rules the grid never showed');
  assert.equal(canExecuteCommand(command('sheet.command.clear-worksheet-conditional-rule', scope), book, false), false);
  assert.equal(addDv(book), true, 'the validation family installed in full');
  // A row insert moves the installed rule through the ref-range handler: no snapshot.
  assert.deepEqual(ingestRuleSetMutation(book, mutation('sheet.mutation.set-conditional-rule'), () => worksheet()), []);
  assert.equal(book.editJournal.cfDirty.size, 0);
  assert.equal(ingestRuleSetMutation(book, mutation('data-validation.mutation.removeRule'), () => worksheet()).length, 1);
});

test('an installed file rule the save cannot re-serialize refuses its family', () => {
  // No ruleCounts (an older host): only the dry-run decides.
  const book = state({ applied: [], ruleSets: classic });
  install(book, 'sheet.mutation.add-conditional-rule', cfRule);
  install(book, 'sheet.mutation.add-conditional-rule', timePeriod);
  install(book, 'data-validation.mutation.addRule', { ...dvRule, operator: 'approximately' });
  book.appliedDvSheets.add('s1');
  assert.equal(addCf(book), false);
  assert.equal(addDv(book), false);
  assert.equal(ruleSetSheetReady(book, 's1', 'conditionalFormats'), false);
});

test('a family whose file rules all installed and dry-run clean stays editable and snapshotted', () => {
  const book = state({ applied: [], ruleSets: classic, ruleCounts: { conditionalFormats: 2, dataValidations: 1 } });
  install(book, 'sheet.mutation.add-conditional-rule', cfRule);
  install(book, 'sheet.mutation.add-conditional-rule', { ...cfRule, cfId: 'cf-2' });
  install(book, 'data-validation.mutation.addRule', dvRule);
  assert.equal(addCf(book), false, 'pending until the loader marks the sheet');
  book.appliedDvSheets.add('s1');
  assert.equal(addCf(book), true);
  assert.equal(addDv(book), true);
  assert.equal(ingestRuleSetMutation(book, mutation('sheet.mutation.add-conditional-rule'), () => worksheet()).length, 1);
  // Installs never journal themselves.
  assert.equal(book.editJournal.dvDirty.size, 0);
});

// Review r2 M-C: a copy holds what the live model held for its source at the
// copy, and the gateway duplicates the source's XML; it inherits the state.
const copySheet = (book, id, source) => {
  if (source) recordSheetDuplicate(book.editJournal, id, `${id} name`, source);
  else recordSheetInsert(book.editJournal, id, `${id} name`);
  return ingestRuleSetMutation(book, { id: 'sheet.mutation.insert-sheet', type: 2, params: { unitId: 'file-sha', index: 1, sheet: { id, name: `${id} name` } } }, () => worksheet());
};

test('a duplicate of an x14 sheet inherits the refusal; its copied rules are never snapshotted', () => {
  const book = state({ ruleSets: x14('x14', 'none') });
  assert.deepEqual(copySheet(book, 'copy', 's1'), []);
  // The CF plugin re-adds the source rules on the copy (not suppressed).
  assert.deepEqual(ingestRuleSetMutation(book, mutation('sheet.mutation.add-conditional-rule', { unitId: 'file-sha', subUnitId: 'copy' }), () => worksheet()), []);
  assert.equal(book.editJournal.cfDirty.size, 0);
  assert.equal(addCf(book, 'copy'), false);
  assert.equal(addDv(book, 'copy'), true, 'the source ships no validations');
  // A copy of the copy inherits through the chain.
  copySheet(book, 'copy-2', 'copy');
  assert.equal(addCf(book, 'copy-2'), false);
});

test('a duplicate of a not-yet-installed classic sheet stays refused; a ready source or a plain new sheet is editable', () => {
  const pending = state({ applied: [], ruleSets: classic });
  copySheet(pending, 'copy', 's1');
  pending.appliedDvSheets.add('s1');
  assert.equal(addCf(pending), true, 'the source itself becomes ready');
  assert.equal(addCf(pending, 'copy'), false, 'the copy never received the source rules');

  const ready = state({ ruleSets: classic });
  copySheet(ready, 'copy', 's1');
  assert.equal(addCf(ready, 'copy'), true);
  assert.equal(ingestRuleSetMutation(ready, mutation('sheet.mutation.add-conditional-rule', { unitId: 'file-sha', subUnitId: 'copy' }), () => worksheet()).length, 1);
  copySheet(ready, 'fresh');
  assert.equal(addDv(ready, 'fresh'), true);
});

// Review r3 MA-3: after a save dropped a family of a sheet, the host restores
// the rules the file holds and the family stays refused for the session.
const restorePort = (cf, dv) => {
  const calls = [];
  return { calls, port: { worksheet: worksheet(cf, dv), execute: (id, params) => calls.push([id, params]) } };
};

test('a restore with the saved rules replaces the live CF model and refuses the family', () => {
  const book = state();
  const live = [cfRule, { ...cfRule, cfId: 'cf-bad' }];
  const { calls, port } = restorePort(live, [dvRule]);
  const saved = [
    { ranges: [area(0, 0, 0, 0)], stopIfTrue: true, rule: { type: 'highlightCell', tag: 'first' } },
    { ranges: [area(1, 1, 0, 0)], stopIfTrue: false, rule: { type: 'highlightCell', tag: 'second' } },
  ];
  restoreRuleSetFamily(book, 's1', 'conditionalFormats', saved, port);
  assert.deepEqual(calls.slice(0, 2).map(([id, params]) => [id, params.cfId]), [
    ['sheet.mutation.delete-conditional-rule', 'cf-1'], ['sheet.mutation.delete-conditional-rule', 'cf-bad'],
  ]);
  // The model unshifts each add: the last saved rule goes in first.
  const added = calls.slice(2);
  assert.deepEqual(added.map(([id, params]) => [id, params.subUnitId, params.rule.rule.tag, params.rule.stopIfTrue]), [
    ['sheet.mutation.add-conditional-rule', 's1', 'second', false], ['sheet.mutation.add-conditional-rule', 's1', 'first', true],
  ]);
  assert.ok(added.every(([, params]) => params.unitId === 'file-sha' && typeof params.rule.cfId === 'string'));
  assert.equal(ruleSetSheetReady(book, 's1', 'conditionalFormats'), false);
  assert.equal(ruleSetSheetReady(book, 's1', 'dataValidations'), true, 'the other family is untouched');
  assert.equal(addCf(book), false, 'a further edit is refused, with the dialog reason');
  assert.deepEqual(ingestRuleSetMutation(book, mutation('sheet.mutation.add-conditional-rule'), () => worksheet()), [], 'and never snapshotted');
});

test('a restore without saved rules reinstalls the file rules the loader installed, without counting them again', () => {
  const book = state({ applied: [], ruleSets: classic, ruleCounts: { conditionalFormats: 2, dataValidations: 1 } });
  install(book, 'sheet.mutation.add-conditional-rule', cfRule);
  install(book, 'sheet.mutation.add-conditional-rule', { ...cfRule, cfId: 'cf-2' });
  install(book, 'data-validation.mutation.addRule', dvRule);
  book.appliedDvSheets.add('s1');
  const dv = restorePort([], [dvRule, { ...dvRule, uid: 'dv-session' }]);
  restoreRuleSetFamily(book, 's1', 'dataValidations', null, dv.port);
  assert.deepEqual(dv.calls.map(([id, params]) => [id, params.ruleId ?? params.rule?.uid]), [
    ['data-validation.mutation.removeRule', 'dv-1'], ['data-validation.mutation.removeRule', 'dv-session'], ['data-validation.mutation.addRule', 'dv-1'],
  ]);
  const cf = restorePort([{ ...cfRule, cfId: 'cf-session' }], []);
  restoreRuleSetFamily(book, 's1', 'conditionalFormats', null, cf.port);
  // Model order was [cf-2, cf-1] (each install unshifts); re-adding cf-1 then cf-2 rebuilds it.
  assert.deepEqual(cf.calls.map(([id, params]) => [id, params.cfId ?? params.rule?.cfId]), [
    ['sheet.mutation.delete-conditional-rule', 'cf-session'], ['sheet.mutation.add-conditional-rule', 'cf-1'], ['sheet.mutation.add-conditional-rule', 'cf-2'],
  ]);
  assert.equal(addDv(book), false);
  assert.equal(addCf(book), false);
});

// Review r4 R4-2: the gateway copies the source's file rules, so a copy's
// restore to "the file's rules" paints them instead of clearing the sheet.
test('a restore without saved rules on a copy reinstalls the file rules its source shipped', () => {
  const book = state({ applied: [], ruleSets: classic, ruleCounts: { conditionalFormats: 1, dataValidations: 0 } });
  install(book, 'sheet.mutation.add-conditional-rule', cfRule);
  book.appliedDvSheets.add('s1');
  copySheet(book, 'copy', 's1');
  const cf = restorePort([{ ...cfRule, cfId: 'cf-copy-session' }], []);
  restoreRuleSetFamily(book, 'copy', 'conditionalFormats', null, cf.port);
  assert.deepEqual(cf.calls.map(([id, params]) => [id, params.subUnitId, params.cfId ?? params.rule?.cfId]), [
    ['sheet.mutation.delete-conditional-rule', 'copy', 'cf-copy-session'], ['sheet.mutation.add-conditional-rule', 'copy', 'cf-1'],
  ]);
  // A plain new sheet has no file rules to restore.
  copySheet(book, 'fresh');
  const fresh = restorePort([{ ...cfRule, cfId: 'cf-fresh' }], []);
  restoreRuleSetFamily(book, 'fresh', 'conditionalFormats', null, fresh.port);
  assert.deepEqual(fresh.calls.map(([id]) => id), ['sheet.mutation.delete-conditional-rule']);
});

test('a restore passes the rule-set policy gate: a live sheet of this workbook, a known family, bounded rules', () => {
  const book = state();
  const rules = [{ ranges: [area(0, 0, 0, 0)], rule: { type: 'whole' } }];
  assert.equal(ruleSetRestoreAllowed(book, 's1', 'dataValidations', rules), true);
  assert.equal(ruleSetRestoreAllowed(book, 's1', 'conditionalFormats', null), true);
  assert.equal(ruleSetRestoreAllowed(book, 'nope', 'conditionalFormats', null), false);
  assert.equal(ruleSetRestoreAllowed(book, 's1', 'filters', null), false);
  assert.equal(ruleSetRestoreAllowed(book, 's1', 'conditionalFormats', [{ ranges: [area(3, 1, 0, 0)], rule: {} }]), false);
  assert.equal(ruleSetRestoreAllowed(book, 's1', 'conditionalFormats', [{ ranges: [area(0, 0, 0, 0)] }]), false);
  assert.equal(ruleSetRestoreAllowed(book, 's1', 'conditionalFormats', 'x'), false);
});

// UNI-953: the rule managers read the live rules with their model ids and fire
// edit / move / delete commands by id; the policy admits exactly those shapes.
test('readLiveRuleSet returns each live rule with its model id, CF in model order', () => {
  const sheet = worksheet([cfRule, { ...cfRule, cfId: 'cf-2' }, { ...cfRule, cfId: undefined }], [dvRule, { ...dvRule, uid: undefined }]);
  assert.deepEqual(readLiveRuleSet(sheet, 'conditionalFormats').map((rule) => rule.id), ['cf-1', 'cf-2']);
  assert.deepEqual(readLiveRuleSet(sheet, 'dataValidations'), [
    { id: 'dv-1', ranges: [area(1, 9, 2, 2)], rule: { type: 'list', formula1: 'Yes,No', allowBlank: true } },
  ]);
  assert.deepEqual(readLiveRuleSet({}, 'conditionalFormats'), []);
});

test('the policy admits the rule-manager commands by model id and refuses malformed ones', () => {
  const book = state();
  const allow = (id, params) => assert.equal(canExecuteCommand(command(id, { ...scope, ...params }), book, false), true, id);
  const refuse = (id, params, target = book, readOnly = false) =>
    assert.equal(canExecuteCommand(command(id, { ...scope, ...params }), target, readOnly), false, `${id} ${JSON.stringify(params)}`);
  allow('sheet.command.set-conditional-rule', { cfId: 'cf-1', rule: cfRule });
  allow('sheet.command.move-conditional-rule', { start: { id: 'cf-1', type: 'self' }, end: { id: 'cf-2', type: 'after' } });
  allow('sheet.command.delete-conditional-rule', { cfId: 'cf-1' });
  allow('sheets.command.update-data-validation-setting', { ruleId: 'dv-1', setting: { type: 'whole', operator: 'between', formula1: '1', formula2: '5', allowBlank: true } });
  allow('sheets.command.update-data-validation-options', { ruleId: 'dv-1', options: { errorStyle: 2, error: 'Keep?', errorTitle: 'Check', showErrorMessage: true } });
  allow('sheets.command.update-data-validation-options', { ruleId: 'dv-1', options: { errorStyle: 0 } });
  allow('sheet.command.updateDataValidationRuleRange', { ruleId: 'dv-1', ranges: [area(0, 3, 0, 0)] });
  allow('sheet.command.remove-data-validation-rule', { ruleId: 'dv-1' });

  refuse('sheet.command.set-conditional-rule', { cfId: 'cf-1', rule: { ...cfRule, cfId: 'cf-9' } });
  refuse('sheet.command.set-conditional-rule', { cfId: 'cf-1', rule: { ...cfRule, rule: { type: 'formula' } } });
  refuse('sheet.command.set-conditional-rule', { rule: cfRule });
  refuse('sheet.command.move-conditional-rule', { start: { id: 'cf-1', type: 'before' }, end: { id: 'cf-2', type: 'after' } });
  refuse('sheet.command.move-conditional-rule', { start: { id: 'cf-1', type: 'self' }, end: { id: '', type: 'after' } });
  refuse('sheet.command.delete-conditional-rule', { cfId: 7 });
  refuse('sheet.command.delete-conditional-rule', { cfId: 'x'.repeat(201) });
  refuse('sheets.command.update-data-validation-setting', { ruleId: 'dv-1', setting: { type: 'listMultiple' } });
  refuse('sheets.command.update-data-validation-setting', { ruleId: 'dv-1', setting: { type: 'whole', operator: 'like' } });
  refuse('sheets.command.update-data-validation-options', { ruleId: 'dv-1', options: { errorStyle: 3 } });
  refuse('sheets.command.update-data-validation-options', { ruleId: 'dv-1', options: { errorTitle: 'x'.repeat(33) } });
  refuse('sheets.command.update-data-validation-options', { ruleId: 'dv-1', options: { showErrorMessage: 'yes' } });
  refuse('sheet.command.updateDataValidationRuleRange', { ruleId: 'dv-1', ranges: [area(3, 1, 0, 0)] });
  refuse('sheet.command.remove-data-validation-rule', {});
  // The same scope rules as the toolbar commands: readiness, read-only, x14 DV.
  refuse('sheet.command.delete-conditional-rule', { cfId: 'cf-1' }, state({ applied: [] }));
  refuse('sheet.command.remove-data-validation-rule', { ruleId: 'dv-1' }, book, true);
  refuse('sheet.command.remove-data-validation-rule', { ruleId: 'dv-1' }, state({ ruleSets: x14('classic', 'x14') }));
});

test('a rule-manager mutation snapshots the whole sheet like any CF/DV change', () => {
  const book = state();
  const [cf] = ingestRuleSetMutation(book, mutation('sheet.mutation.move-conditional-rule'), () => worksheet([{ ...cfRule, cfId: 'cf-2' }, cfRule]));
  assert.equal(cf.ruleSet, 'conditionalFormats');
  assert.equal(cf.rules.length, 2);
  const [dv] = ingestRuleSetMutation(book, mutation('data-validation.mutation.updateRule'), () => worksheet([], [{ ...dvRule, errorStyle: 2 }]));
  assert.equal(dv.rules[0].rule.errorStyle, 2);
});

// UNI-953: warning and information validations ask instead of accepting.
const cell = { unitId: 'file-sha', subUnitId: 's1', row: 1, col: 2 };
function errorStylePort(rule, valid = false, answer = true) {
  const asked = [];
  return {
    asked,
    port: {
      ruleAt: () => rule,
      isValid: async () => valid,
      confirm: async (options) => { asked.push(options); return answer; },
    },
  };
}

test('a warning rule asks whether to keep an invalid value; the answer is the verdict', async () => {
  const yes = errorStylePort({ errorStyle: 2, error: 'Only 1-5', errorTitle: 'Check' }, false, true);
  assert.equal(await settleDvErrorStyle(true, cell, yes.port), true);
  assert.deepEqual(yes.asked, [{ id: 'uniwork-dv-error-style', title: 'Check', message: 'Only 1-5', confirmText: 'dvWarningYes', cancelText: 'dvWarningNo' }]);
  const no = errorStylePort({ errorStyle: 2 }, false, false);
  assert.equal(await settleDvErrorStyle(true, cell, no.port), false);
  assert.equal(no.asked[0].title, 'dvWarningTitle');
  assert.equal(no.asked[0].message, 'dvRejectTitle');
});

test('an information rule shows a notice: OK keeps the value, Cancel drops it', async () => {
  const ok = errorStylePort({ errorStyle: 0, error: 'Heads up' }, false, true);
  assert.equal(await settleDvErrorStyle(true, cell, ok.port), true);
  assert.equal(ok.asked[0].confirmText, 'dvInfoOk');
  assert.equal(ok.asked[0].title, 'dvInfoTitle');
  assert.equal(await settleDvErrorStyle(true, cell, errorStylePort({ errorStyle: '0' }, false, false).port), false);
});

test('a valid value, a stop or unstyled rule, a silenced alert and a plugin refusal never ask', async () => {
  const never = (rule, valid = false, accepted = true) => {
    const probe = errorStylePort(rule, valid);
    return settleDvErrorStyle(accepted, cell, probe.port).then((verdict) => ({ verdict, asked: probe.asked.length }));
  };
  assert.deepEqual(await never({ errorStyle: 2 }, true), { verdict: true, asked: 0 });
  assert.deepEqual(await never({ errorStyle: 1 }), { verdict: true, asked: 0 });
  assert.deepEqual(await never({}), { verdict: true, asked: 0 });
  assert.deepEqual(await never({ errorStyle: null }), { verdict: true, asked: 0 });
  assert.deepEqual(await never(null), { verdict: true, asked: 0 });
  assert.deepEqual(await never({ errorStyle: 2, showErrorMessage: false }), { verdict: true, asked: 0 });
  assert.deepEqual(await never({ errorStyle: 2 }, false, false), { verdict: false, asked: 0 });
});

test('the invalid-cell hint grows to its title instead of wrapping it into the message', () => {
  const appended = [];
  const doc = {
    getElementById: (id) => appended.find((node) => node.id === id) ?? null,
    createElement: () => ({ id: '', textContent: '' }),
    head: { appendChild: (node) => appended.push(node) },
  };
  ensureDvHintStyle(doc);
  ensureDvHintStyle(doc);
  assert.equal(appended.length, 1);
  assert.match(appended[0].textContent, /\[class~='univer-w-\[156px\]'\][^{]*\{width:max-content;min-width:156px;max-width:min\(320px,80vw\)\}/);
  assert.match(appended[0].textContent, /\[class~='univer-h-5'\]\{height:auto/);
});

test('askOnValidateCell settles the question on the verdict the editor awaits, ahead of an outer wrapper', async () => {
  const source = { onValidateCell: (_workbook, _worksheet, _row, _col) => Promise.resolve(true) };
  const original = source.onValidateCell;
  const probe = errorStylePort({ errorStyle: 2, error: 'Only 1-5' }, false, false);
  const ask = askOnValidateCell(source, probe.port);
  // The write gate wraps after it (controller loadWorkbook) and must read the answer.
  const inner = source.onValidateCell;
  let gateSaw;
  source.onValidateCell = (...args) => { const verdict = inner(...args); Promise.resolve(verdict).then((v) => { gateSaw = v; }); return verdict; };
  const workbook = { getUnitId: () => 'file-sha' };
  const sheet = { getSheetId: () => 's1' };
  assert.equal(await source.onValidateCell(workbook, sheet, 1, 2), false);
  await Promise.resolve();
  assert.equal(gateSaw, false);
  assert.equal(probe.asked.length, 1);
  // Without a usable cell the plugin's verdict passes through untouched.
  assert.equal(await inner({}, sheet, 1, 2), true);
  source.onValidateCell = inner;
  ask.dispose();
  assert.equal(source.onValidateCell, original);
});
