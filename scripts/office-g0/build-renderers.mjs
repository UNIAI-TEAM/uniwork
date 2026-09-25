#!/usr/bin/env node
// DOC-003 (UNI-667) renderer rebuild: explicit host injection for the six browser
// editors.
//
// The prepared GenOffice preview reads its Electron preload objects off the window
// object. This script produces a browser build of each renderer whose host is an
// explicit imported module instead, so no preload global is assigned, no Proxy
// answers null for an unknown method, and the Electron preload never enters the
// browser bundle.
//
// Safety model
// ------------
// * The prepared source is READ ONLY. Every edit lands in a separate managed copy
//   under the lab root; the source closure is hashed before and after and the script
//   fails if a single byte changed.
// * The managed copy carries a marker; an existing directory without that marker is
//   never touched, and replacing it requires an explicit --replace.
// * Only the copy's own renderer files and the per-app lab vite config are written,
//   so the upstream edits are scoped and traceable (recorded in the manifest).
// * The Electron CSP meta in each index.html stays in place. The injected bootstrap
//   is same-origin, so `script-src 'self'` and `connect-src 'self'` still apply and
//   the lab talks to /lab on its own origin. Nothing here strips an editor CSP.
// * The bootstrap module opens the session, installs the host and only then
//   dynamically imports the app entry, so "host before app" is a runtime property.
//
// Usage (run from the repository root):
//   node scripts/office-g0/build-renderers.mjs --source <prepared source>
//   node scripts/office-g0/build-renderers.mjs --source <dir> --dry-run
//   node scripts/office-g0/build-renderers.mjs --source <dir> --replace --apps docs,pdf
//   node scripts/office-g0/build-renderers.mjs --print-surface

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// The parser is the root workspace's own dependency (package.json devDependencies:
// "typescript": "catalog:"), imported normally so resolution, version pinning and
// lockfile provenance stay the package manager's job. It is injected into the pure
// transform; the transform module itself never resolves a module.
import typescript from 'typescript';
import { MARKDOWN_MANAGED_PATCHES } from './markdown-managed-patches.mjs';
import {
  HOST_RUNTIME_ALIAS,
  transformSource,
  assertNoHostGlobals,
  assertNoBracketGlobals,
  emittedHostGlobalSurvivors,
} from '../../e2e/office-g0/source-transform.mjs';
import { HOST_SURFACE, PINNED_SOURCE_COMMIT, globalsForApp } from '../../e2e/office-g0/host-surface.mjs';

export const APPS = ['docs', 'markdown', 'html', 'pdf', 'sheets', 'slides'];
export const MANAGED_MARKER = 'lab-managed-copy.json';
export const MANIFEST_NAME = 'host-build-manifest.json';
export const COPY_DIR_NAME = 'host-build-source';
export const BOOTSTRAP_FILE = 'lab-host-bootstrap.ts';
export const VITE_CONFIG_FILE = 'vite.lab-host.config.ts';
export const SKIP_DIRS = new Set(['node_modules', '.git', 'target', 'dist', 'out', 'renderer-builds']);

/** Strings that prove an Electron preload leaked into the browser bundle. */
export const PRELOAD_FORBIDDEN = [
  'contextBridge',
  'ipcRenderer',
  "from 'electron'",
  'from "electron"',
  "require('electron')",
  'require("electron")',
];

/** Assignments that would rebuild the rejected global-mock bridge. */
export const GLOBAL_MOCK_PATTERN = /window\s*\.\s*(desktop|desktopApi|markdownApi|htmlApi|pdfApi|slidesApi|projectApi|filesPaneApi)\s*=/;

/**
 * Reproducible renderer customization, applied to the managed copy only.
 *
 * The pinned upstream localImage.ts resolves a relative image to md-asset://,
 * which the app CSP blocks in the browser. These exact-string patches map that
 * one relative branch onto the same-origin lab asset route, and reverse the route
 * on DOM parse so the serialized Markdown keeps `assets/dot.png`. Each anchor must
 * appear exactly once; a missing or duplicated anchor is a hard failure, never a
 * silent skip, so the customization cannot drift unnoticed.
 */
