// DOC-003 (UNI-667) focused regression coverage for the save-time formula values.
//
// The gap this pins: a small workbook runs in formulaMode, where Univer's own
// engine recalculates on screen but the IronCalc overlay lane is closure-only.
// Save built its formula values from that (empty) overlay, so the persisted
// xlsx kept the file's stale cached <v> beside a correct <f> — the grid showed
// 9 while a reopened view showed 5.
//
// The module under test is loaded from the MANAGED COPY (the real built
// source), not from a copy of it, so these assertions cannot drift from what
// ships. It is dependency-free by design: no import needs stubbing.
//
// Run with the prepared Node:
//   node --test scripts/office-g0/sheets-save-formula-values.test.mjs

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import typescript from 'typescript'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WORKTREE = path.resolve(HERE, '..', '..')

/// The managed copy lives under the lab root; the runner records it per build.
export function managedModulePath() {
  const rel = ['apps', 'sheets', 'src', 'renderer', 'save-formula-values.ts']
  const fromEnv = process.env.OFFICE_G0_XLSX_MANAGED_COPY
  if (fromEnv !== undefined && fromEnv !== '') {
    // An explicit override is honored exactly: it never silently falls back, so
    // pointing this suite at an unpatched copy fails loudly (the RED proof)
    // instead of quietly testing some other build.
    const explicit = path.join(fromEnv, ...rel)
    if (!fs.existsSync(explicit)) {
      throw new Error('OFFICE_G0_XLSX_MANAGED_COPY has no ' + rel.join('/') + ': ' + explicit)
    }
    return explicit
  }
  const fallback = path.join(
    WORKTREE,
    '..',
    '..',
    '..',
    'office-g0',
    'advisor-resume2',
    'xlsx-feature',
    'renderer-source',
    'host-build-source',
    ...rel,
  )
  if (!fs.existsSync(fallback)) {
    throw new Error('managed copy of save-formula-values.ts not found; set OFFICE_G0_XLSX_MANAGED_COPY')
  }
  return fallback
}

/// Loads the REAL managed module. The source is TypeScript with no imports, so
/// a plain CommonJS emit is enough — and because there is nothing to stub, an
/// assertion here cannot be satisfied by a fake collaborator.
function loadManagedModule() {
  const file = managedModulePath()
  const source = fs.readFileSync(file, 'utf8')
  const compiled = typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2022,
    },
    fileName: file,
  }).outputText
  const shim = { exports: {} }
  // eslint-disable-next-line no-new-func
  new Function('exports', 'module', compiled)(shim.exports, shim)
  return { mod: shim.exports, file }
}

const { mod, file } = loadManagedModule()
const {
  batchCellRanges,
  overlaySaveFormulaValues,
  recalcSaveFormulaValues,
  saveEditRevision,
  saveFormulaLane,
  isRecalcBusy,
  retryBusySlot,
  splitCellKey,
} = mod

