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
    contents: `export * from './rule-set-capture'; export * from './rule-set-policy'; export { canExecuteCommand } from './command-policy';
      export { createEditJournal } from '../../upstream/apps/sheets/src/renderer/edit-journal';`,
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
const { createEditJournal, ingestRuleSetMutation, snapshotSheetRules, ruleSetSheetReady, canExecuteCommand } = module.exports;

const area = (startRow, endRow, startColumn, endColumn) => ({ startRow, endRow, startColumn, endColumn });
function state({ applied = ['s1'] } = {}) {
  return {
    file: { sessionId: 'book', sha256: 'sha', sheets: [{ id: 's1', name: 'Data', hidden: false, rowCount: 20, columnCount: 10, pivotRanges: [] }] },
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
  assert.equal(ruleSetSheetReady(state(), 's1'), true);
  assert.equal(ruleSetSheetReady(state({ applied: [] }), 's1'), false);
  assert.equal(ruleSetSheetReady(state({ applied: [] }), 'session-sheet'), true);
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