export const MANAGED_PATCHES = {
  markdown: [
    ...MARKDOWN_MANAGED_PATCHES,
    {
      path: 'apps/markdown/src/renderer/editor/localImage.ts',
      find:
        "  if (!baseDir) return src\n" +
        "  return toAssetUrl(`${baseDir.replace(/\\\\/g, '/').replace(/\\/$/, '')}/${src}`)\n",
      replace:
        "  if (!baseDir) return src\n" +
        "  const labViewId = __labHost('markdownApi').assetViewId()\n" +
        "  if (typeof labViewId === 'string' && labViewId.length > 0) {\n" +
        "    const relative = src.replace(/\\\\/g, '/').replace(/^\\.?\\//, '')\n" +
        "    return `/lab/asset/${encodeURIComponent(labViewId)}/${relative.split('/').map(encodeSegment).join('/')}`\n" +
        "  }\n" +
        "  return toAssetUrl(`${baseDir.replace(/\\\\/g, '/').replace(/\\/$/, '')}/${src}`)\n",
    },
    {
      path: 'apps/markdown/src/renderer/editor/localImage.ts',
      find: "  if (!src.startsWith('md-asset://')) return src\n",
      replace:
        "  if (src.startsWith('/lab/asset/')) {\n" +
        "    const rest = src.slice('/lab/asset/'.length)\n" +
        "    const slash = rest.indexOf('/')\n" +
        "    return slash === -1 ? src : decodeURIComponent(rest.slice(slash + 1))\n" +
        "  }\n" +
        "  if (!src.startsWith('md-asset://')) return src\n",
    },
  ],
  sheets: [
    // UNI-667: persist the formulaMode lane's recalculated formula values
    // through the normal Save path. Created module: sheets-save-formula-values.ts
    // (dependency-free, loaded directly by its regression test).
    {
      path: "apps/sheets/src/renderer/save-actions.ts",
      find: "import {\n  collectCfStates,\n  getScrollAnchor,\n  collectDefinedNamesState,\n  collectDvStates,\n  collectFilterStates,\n  collectNoteStates,\n} from './univer-sync'",
      replace: "import {\n  collectCfStates,\n  getScrollAnchor,\n  collectDefinedNamesState,\n  collectDvStates,\n  collectFilterStates,\n  collectNoteStates,\n  collectSaveFormulaValues,\n} from './univer-sync'\nimport { overlaySaveFormulaValues, type SaveFormulaValue } from './save-formula-values'",
    },
    {
      path: "apps/sheets/src/renderer/univer-sync.ts",
      find: "\n/// After horizontal scrolling the viewport range no longer covers frozen\n/// columns; fetch that strip separately (patched without eviction).\nasync function loadFrozenColumnStrip(",
      replace: "\n/// UNI-667: the formula values a Save must persist, bound to that save's edits.\n///\n/// Two lanes produce persisted formula caches. Closure mode installs live\n/// formulas and the IronCalc overlay carries their results (converted by\n/// overlaySaveFormulaValues). formulaMode — a small workbook fully handed to\n/// Univer's own engine — had no overlay at all: queueFormulaRecalc refuses that\n/// lane, so Save wrote the file's stale cached <v> beside a correct <f>. Ask the\n/// native sidecar for the current inputs instead, and never write an answer\n/// that describes a different revision.\nexport type SaveFormulaCollection =\n  | { readonly ok: true; readonly values: SaveFormulaValue[] }\n  | { readonly ok: false; readonly reason: string }\n\n/// UNI-667: the sidecar serializes recalculation and rejects a concurrent\n/// request as busy. A Save must not fail merely because the automatic display\n/// lane holds that slot, so wait for it — bounded, so a sidecar that never\n/// frees the slot still surfaces a real failure instead of hanging the Save.\nconst SAVE_RECALC_SLOT_WAIT_MS = 6000\nconst SAVE_RECALC_SLOT_POLL_MS = 250\n\nasync function recalcWorkbookAwaitingSlot(\n  run: () => Promise<WorkbookRecalcResult>,\n): Promise<WorkbookRecalcResult> {\n  const deadline = Date.now() + SAVE_RECALC_SLOT_WAIT_MS\n  for (;;) {\n    try {\n      return await run()\n    } catch (error: unknown) {\n      if (!retryBusySlot(error, Date.now(), deadline)) throw error\n      await new Promise((resolve) => setTimeout(resolve, SAVE_RECALC_SLOT_POLL_MS))\n    }\n  }\n}\n\n/// The request caps: reads per recalc request and cells per request. A save\n/// covers EVERY band by batching, unlike the viewport-windowed display lane.\nconst MAX_RECALC_READS = 200\n\n/// This save's journaled inputs, or null when the workbook cannot be\n/// represented by the file-backed engine (mirrors runFormulaRecalc).\nexport function recalcEditsForSave(\n  state: LazyWorkbookState,\n): { sheetId: string; row: number; column: number; input: string }[] | null {\n  const edits: { sheetId: string; row: number; column: number; input: string }[] = []\n  for (const [editSheetId, entries] of state.editJournal.cells) {\n    if (isSheetRemoved(state.editJournal, editSheetId)) continue\n    if (state.editJournal.sheets.added.has(editSheetId)) return null\n    for (const entry of entries.values()) {\n      if (!entry.hasValue && !entry.formula) continue\n      if (edits.length >= RECALC_MAX_EDITS) return null\n      edits.push({\n        sheetId: editSheetId,\n        row: entry.row,\n        column: entry.column,\n        input: toRecalcUserInput(entry),\n      })\n    }\n  }\n  return edits\n}\n\n/// The journal facts a save-time recalculation is bound to.\nexport function saveFormulaRevision(state: LazyWorkbookState): string {\n  return saveEditRevision({\n    sheets: state.editJournal.cells,\n    removedSheets: new Set(state.editJournal.sheets.removed),\n    addedSheets: new Set(state.editJournal.sheets.added.keys()),\n  })\n}\n\n/// The formula values for one Save. Closure mode answers from the overlay; the\n/// formulaMode lane asks the native sidecar, and a failed or superseded\n/// consultation is REPORTED so the caller keeps its dirty edits and surfaces\n/// the failure instead of persisting a stale cache. A busy sidecar is WAITED\n/// for, not reported: the display lane legitimately holds that slot while the\n/// user presses Save, and refusing there would abort an ordinary Ctrl+S.\nexport async function collectSaveFormulaValues(\n  state: LazyWorkbookState,\n): Promise<SaveFormulaCollection> {\n  const overlayCellValues = overlaySaveFormulaValues(state.recalc.overlay, {\n    isSheetRemoved: (sheetId) => isSheetRemoved(state.editJournal, sheetId),\n    hasJournaledFormula: (sheetId, key) =>\n      state.editJournal.cells.get(sheetId)?.get(key)?.formula !== undefined,\n  })\n  if (!state.formulaMode) return { ok: true, values: overlayCellValues }\n  // A workbook past the open-time size budget never consulted the sidecar for\n  // display either; its file cache stands for the session, exactly as the\n  // display lane already decided.\n  if (state.recalc.engineOverBudget) return { ok: true, values: overlayCellValues }\n  // Structural edits shift every coordinate the file-backed engine reads.\n  if ([...state.editJournal.structuralOps.values()].some((ops) => ops.length > 0)) {\n    return { ok: true, values: overlayCellValues }\n  }\n  const edits = recalcEditsForSave(state)\n  if (edits === null || edits.length === 0) return { ok: true, values: overlayCellValues }\n  if (state.recalc.saveRunning) {\n    return { ok: false, reason: t('appSaveFailed') + ' (save already in progress)' }\n  }\n  const revision = saveFormulaRevision(state)\n  state.recalc.saveRunning = true\n  const values: SaveFormulaValue[] = []\n  try {\n    for (const sheet of state.file.sheets) {\n      if (isSheetRemoved(state.editJournal, sheet.id)) continue\n      if (state.editJournal.sheets.added.has(sheet.id)) continue\n      const keys = await recalcFormulaCellKeys(state, sheet.id)\n      // An incomplete or truncated index cannot name every cell this save must\n      // refresh; that sheet keeps its own cache, as it does on screen.\n      if (keys === null || keys.size === 0) continue\n      for (const batch of batchCellRanges(\n        closureFetchRanges(keys),\n        MAX_RECALC_READS,\n        RECALC_READ_BUDGET,\n      )) {\n        const result = await recalcWorkbookAwaitingSlot(() =>\n          __labHost(\"desktopApi\").recalcWorkbook({\n            sessionId: state.file.sessionId,\n            edits,\n            reads: batch.map((range) => ({ sheetId: sheet.id, range })),\n          }),\n        )\n        values.push(\n          ...recalcSaveFormulaValues(result.cells, {\n            hasEdits: edits.length > 0,\n            isSheetRemoved: (sheetId) => isSheetRemoved(state.editJournal, sheetId),\n            formulaTextAt: (sheetId, key) => state.formulaText.get(sheetId)?.get(key),\n            cachedAt: (sheetId, key) => state.cachedFormulaValues.get(sheetId)?.get(key),\n            keepsCache: recalcResultKeepsCache,\n          }).values,\n        )\n      }\n    }\n    // An edit that landed while the sidecar evaluated makes these answers\n    // describe a revision the user never saw; writing them would persist it.\n    if (saveFormulaRevision(state) !== revision) {\n      return { ok: false, reason: t('appSaveFailed') + ' (workbook changed during recalculation)' }\n    }\n    state.recalc.failures = 0\n    return { ok: true, values }\n  } catch (error: unknown) {\n    if (isRecalcBusy(error)) {\n      return { ok: false, reason: t('appSaveFailed') + ' (recalculation busy)' }\n    }\n    const message = error instanceof Error ? error.message : String(error)\n    return { ok: false, reason: message || t('appSaveFailed') }\n  } finally {\n    state.recalc.saveRunning = false\n  }\n}\n/// After horizontal scrolling the viewport range no longer covers frozen\n/// columns; fetch that strip separately (patched without eviction).\nasync function loadFrozenColumnStrip(",
    },
    {
      path: "apps/sheets/src/renderer/univer-sync.ts",
      find: "import { isManualCalculation } from './calc-options'\nimport { noteFormulaStreamChunk, requestFullRecalcAfterStream } from './formula-stream-hold'",
      replace: "import { isManualCalculation } from './calc-options'\nimport { noteFormulaStreamChunk, requestFullRecalcAfterStream } from './formula-stream-hold'\nimport {\n  batchCellRanges,\n  overlaySaveFormulaValues,\n  recalcSaveFormulaValues,\n  saveEditRevision,\n  type SaveFormulaValue,\n} from './save-formula-values'",
    },
    {
      path: "apps/sheets/src/renderer/save-actions.ts",
      find: "  // Recalculated formula results: the engine's values are on screen but\n  // deliberately kept out of the journal (they must not become literals). Send them\n  // separately so the save refreshes each formula cell's cached <v>, keeping its <f>.\n  // A journaled formula is excluded: the overlay may still hold the previous\n  // formula's result when the user saves immediately after entering a replacement.\n  const formulaValues = [...(state.recalc?.overlay ?? [])].flatMap(([sheetId, cells]) =>\n    isSheetRemoved(state.editJournal, sheetId)\n      ? []\n      : [...cells].flatMap(([key, cell]) => {\n          // #ERROR! is IronCalc's own failure, never a value Excel would cache.\n          if (cell.v === undefined || cell.v === '#ERROR!') return []\n          if (state.editJournal.cells.get(sheetId)?.get(key)?.formula !== undefined) return []\n          const [row, column] = key.split(':').map(Number)\n          if (row === undefined || column === undefined) return []\n          const value = cell.isError && typeof cell.v === 'string' ? { error: cell.v } : cell.v\n          return [{ sheetId, row, column, value }]\n        }),\n  )",
      replace: "  // Recalculated formula results: the engine's values are on screen but\n  // deliberately kept out of the journal (they must not become literals). Send\n  // them separately so the save refreshes each formula cell's cached <v>,\n  // keeping its <f>. The closure lane answers from its recalc overlay here; a\n  // formulaMode workbook has no overlay. A Save the file-backed engine can\n  // represent asks the native sidecar below, bound to THIS save's edits. A\n  // structural edit, an over-budget workbook, or an unrepresentable journal\n  // keeps the overlay and does not ask the sidecar (UNI-667).\n  let formulaValues: SaveFormulaValue[] = overlaySaveFormulaValues(state.recalc.overlay, {\n    isSheetRemoved: (sheetId) => isSheetRemoved(state.editJournal, sheetId),\n    hasJournaledFormula: (sheetId, key) =>\n      state.editJournal.cells.get(sheetId)?.get(key)?.formula !== undefined,\n  })",
    },
    {
      path: "apps/sheets/src/renderer/save-actions.ts",
      find: "    csvContent = serialized\n  }",
      replace: "    csvContent = serialized\n  }\n  // UNI-667: a normal xlsx Save refreshes every formula cell's cached value from\n  // the native sidecar. A failed or superseded consultation aborts the save and\n  // surfaces the reason: the dirty edits stay pending rather than a stale result\n  // being written as if it were current.\n  if (mode !== 'recovery' && csvContent === undefined) {\n    const collected = await collectSaveFormulaValues(state)\n    if (!collected.ok) {\n      ctx.setMessage(collected.reason)\n      if (!quiet) showToast(collected.reason, 'error')\n      return { ok: false }\n    }\n    formulaValues = collected.values\n  }",
    },
    // UNI-667: a torn-down workbook (unmount or workbook switch) must not keep
    // issuing reads for its retired engine session. closeWorkbook retires the
    // session at once, so a read still sleeping in a retry loop used to reach the
    // engine after the close, be refused no_session, and surface as a 502
    // transport failure. clearLazyState is the ONE teardown signal; it marks the
    // state closed so every repeated-read loop stops before re-issuing.
    {
      path: "apps/sheets/src/renderer/univer-state.ts",
      find: "  readonly flags: { preloadComplete: boolean; preloadRunning: boolean }",
      replace: "  readonly flags: { preloadComplete: boolean; preloadRunning: boolean; closed?: boolean }",
    },
    // UNI-667: a SAVE-side consult in flight. Distinct from `running`, which the
    // automatic display lane also owns: a Save must refuse only another Save,
    // never a display recalculation running alongside it.
    {
      path: "apps/sheets/src/renderer/univer-state.ts",
      find: "    running: boolean\n    lastRunAt: number\n",
      replace:
        "    running: boolean\n" +
        "    /// true while THIS save's own sidecar consult is in flight\n" +
        "    saveRunning?: boolean\n" +
        "    lastRunAt: number\n",
    },
    // The bounded save-side wait names the sidecar recalc result type so the
    // awaited value stays typed instead of widening to unknown.
    {
      path: "apps/sheets/src/renderer/univer-sync.ts",
      find: "  WorkbookRangeResult,\n  WorkbookRichRun,\n",
      replace: "  WorkbookRangeResult,\n  WorkbookRecalcResult,\n  WorkbookRichRun,\n",
    },
    // The lazy state literal must seed the new optional flag.
    {
      path: "apps/sheets/src/renderer/App.tsx",
      find: "        running: false,\n        lastRunAt: 0,\n",
      replace: "        running: false,\n        saveRunning: false,\n        lastRunAt: 0,\n",
    },
    {
      path: "apps/sheets/src/renderer/univer-sync.ts",
      find: "export function clearLazyState(state: LazyWorkbookState | null): void {\n  if (!state) return\n",
      replace: "export function clearLazyState(state: LazyWorkbookState | null): void {\n  if (!state) return\n  // UNI-667: teardown is the only signal the repeated-read loops get; a read\n  // still in flight past this point belongs to a session the engine retired.\n  state.flags.closed = true\n",
    },
    {
      path: "apps/sheets/src/renderer/univer-sync.ts",
      find: "          await new Promise((resolve) => setTimeout(resolve, 150))\n          guard += 1\n",
      replace: "          await new Promise((resolve) => setTimeout(resolve, 150))\n          // UNI-667: the workbook went away while this block slept; re-issuing\n          // would read a session the engine already retired.\n          // Truthiness, not `=== true`: an earlier check in this flow already narrowed\n          // the property, so the literal comparison is reported as dead.\n          if (state.flags.closed || lazyWorkbookRef.current !== state) return\n          guard += 1\n",
    },
    {
      path: "apps/sheets/src/renderer/univer-sync.ts",
      find: "    ) {\n      const endRow = Math.min(startRow + batchRows - 1, screenRange.endRow)\n",
      replace: "    ) {\n      if (state.flags.closed === true) break\n      const endRow = Math.min(startRow + batchRows - 1, screenRange.endRow)\n",
    },
    {
      path: "apps/sheets/src/renderer/univer-sync.ts",
      find: "  const deadline = Date.now() + 15_000\n  try {\n    for (;;) {\n",
      replace: "  const deadline = Date.now() + 15_000\n  try {\n    for (;;) {\n      if (state.flags.closed === true) return null\n",
    },
    // UNI-667 (round 2): round 1 guarded only the retry/sleep paths, so four read
    // sites still issued a read AFTER teardown; the engine refused no_session and
    // the lab surfaced it as a 502 transport failure. Every read the lazy loader
    // can issue now checks the same state.flags.closed teardown flag.
    {
      path: "apps/sheets/src/renderer/univer-sync.ts",
      find:
        "    if (!raw) {\n" +
        "      // Degenerate empty range (endRow < startRow): let the sidecar answer,\n",
      replace:
        "    if (!raw) {\n" +
        "      // UNI-667: the batcher broke on teardown, so this fallback read would\n" +
        "      // reach a session the engine already retired.\n" +
        "      if (state.flags.closed === true) return null\n" +
        "      // Degenerate empty range (endRow < startRow): let the sidecar answer,\n",
    },
    {
      path: "apps/sheets/src/renderer/univer-sync.ts",
      find:
        "  for (let startRow = fileRange.startRow; startRow <= fileRange.endRow; startRow += batchRows) {\n" +
        "    const endRow = Math.min(startRow + batchRows - 1, fileRange.endRow)\n",
      replace:
        "  if (state.flags.closed === true) return null\n" +
        "  for (let startRow = fileRange.startRow; startRow <= fileRange.endRow; startRow += batchRows) {\n" +
        "    // Truthiness, not `=== true`: the outer check above already narrowed\n" +
        "    // the property, so a second literal comparison reads as dead to tsc\n" +
        "    // even though teardown can land during the awaits below.\n" +
        "    if (state.flags.closed) break\n" +
        "    const endRow = Math.min(startRow + batchRows - 1, fileRange.endRow)\n",
    },
    {
      path: "apps/sheets/src/renderer/univer-sync.ts",
      find:
        "      let result\n" +
        "      try {\n" +
        '        result = await __labHost("desktopApi").readWorkbookRange({\n' +
        "          sessionId: state.file.sessionId,\n" +
        "          sheetId,\n" +
        "          range,\n" +
        "        })\n" +
        "        let guard = 0\n",
      replace:
        "      if (state.flags.closed === true) return\n" +
        "      let result\n" +
        "      try {\n" +
        '        result = await __labHost("desktopApi").readWorkbookRange({\n' +
        "          sessionId: state.file.sessionId,\n" +
        "          sheetId,\n" +
        "          range,\n" +
        "        })\n" +
        "        let guard = 0\n",
    },
    {
      path: "apps/sheets/src/renderer/univer-sync.ts",
      find:
        "    for (const range of closureFetchRanges(cells)) {\n" +
        "      let result\n",
      replace:
        "    for (const range of closureFetchRanges(cells)) {\n" +
        "      // UNI-667: the closure install awaits each band; a teardown landing\n" +
        "      // during the analysis must not reach the retired session.\n" +
        "      if (state.flags.closed === true) return\n" +
        "      let result\n",
    },
    {
      path: "apps/sheets/src/renderer/univer-sync.ts",
      find:
        "  if (!state.formulaMode) return { ok: true, values: overlayCellValues }\n" +
        "  // A workbook past the open-time size budget never consulted the sidecar for\n" +
        "  // display either; its file cache stands for the session, exactly as the\n" +
        "  // display lane already decided.\n" +
        "  if (state.recalc.engineOverBudget) return { ok: true, values: overlayCellValues }\n" +
        "  // Structural edits shift every coordinate the file-backed engine reads.\n" +
        "  if ([...state.editJournal.structuralOps.values()].some((ops) => ops.length > 0)) {\n" +
        "    return { ok: true, values: overlayCellValues }\n" +
        "  }\n" +
        "  const edits = recalcEditsForSave(state)\n" +
        "  if (edits === null || edits.length === 0) return { ok: true, values: overlayCellValues }\n" +
        "",
      replace:
        "  const edits = recalcEditsForSave(state)\n" +
        "  // UNI-667: the lane is decided by what the file-backed engine can REPRESENT,\n" +
        "  // never by `formulaMode`. A closure-active workbook displays the engine's live\n" +
        "  // values while the closure-only recalc overlay stays empty, so the old gate\n" +
        "  // persisted the file's stale cached <v> beside the correct <f>. The display\n" +
        "  // lane's own bail-outs still keep the file cache rather than inventing a value\n" +
        "  // nobody saw. A structural edit is the one case where that bail-out and the\n" +
        "  // persisted bytes can still diverge for a formulaMode workbook; that gap is\n" +
        "  // upstream of this fix and is recorded, not silently claimed closed.\n" +
        "  if (\n" +
        "    saveFormulaLane({\n" +
        "      engineOverBudget: state.recalc.engineOverBudget,\n" +
        "      structuralEdits: [...state.editJournal.structuralOps.values()].some(\n" +
        "        (ops) => ops.length > 0,\n" +
        "      ),\n" +
        "      representable: edits !== null,\n" +
        "      editCount: edits?.length ?? 0,\n" +
        "    }) === 'overlay'\n" +
        "  ) {\n" +
        "    return { ok: true, values: overlayCellValues }\n" +
        "  }\n" +
        "  // A null journal conversion is the condition the lane keyed on above;\n" +
        "  // the file cache stays authoritative there, as it does on screen.\n" +
        "  if (edits === null) return { ok: true, values: overlayCellValues }\n" +
        "",
    },
    {
      path: "apps/sheets/src/renderer/univer-sync.ts",
      find:
        "  batchCellRanges,\n" +
        "  overlaySaveFormulaValues,\n" +
        "  recalcSaveFormulaValues,\n" +
        "  saveEditRevision,\n" +
        "  type SaveFormulaValue,\n" +
        "",
      replace:
        "  batchCellRanges,\n" +
        "  overlaySaveFormulaValues,\n" +
        "  recalcSaveFormulaValues,\n" +
        "  isRecalcBusy,\n" +
        "  retryBusySlot,\n" +
        "  saveEditRevision,\n" +
        "  saveFormulaLane,\n" +
        "  type SaveFormulaValue,\n" +
        "",
    },
  ],
};