/// The real univer-sync policy the save lane delegates to, restated here as the
/// test's own oracle so a change in it shows up as a failing expectation.
const keepsCacheOracle = (formatted, formulaText, cached, hasEdits) => {
  if (formatted === '#NAME?' || formatted === '#ERROR!') return true
  if (formulaText !== undefined && /(?:^|[^A-Z0-9_.])(?:NUMBERSTRING|DOLLAR)\s*\(/.test(formulaText)) return true
  if (hasEdits) return false
  return (formatted === '' || formatted.startsWith('#')) && cached !== null && cached !== undefined && cached !== ''
}

const recalcContext = (overrides = {}) => ({
  hasEdits: true,
  isSheetRemoved: () => false,
  formulaTextAt: () => undefined,
  cachedAt: () => undefined,
  keepsCache: keepsCacheOracle,
  ...overrides,
})

const JOURNAL = (entries) =>
  new Map(entries.map(([sheetId, cells]) => [sheetId, new Map(cells.map((cell) => [cell.key, cell]))]))

test('T1 the module under test is the managed build, and it exports the save lane', () => {
  assert.ok(file.includes(path.join('renderer-source', 'host-build-source')), 'loaded from the managed copy')
  for (const name of ['saveEditRevision', 'overlaySaveFormulaValues', 'recalcSaveFormulaValues', 'batchCellRanges', 'splitCellKey']) {
    assert.equal(typeof mod[name], 'function', name + ' is exported')
  }
})

test('T2 active formulaMode lane: the sidecar answer becomes the persisted formula value', () => {
  // The reported defect: B3 = SUM(C1:C2) must persist 9 (C1 was edited to 9),
  // not the file cache 5.
  const outcome = recalcSaveFormulaValues(
    [{ sheetId: 's1', row: 2, column: 1, formatted: '9', number: 9, isFormula: true }],
    recalcContext(),
  )
  assert.deepEqual(outcome.values, [{ sheetId: 's1', row: 2, column: 1, value: 9 }])
  assert.equal(outcome.keptCache, 0)
})

test('T3 immediate save after an input edit uses the fresh source value, not the stale cache', () => {
  // The same cell with its stale cache present: an edit moved the inputs, so a
  // correct result must win over the cache.
  const outcome = recalcSaveFormulaValues(
    [{ sheetId: 's1', row: 2, column: 1, formatted: '9', number: 9, isFormula: true }],
    recalcContext({ cachedAt: () => 5 }),
  )
  assert.deepEqual(outcome.values, [{ sheetId: 's1', row: 2, column: 1, value: 9 }])
})

test('T4 an unedited error/blank answer keeps the file cache instead of overwriting it', () => {
  const cells = [{ sheetId: 's1', row: 1, column: 0, formatted: '', isFormula: true }]
  const edited = recalcSaveFormulaValues(cells, recalcContext({ hasEdits: true }))
  assert.deepEqual(edited.values, [{ sheetId: 's1', row: 1, column: 0, value: '' }], 'a real blank result is persisted')

  const unedited = recalcSaveFormulaValues(
    cells,
    recalcContext({ hasEdits: false, cachedAt: () => 42 }),
  )
  assert.equal(unedited.values.length, 0, 'capability gap does not displace a usable cache')
  assert.equal(unedited.keptCache, 1)
})

test('T5 the engine capability policy is honoured per cell', () => {
  for (const formatted of ['#NAME?', '#ERROR!']) {
    const outcome = recalcSaveFormulaValues(
      [{ sheetId: 's1', row: 0, column: 0, formatted, isFormula: true }],
      recalcContext(),
    )
    assert.equal(outcome.values.length, 0, formatted + ' never becomes a persisted cache')
    assert.equal(outcome.keptCache, 1)
  }
  const locale = recalcSaveFormulaValues(
    [{ sheetId: 's1', row: 0, column: 0, formatted: 'một', isFormula: true }],
    recalcContext({ formulaTextAt: () => '=DOLLAR(1)' }),
  )
  assert.equal(locale.values.length, 0, 'a locale-minted result keeps the authoring locale cache')
})

test('T6 a literal (non-formula) answer never rides the formula-value lane', () => {
  const outcome = recalcSaveFormulaValues(
    [{ sheetId: 's1', row: 0, column: 0, formatted: '9', number: 9, isFormula: false }],
    recalcContext(),
  )
  assert.deepEqual(outcome.values, [])
})

test('T7 an engine-typed error becomes the t="e" error payload, not a number', () => {
  const outcome = recalcSaveFormulaValues(
    [{ sheetId: 's1', row: 4, column: 2, formatted: '#DIV/0!', isError: true, isFormula: true }],
    recalcContext(),
  )
  assert.deepEqual(outcome.values, [{ sheetId: 's1', row: 4, column: 2, value: { error: '#DIV/0!' } }])
})

test('T8 a removed sheet contributes no formula values', () => {
  const outcome = recalcSaveFormulaValues(
    [{ sheetId: 'gone', row: 0, column: 0, formatted: '9', number: 9, isFormula: true }],
    recalcContext({ isSheetRemoved: (id) => id === 'gone' }),
  )
  assert.deepEqual(outcome.values, [])
})

test('T9 a journaled formula is NOT excluded from the sidecar lane, but IS from the overlay lane', () => {
  // The overlay may hold the PREVIOUS formula's result, so it must exclude a
  // cell the user just replaced. The sidecar answer was computed from this
  // save's own edits, so excluding it would drop a legitimate cache refresh.
  const sidecar = recalcSaveFormulaValues(
    [{ sheetId: 's1', row: 2, column: 1, formatted: '12', number: 12, isFormula: true }],
    recalcContext(),
  )
  assert.deepEqual(sidecar.values, [{ sheetId: 's1', row: 2, column: 1, value: 12 }])

  const overlay = overlaySaveFormulaValues(
    new Map([['s1', new Map([['2:1', { v: 5 }]])]]),
    { isSheetRemoved: () => false, hasJournaledFormula: () => true },
  )
  assert.deepEqual(overlay, [], 'the replaced formula\'s stale overlay result stays out')
})

test('T10 the closure lane overlay becomes formula values, excluding #ERROR! and removed sheets', () => {
  const overlay = new Map([
    ['s1', new Map([['2:1', { v: 9 }], ['3:1', { v: '#ERROR!' }], ['4:1', { v: 'x', isError: true }]])],
    ['gone', new Map([['0:0', { v: 7 }]])],
  ])
  const values = overlaySaveFormulaValues(overlay, {
    isSheetRemoved: (id) => id === 'gone',
    hasJournaledFormula: () => false,
  })
  assert.deepEqual(values, [
    { sheetId: 's1', row: 2, column: 1, value: 9 },
    { sheetId: 's1', row: 4, column: 1, value: { error: 'x' } },
  ])
})

test('T11 the revision fingerprint changes with an input edit, a formula replace and a removal', () => {
  const base = saveEditRevision({
    sheets: JOURNAL([['s1', [{ key: '0:0', hasValue: true, value: 5 }]]]),
    removedSheets: new Set(),
    addedSheets: new Set(),
  })
  const edited = saveEditRevision({
    sheets: JOURNAL([['s1', [{ key: '0:0', hasValue: true, value: 9 }]]]),
    removedSheets: new Set(),
    addedSheets: new Set(),
  })
  assert.notEqual(base, edited, 'a changed input changes the revision')

  const formula = saveEditRevision({
    sheets: JOURNAL([['s1', [{ key: '2:1', hasValue: false, value: null, formula: 'SUM(C1:C2)' }]]]),
    removedSheets: new Set(),
    addedSheets: new Set(),
  })
  const replaced = saveEditRevision({
    sheets: JOURNAL([['s1', [{ key: '2:1', hasValue: false, value: null, formula: 'SUM(C1:C3)' }]]]),
    removedSheets: new Set(),
    addedSheets: new Set(),
  })
  assert.notEqual(formula, replaced, 'a replaced formula changes the revision')

  const removed = saveEditRevision({
    sheets: JOURNAL([['s1', [{ key: '0:0', hasValue: true, value: 5 }]]]),
    removedSheets: new Set(['s1']),
    addedSheets: new Set(),
  })
  assert.notEqual(base, removed, 'a removal changes the revision')
})

test('T12 the revision fingerprint is stable for unchanged input and ignores non-value entries', () => {
  const input = {
    sheets: JOURNAL([
      ['s2', [{ key: '0:0', hasValue: true, value: 1 }]],
      ['s1', [{ key: '1:1', hasValue: false, value: null }, { key: '0:0', hasValue: true, value: 5 }]],
    ]),
    removedSheets: new Set(),
    addedSheets: new Set(),
  }
  const again = {
    sheets: JOURNAL([
      ['s1', [{ key: '0:0', hasValue: true, value: 5 }]],
      ['s2', [{ key: '0:0', hasValue: true, value: 1 }]],
    ]),
    removedSheets: new Set(),
    addedSheets: new Set(),
  }
  assert.equal(saveEditRevision(input), saveEditRevision(again), 'insertion order does not matter')
  assert.ok(!saveEditRevision(input).includes('1:1'), 'a style-only entry is not an input')
})

test('T13 a formula cell with no cached value still counts as an edit (an added formula must recalc)', () => {
  const withFormula = saveEditRevision({
    sheets: JOURNAL([['s1', [{ key: '0:0', hasValue: false, value: null, formula: '=1+1' }]]]),
    removedSheets: new Set(),
    addedSheets: new Set(),
  })
  assert.notEqual(withFormula, '', 'a newly typed formula is a real edit')
})

test('T14 range batching covers every band exactly once, within both caps', () => {
  const bands = [
    { startRow: 0, endRow: 9, startColumn: 0, endColumn: 9 },
    { startRow: 100, endRow: 109, startColumn: 0, endColumn: 9 },
    { startRow: 200, endRow: 209, startColumn: 0, endColumn: 9 },
  ]
  const batches = batchCellRanges(bands, 2, 1_000)
  assert.equal(batches.length, 2, 'two ranges per request')
  assert.deepEqual(
    batches.flat().map((b) => b.startRow),
    [0, 100, 200],
    'every band appears exactly once, in order',
  )
  for (const batch of batches) {
    assert.ok(batch.length <= 2, 'range cap respected')
    const cells = batch.reduce((n, b) => n + (b.endRow - b.startRow + 1) * (b.endColumn - b.startColumn + 1), 0)
    assert.ok(cells <= 1_000, 'cell cap respected')
  }

  const oversized = batchCellRanges([{ startRow: 0, endRow: 999, startColumn: 0, endColumn: 99 }], 200, 10)
  assert.equal(oversized.length, 1, 'a band larger than the cell budget still gets its own request')
  assert.equal(oversized[0].length, 1, 'and is never dropped')
})

test('T15 malformed overlay keys are skipped rather than emitted as NaN coordinates', () => {
  assert.deepEqual(splitCellKey('2:1'), { row: 2, column: 1 })
  for (const bad of ['', ':', '2', 'a:1', '1:b', '-1:2', '1:2:3']) {
    assert.equal(splitCellKey(bad), null, JSON.stringify(bad) + ' is not a cell key')
  }
  const values = overlaySaveFormulaValues(
    new Map([['s1', new Map([['bogus', { v: 1 }], ['0:0', { v: 2 }]])]]),
    { isSheetRemoved: () => false, hasJournaledFormula: () => false },
  )
  assert.deepEqual(values, [{ sheetId: 's1', row: 0, column: 0, value: 2 }])
})

test('T16 the save lane is decided by what the engine can represent, never by formulaMode', () => {
  const representable = {
    engineOverBudget: false,
    structuralEdits: false,
    representable: true,
    editCount: 1,
  }
  // The regression this pins: a CLOSURE-ACTIVE workbook used to answer from the
  // closure-only overlay, which is empty for it, so Save persisted the file's
  // stale cached <v> while the grid showed the recalculated value.
  assert.equal(saveFormulaLane(representable), 'sidecar', 'an editable workbook consults the sidecar')
  // formulaMode is deliberately absent from the decision: the lane keys on
  // representability, so the old `if (!formulaMode) overlay` gate cannot return.
  assert.equal(
    saveFormulaLane({ ...representable, formulaMode: true }),
    'sidecar',
    'a formulaMode workbook still takes the sidecar (the field is not consulted)',
  )
})

test('T17 every display-lane bail-out keeps the file cache instead of inventing a value', () => {
  const base = { engineOverBudget: false, structuralEdits: false, representable: true, editCount: 1 }
  assert.equal(saveFormulaLane({ ...base, engineOverBudget: true }), 'overlay', 'engine retired')
  assert.equal(saveFormulaLane({ ...base, structuralEdits: true }), 'overlay', 'coordinates shifted')
  assert.equal(saveFormulaLane({ ...base, representable: false }), 'overlay', 'not representable')
  assert.equal(saveFormulaLane({ ...base, editCount: 0 }), 'overlay', 'no edits to bind to')
})


test('T18 the sidecar busy rejection is recognised, and only that one', () => {
  // The F1 regression: a Save must WAIT for the serialized recalc slot when the
  // automatic display lane holds it, never fail the user's Ctrl+S. Waiting is
  // only safe if busy is recognised precisely, so a transport failure is not
  // retried as if it were a busy slot.
  assert.equal(
    isRecalcBusy(new Error('engine rejected "xlsx-recalc": Formula engine is busy with another recalculation.')),
    true,
    'the sidecar busy message is recognised',
  )
  assert.equal(isRecalcBusy(new Error('engine host is unreachable for "xlsx-recalc"')), false, 'a transport failure is not busy')
  assert.equal(isRecalcBusy(new Error('appSaveFailed')), false, 'an unrelated error is not busy')
  assert.equal(isRecalcBusy('busy with another recalculation'), false, 'a non-Error value is never treated as busy')
  assert.equal(isRecalcBusy(undefined), false, 'undefined is not busy')
})

test('T20 the lab channel code is not busy, and the wait stops at the deadline', () => {
  // The lab host delivers `engine_error`, not the English sidecar phrase, so a
  // busy slot fails at once on this host. The wait is not verified here.
  const lab = new Error('lab channel host:sheets-recalc failed: engine_error')
  assert.equal(isRecalcBusy(lab), false, 'the collapsed lab code is not the English phrase')
  assert.equal(retryBusySlot(lab, 1_000, 2_000), false, 'engine_error is not retried')
  const busy = new Error('Formula engine is busy with another recalculation.')
  assert.equal(retryBusySlot(busy, 1_000, 2_000), true, 'the English phrase retries before the deadline')
  assert.equal(retryBusySlot(busy, 2_000, 2_000), false, 'the deadline itself is not retried')
  assert.equal(retryBusySlot(busy, 2_001, 2_000), false, 'past the deadline is not retried')
})

test('T19 the save lane is keyed on representability, so a save-side busy wait cannot change the lane', () => {
  // The F1 fix changed WHEN the consult runs (waiting for the slot) but not
  // WHICH lane is chosen; this pins that the lane decision stays independent of
  // the new save-running/busy machinery.
  const base = { engineOverBudget: false, structuralEdits: false, representable: true, editCount: 1 }
  assert.equal(saveFormulaLane(base), 'sidecar')
  assert.equal(saveFormulaLane({ ...base, editCount: 0 }), 'overlay')
})