/** Applies one app's managed patches to the copy; returns the traceable records. */
export function applyManagedPatches(copyRoot, app) {
  const records = [];
  for (const patch of MANAGED_PATCHES[app] ?? []) {
    const abs = path.join(copyRoot, patch.path);
    const before = fs.readFileSync(abs, 'utf8');
    const index = before.indexOf(patch.find);
    if (index === -1) {
      throw new Error('managed patch anchor not found in ' + patch.path);
    }
    if (before.indexOf(patch.find, index + patch.find.length) !== -1) {
      throw new Error('managed patch anchor is not unique in ' + patch.path);
    }
    const after = before.slice(0, index) + patch.replace + before.slice(index + patch.find.length);
    if (after === before) throw new Error('managed patch made no change in ' + patch.path);
    // writeManagedFile breaks the hard link, so the prepared source can never change.
    writeManagedFile(abs, after);
    records.push({
      path: patch.path,
      anchor: patch.find,
      sha256Before: sha256Text(before),
      sha256After: sha256Text(after),
    });
  }
  return { records, edits: records.length };
}

/**
 * Renderer modules a managed patch needs to EXIST. They are written into the
 * copy before the transform, so the missing-host-global containment check
 * covers them exactly like an upstream module, and a file that already exists
 * is a hard failure rather than a silently reused stale copy.
 *
 * UNI-667: save-formula-values.ts is dependency-free, so its regression test
 * can load the real built source with no module stubs.
 */
export const MANAGED_CREATED_MODULES = {
  markdown: [
    { path: 'apps/markdown/src/renderer/markdown-source-buffer.ts', source: 'markdown-source-buffer.ts' },
  ],
  sheets: [
    {
      path: 'apps/sheets/src/renderer/save-formula-values.ts',
      source: 'sheets-save-formula-values.ts',
    },
  ],
};

/** Writes one app's created modules into the copy; returns traceable records. */
export function createManagedModules(copyRoot, app, sourceDir) {
  const records = [];
  for (const entry of MANAGED_CREATED_MODULES[app] ?? []) {
    const abs = path.join(copyRoot, entry.path);
    if (fs.existsSync(abs)) {
      throw new Error('created module already exists in the copy: ' + entry.path);
    }
    const from = path.join(sourceDir, entry.source);
    if (!fs.existsSync(from)) {
      throw new Error('created module source not found: ' + from);
    }
    const body = fs.readFileSync(from, 'utf8');
    writeManagedFile(abs, body);
    records.push({
      path: entry.path,
      source: entry.source,
      sha256: sha256Text(body),
    });
  }
  return { records, created: records.length };
}

export function parseArgs(argv) {
  const out = {
    source: null,
    out: null,
    lab: null,
    apps: [...APPS],
    dryRun: false,
    replace: false,
    skipBuild: false,
    printSurface: false,
    verbose: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--source') out.source = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--lab') out.lab = argv[++i];
    else if (a === '--apps') out.apps = String(argv[++i]).split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--replace') out.replace = true;
    else if (a === '--skip-build') out.skipBuild = true;
    else if (a === '--print-surface') out.printSurface = true;
    else if (a === '--verbose') out.verbose = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error('unknown argument: ' + a);
  }
  for (const app of out.apps) {
    if (!APPS.includes(app)) throw new Error('unknown app: ' + app);
  }
  return out;
}

const sha256File = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
export const sha256Text = (t) => crypto.createHash('sha256').update(t, 'utf8').digest('hex');
export const toPosix = (p) => p.split(path.sep).join('/');

/** Every file under a root, skipping generated/heavy directories, as posix-relative paths. */
export function listFiles(root) {
  const out = [];
  const walk = (rel) => {
    const abs = rel ? path.join(root, rel) : root;
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const childRel = rel ? rel + '/' + entry.name : entry.name;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(childRel);
      } else if (entry.isFile()) {
        out.push(childRel);
      }
    }
  };
  walk('');
  return out;
}

/** The source closure that the rewrite may touch: per-app src plus the shared packages. */
export function closureFiles(sourceRoot) {
  const roots = APPS.map((app) => path.join('apps', app, 'src')).concat(
    fs.existsSync(path.join(sourceRoot, 'packages'))
      ? fs.readdirSync(path.join(sourceRoot, 'packages'), { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => path.join('packages', e.name, 'src'))
      : [],
  );
  const files = [];
  for (const rel of roots) {
    if (!fs.existsSync(path.join(sourceRoot, rel))) continue;
    for (const file of listFiles(path.join(sourceRoot, rel))) files.push(toPosix(path.join(rel, file)));
  }
  return files.sort();
}

/** A single digest over (path, bytes) of the source closure, for before/after proof. */
export function hashClosure(sourceRoot) {
  const hash = crypto.createHash('sha256');
  const files = closureFiles(sourceRoot);
  for (const rel of files) {
    hash.update(rel);
    hash.update('\u0000');
    hash.update(fs.readFileSync(path.join(sourceRoot, rel)));
    hash.update('\u0000');
  }
  return { digest: hash.digest('hex'), files: files.length };
}

/**
 * Cheap freshness check of the application sources only (contents, no file walk
 * of packages). A change here means the closure digest above should be re-taken.
 */
export function hashAppSources(sourceRoot) {
  const hash = crypto.createHash('sha256');
  let count = 0;
  for (const app of APPS) {
    for (const rel of listFiles(path.join(sourceRoot, 'apps', app, 'src'))) {
      hash.update(rel);
      hash.update('\u0000');
      hash.update(fs.readFileSync(path.join(sourceRoot, 'apps', app, 'src', rel)));
      hash.update('\u0000');
      count += 1;
    }
  }
  return { digest: hash.digest('hex'), files: count };
}

/** Hard-link copy: the bytes are shared, so the copy is cheap and the source stays untouched. */
export function hardLinkTree(sourceRoot, destRoot) {
  const linked = [];
  for (const rel of listFiles(sourceRoot)) {
    const from = path.join(sourceRoot, rel);
    const to = path.join(destRoot, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.linkSync(from, to);
    linked.push(rel);
  }
  return linked;
}

/** Breaks the hard link before writing, so the prepared source can never be modified. */
export function writeManagedFile(destPath, text) {
  if (fs.existsSync(destPath)) fs.rmSync(destPath, { force: true });
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, text);
}

/** Links the prepared tree's installed dependencies into the copy. */
export function linkDependencies(sourceRoot, destRoot) {
  const linked = [];
  for (const rel of ['node_modules']) {
    const from = path.join(sourceRoot, rel);
    const to = path.join(destRoot, rel);
    if (!fs.existsSync(from)) continue;
    if (fs.existsSync(to)) fs.rmSync(to, { recursive: true, force: true });
    fs.symlinkSync(from, to, 'junction');
    linked.push({ path: rel, target: from });
  }
  return linked;
}

/** Refuses to touch a directory that is not one of ours. */
export function assertManagedCopy(copyDir, markerPath, { replace = false } = {}) {
  if (!fs.existsSync(copyDir)) return 'create';
  if (!fs.existsSync(markerPath)) {
    throw new Error(
      'refusing to write into ' + copyDir + ': it exists without a ' + MANAGED_MARKER + ' marker',
    );
  }
  if (!replace) {
    throw new Error('the managed copy already exists; pass --replace to rebuild it');
  }
  return 'replace';
}

/* --------------------------------------------------------------- transforms ---- */

const TRANSFORMABLE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

/** The renderer files to rewrite for one app, as posix paths relative to the copy root. */
export function collectAppFiles(copyRoot, app) {
  const rendererRel = toPosix(path.join('apps', app, 'src', 'renderer'));
  return listFiles(path.join(copyRoot, rendererRel)).map((rel) => toPosix(path.join(rendererRel, rel)));
}

/**
 * Rewrites every host read in one app's renderer tree inside the managed copy.
 * Returns the traceable per-file record for the manifest. Pure enough to test: it
 * only reads the copy and writes the same files back through writeManagedFile.
 */
export function transformApp(copyRoot, app) {
  const records = [];
  let edits = 0;
  const misses = [];
  for (const rel of collectAppFiles(copyRoot, app)) {
    if (!TRANSFORMABLE.test(rel)) continue;
    const abs = path.join(copyRoot, rel);
    const before = fs.readFileSync(abs, 'utf8');
    const result = transformSource(before, { app, relativePath: rel, typescript });
    misses.push(...result.misses.map((m) => ({ path: rel, ...m })));
    // Every module is checked, including one the transform did not have to edit: a
    // zero-edit file is exactly where an unrewritten host read would hide, and a
    // comment or a string that mentions a global is not a read.
    // A refused access is reported by the more specific miss error below.
    const explainedByMiss = new Set(result.misses.map((miss) => miss.global));
    const unexplainedSurvivors = result.survivors.filter((name) => !explainedByMiss.has(name));
    if (unexplainedSurvivors.length > 0) {
      throw new Error(
        rel + ' still reads ' + unexplainedSurvivors.join(', ') + ' directly after the rewrite',
      );
    }
    if (GLOBAL_MOCK_PATTERN.test(result.text)) {
      throw new Error(rel + ' would assign a host global; the lab host must stay imported');
    }
    writeManagedFile(abs, result.text);
    records.push({
      path: rel,
      edits: result.edits.length,
      globals: [...new Set(result.edits.map((e) => e.global))].sort(),
      sha256Before: sha256Text(before),
      sha256After: sha256Text(result.text),
    });
    edits += result.edits.length;
  }
  if (misses.length > 0) {
    throw new Error(
      'unrecognised window host reads: ' +
        misses.map((m) => m.path + ' -> ' + m.global + ' (' + m.reason + ')').join(', '),
    );
  }
  return { records, edits };
}

/**
 * Replaces the app entry script with the injected bootstrap. The bootstrap is
 * same-origin, so the existing CSP keeps applying; the CSP meta itself is never
 * removed and its absence is a hard failure.
 */
export function renderHtmlBootstrap(html) {
  if (!/<meta\s+http-equiv="Content-Security-Policy"/i.test(html)) {
    throw new Error('index.html has no Content-Security-Policy meta; refusing to strip or ignore it');
  }
  const entry = /<script\s+type="module"\s+src="(?:\.\/|\/)?main\.tsx"\s*><\/script>/i;
  if (!entry.test(html)) {
    throw new Error('index.html has no module script pointing at main.tsx');
  }
  const out = html.replace(entry, '<script type="module" src="./' + BOOTSTRAP_FILE + '"></script>');
  if (!out.includes('./' + BOOTSTRAP_FILE)) throw new Error('the bootstrap script tag was not injected');
  if (/main\.tsx/.test(out.replace(/\/\*[\s\S]*?\*\//g, ''))) {
    throw new Error('main.tsx is still referenced by index.html; the bootstrap must own the entry');
  }
  return out;
}

/** The bootstrap module the build injects ahead of the app entry. */
export function bootstrapSource(app) {
  return [
    '// DOC-003 lab entry (UNI-667): injected by scripts/office-g0/build-renderers.mjs.',
    '// The session is opened and the explicit host installed BEFORE the app entry is',
    '// imported, so no module-scope host read can observe a missing host.',
    "import { bootLabPage } from '@lab/host-runtime-bootstrap';",
    '',
    'void bootLabPage({',
    '  app: ' + JSON.stringify(app) + ',',
    "  fixture: new URLSearchParams(window.location.search).get('fixture'),",
    '  // A literal specifier: the bundler splits the app entry into its own chunk so',
    '  // it is evaluated only after the module above has installed the host.',
    "  load: () => import('./main.tsx'),",
    '}).catch((error) => {',
    '  // Fail loudly: an editor that mounts without a host would fake a passing save.',
    "  document.body.textContent =",
    "    'lab host bootstrap failed: ' + String(error && error.message ? error.message : error);",
    '  throw error;',
    '});',
    '',
  ].join('\n');
}

/** The per-app lab vite config: same renderer root, plus the injected host alias. */
export function viteConfigSource(app, { repoRoot, outDir }) {
  const aliasTarget = toPosix(path.join(repoRoot, 'e2e', 'office-g0', 'host-runtime.mjs'));
  const bootstrapTarget = toPosix(path.join(repoRoot, 'e2e', 'office-g0', 'page-bootstrap.mjs'));
  const plugins = ['react()'];
  const extraImports = [];
  const dedupe = app === 'markdown' ? TIPTAP_DEDUPE : [];
  if (app === 'pdf') {
    extraImports.push("import { createRequire } from 'node:module'");
    extraImports.push("import { dirname, join } from 'node:path'");
    extraImports.push("import { normalizePath } from 'vite'");
    extraImports.push("import { viteStaticCopy } from 'vite-plugin-static-copy'");
    plugins.push(
      'viteStaticCopy({ targets: [\n      { src: pdfjsDir(\'cmaps\'), dest: \'pdfjs\' },\n      { src: pdfjsDir(\'standard_fonts\'), dest: \'pdfjs\' },\n      { src: pdfjsDir(\'wasm\'), dest: \'pdfjs\' },\n    ] })',
    );
  }
  const lines = [
    '// DOC-003 lab renderer build config (generated by scripts/office-g0/build-renderers.mjs).',
    "import react from '@vitejs/plugin-react'",
    "import { defineConfig } from 'vite'",
    ...extraImports,
    '',
    'const LAB_HOST_RUNTIME = ' + JSON.stringify(aliasTarget),
    'const LAB_HOST_BOOTSTRAP = ' + JSON.stringify(bootstrapTarget),
    ...(app === 'pdf'
      ? [
          'const require = createRequire(import.meta.url)',
          'const pdfjsRoot = dirname(dirname(require.resolve(\'pdfjs-dist/package.json\')))',
          'const pdfjsDir = (sub) => normalizePath(join(pdfjsRoot, \'pdfjs-dist\', sub))',
        ]
      : []),
    ...(dedupe.length > 0
      ? ['const TIPTAP_DEDUPE = ' + JSON.stringify(dedupe, null, 2).replace(/\n/g, '\n') + '']
      : []),
    '',
    'export default defineConfig({',
    "  root: 'src/renderer',",
    "  base: './',",
    '  plugins: [' + plugins.join(', ') + '],',
    '  resolve: {',
    '    alias: {',
    "      '@lab/host-runtime': LAB_HOST_RUNTIME,",
    "      '@lab/host-runtime-bootstrap': LAB_HOST_BOOTSTRAP,",
    '    },',
    ...(dedupe.length > 0 ? ['    dedupe: TIPTAP_DEDUPE,'] : []),
    '  },',
    '  build: {',
    '    outDir: ' + JSON.stringify(toPosix(outDir)) + ',',
    '    emptyOutDir: true,',
    '    sourcemap: false,',
    '  },',
    '})',
    '',
  ];
  return lines.join('\n');
}

export const TIPTAP_DEDUPE = [
  '@tiptap/core',
  '@tiptap/pm',
  '@tiptap/react',
  '@tiptap/extensions',
  '@tiptap/extension-list',
  '@tiptap/extension-table',
  '@tiptap/extension-image',
  '@tiptap/suggestion',
  '@tiptap/markdown',
  '@tiptap/extension-highlight',
  '@tiptap/extension-code-block',
];

/** Scans built output text for a leaked Electron preload or a rebuilt global mock. */
export function verifyNoPreload(text, label, parser = typescript) {
  const problems = [];
  for (const needle of PRELOAD_FORBIDDEN) {
    if (text.includes(needle)) problems.push('contains ' + needle);
  }
  if (GLOBAL_MOCK_PATTERN.test(text)) problems.push('assigns a window host global');
  // A bundle is transpiled output, not source: it has lost the parser comments but the
  // AST of the emitted bytes is still available, so a string that merely mentions a
  // global is not a read and a cast bracket read is. The accessor check above stays a
  // dead-code retraction: a real bundle legitimately contains both the accessor and a
  // leaked read, which is exactly the case this scan must catch.
  const survivors = emittedHostGlobalSurvivors(parser, text, { fileName: label + '.js' });
  if (survivors.length > 0) {
    problems.push('still reads window host globals: ' + survivors.join(', '));
  }
  if (problems.length > 0) throw new Error(label + ': ' + problems.join('; '));
  return true;
}

/* -------------------------------------------------------------------- main ---- */

export function resolveWorkspaceRoot(repoRoot) {
  for (let dir = path.resolve(repoRoot); ; ) {
    if (fs.existsSync(path.join(dir, 'genoffice')) || fs.existsSync(path.join(dir, '.uniwork-dev'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(repoRoot, '..');
    dir = parent;
  }
}

export function defaultSource(repoRoot) {
  const workspace = resolveWorkspaceRoot(repoRoot);
  const candidates = [
    path.join(workspace, '.uniwork-dev', 'office-g0', 'bootstrap-source'),
    path.join(workspace, 'genoffice'),
  ];
  return candidates.find((c) => fs.existsSync(c)) ?? candidates[0];
}

export function defaultLabRoot(repoRoot) {
  return path.join(resolveWorkspaceRoot(repoRoot), '.uniwork-dev', 'office-g0');
}

function printSurface() {
  for (const app of APPS) {
    const globals = globalsForApp(app);
    const total = globals.reduce((n, g) => n + HOST_SURFACE[app][g].length, 0);
    console.log(app + ': ' + globals.map((g) => g + '(' + HOST_SURFACE[app][g].length + ')').join(' ') + ' total=' + total);
  }
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(2, 42).join('\n'));
    return 0;
  }
  if (args.printSurface) {
    printSurface();
    return 0;
  }
  const repoRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..');
  const sourceRoot = path.resolve(args.source ?? defaultSource(repoRoot));
  if (!fs.existsSync(sourceRoot)) throw new Error('prepared source not found: ' + sourceRoot);
  const labRoot = path.resolve(args.lab ?? defaultLabRoot(repoRoot));
  const copyRoot = path.join(labRoot, COPY_DIR_NAME);
  const outRoot = path.resolve(args.out ?? path.join(labRoot, 'host-builds'));
  const markerPath = path.join(copyRoot, MANAGED_MARKER);

  const before = hashClosure(sourceRoot);
  console.log(
    'source ' + sourceRoot + ' closure=' + before.files + ' files sha256=' + before.digest.slice(0, 16),
  );
  if (args.dryRun) {
    for (const app of args.apps) {
      const files = collectAppFiles(sourceRoot, app).filter((f) => TRANSFORMABLE.test(f));
      let edits = 0;
      let introducedDiagnostics = 0;
      for (const rel of files) {
        const text = fs.readFileSync(path.join(sourceRoot, rel), 'utf8');
        // transformSource parses with the injected TypeScript parser and throws if the
        // rewrite would add a parser diagnostic; report the per-file counts too.
        const result = transformSource(text, {
          app,
          relativePath: rel,
          typescript,
        });
        edits += result.edits.length;
        introducedDiagnostics += result.parseDiagnosticsAfter - result.parseDiagnosticsBefore;
      }
      console.log(
        '  ' + app + ': ' + files.length + ' modules, ' + edits + ' host reads to rewrite, ' +
          introducedDiagnostics + ' introduced parser diagnostics',
      );
    }
    return 0;
  }

  const mode = assertManagedCopy(copyRoot, markerPath, { replace: args.replace });
  if (mode === 'replace') fs.rmSync(copyRoot, { recursive: true, force: true });
  fs.mkdirSync(copyRoot, { recursive: true });
  hardLinkTree(sourceRoot, copyRoot);
  linkDependencies(sourceRoot, copyRoot);

  const manifest = {
    generator: 'scripts/office-g0/build-renderers.mjs',
    pinnedSourceCommit: PINNED_SOURCE_COMMIT,
    preparedSource: sourceRoot,
    sourceClosure: before,
    appSources: hashAppSources(sourceRoot),
    copyRoot,
    outRoot,
    managedMarker: MANAGED_MARKER,
    hostRuntimeAlias: HOST_RUNTIME_ALIAS,
    session: {
      viewId: 'minted by the lab server on POST /lab/lab:session-open; never by the page',
      carriedOn: 'every /lab/<channel> POST body as { viewId, ...payload }, written last',
    },
    apps: {},
  };
  fs.writeFileSync(
    markerPath,
    JSON.stringify(
      { managed: true, generator: manifest.generator, preparedSource: sourceRoot, pinnedSourceCommit: PINNED_SOURCE_COMMIT },
      null,
      2,
    ) + '\n',
  );

  for (const app of args.apps) {
    const rendererRel = toPosix(path.join('apps', app, 'src', 'renderer'));
    const rendererAbs = path.join(copyRoot, rendererRel);
    const indexPath = path.join(rendererAbs, 'index.html');
    const beforeHtml = fs.readFileSync(indexPath, 'utf8');
    // Created modules land first: the transform then covers them, and the
    // managed patches below were verified against this post-transform text.
    const created = createManagedModules(copyRoot, app, path.dirname(fileURLToPath(import.meta.url)))
    const transformed = transformApp(copyRoot, app);
    const patched = applyManagedPatches(copyRoot, app);
    const html = renderHtmlBootstrap(beforeHtml);
    writeManagedFile(indexPath, html);
    writeManagedFile(path.join(rendererAbs, BOOTSTRAP_FILE), bootstrapSource(app));
    const outDir = path.join(outRoot, app);
    writeManagedFile(
      path.join(copyRoot, 'apps', app, VITE_CONFIG_FILE),
      viteConfigSource(app, { repoRoot, outDir }),
    );
    manifest.apps[app] = {
      rendererDir: rendererRel,
      files: transformed.records,
      edits: transformed.edits,
      createdModules: created.records,
      managedPatches: patched.records,
      indexHtml: {
        path: toPosix(path.join(rendererRel, 'index.html')),
        edits: ['main.tsx entry replaced by ' + BOOTSTRAP_FILE],
        cspRetained: /<meta\s+http-equiv="Content-Security-Policy"/i.test(html),
        sha256Before: sha256Text(beforeHtml),
        sha256After: sha256Text(html),
      },
      bootstrap: { path: toPosix(path.join(rendererRel, BOOTSTRAP_FILE)), file: BOOTSTRAP_FILE },
      viteConfig: toPosix(path.join('apps', app, VITE_CONFIG_FILE)),
      outDir: toPosix(outDir),
    };
    console.log('  ' + app + ': ' + transformed.records.length + ' modules rewritten, ' + transformed.edits + ' host reads');
  }

  const after = hashClosure(sourceRoot);
  manifest.sourceClosureAfter = after;
  manifest.appSourcesAfter = hashAppSources(sourceRoot);
  manifest.appSourcesUntouched = manifest.appSourcesAfter.digest === manifest.appSources.digest;
  manifest.sourceUntouched = after.digest === before.digest;
  if (!manifest.sourceUntouched) {
    throw new Error('the prepared source changed during the build: ' + before.digest + ' -> ' + after.digest);
  }

  if (!args.skipBuild) {
    const viteBin = path.join(sourceRoot, 'node_modules', 'vite', 'bin', 'vite.js');
    if (!fs.existsSync(viteBin)) throw new Error('vite is not installed in the prepared source: ' + viteBin);
    for (const app of args.apps) {
      const cwd = path.join(copyRoot, 'apps', app);
      execFileSync(process.execPath, [viteBin, 'build', '--config', VITE_CONFIG_FILE], {
        cwd,
        stdio: args.verbose ? 'inherit' : 'pipe',
      });
      const bundleDir = path.join(outRoot, app, 'assets');
      if (fs.existsSync(bundleDir)) {
        for (const file of fs.readdirSync(bundleDir)) {
          if (!/\.(js|mjs)$/.test(file)) continue;
          verifyNoPreload(fs.readFileSync(path.join(bundleDir, file), 'utf8'), app + '/' + file);
        }
      }
      console.log('  built ' + app + ' -> ' + path.join(outRoot, app));
    }
  }

  const manifestPath = path.join(outRoot, MANIFEST_NAME);
  fs.mkdirSync(outRoot, { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log('manifest ' + manifestPath);
  return 0;
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error('build-renderers: ' + (error && error.message ? error.message : error));
      process.exitCode = 1;
    },
  );
}
