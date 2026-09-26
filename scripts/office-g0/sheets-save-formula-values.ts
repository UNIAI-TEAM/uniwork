/**
 * UNI-667: the formula values a Save must persist for its formula cells.
 *
 * Two lanes produce them. Closure mode installs live formulas and the native
 * sidecar's recalc overlay carries their results. formulaMode — a small
 * workbook fully loaded so Univer's own engine recalculates on screen —
 * persisted the file's stale cached <v> for those cells: the edit journal holds
 * the user's inputs only, never formula results, and the overlay lane is
 * closure-only. This module owns the pure half of the fix: turning the
 * sidecar's cells (or the overlay) into the save request's formula values,
 * batching the reads that bound a consultation, and fingerprinting the edits a
 * recalculation was bound to.
 *
 * Deliberately dependency-free. Its regression test loads this exact file, so
 * no collaborator stub can hide a behaviour change.
 */

/// One entry of the save request's formula values. `value` may be an error
/// literal, which the gateway writes as t="e".
export interface SaveFormulaValue {
  readonly sheetId: string
  readonly row: number
  readonly column: number
  readonly value: string | number | boolean | null | { error: string }
}

/// One cell of a sidecar recalculation response.
export interface RecalcFormulaCell {
  readonly sheetId: string
  readonly row: number
  readonly column: number
  readonly formatted: string
  readonly number?: number | undefined
  readonly isError?: boolean | undefined
  readonly isFormula: boolean
}

/// One overlay entry (structurally univer-state's PinnedClosureCell).
export interface OverlayFormulaCell {
  readonly v?: string | number | boolean | null | undefined
  readonly isError?: boolean | undefined
}

/// One fetchable band of formula cells.
export interface CellRange {
  readonly startRow: number
  readonly endRow: number
  readonly startColumn: number
  readonly endColumn: number
}

/// The journal facts a save-time recalculation is bound to.
export interface SaveEditFingerprintInput {
  readonly sheets: ReadonlyMap<
    string,
    ReadonlyMap<
      string,
      { readonly hasValue: boolean; readonly value: unknown; readonly formula?: string | undefined }
    >
  >
  readonly removedSheets: ReadonlySet<string>
  readonly addedSheets: ReadonlySet<string>
}

/// `row:column` (the overlay and recalc key) as numbers, or null when malformed.
export function splitCellKey(key: string): { row: number; column: number } | null {
  const separator = key.indexOf(':')
  if (separator <= 0 || separator === key.length - 1) return null
  const row = Number(key.slice(0, separator))
  const column = Number(key.slice(separator + 1))
  if (!Number.isInteger(row) || !Number.isInteger(column) || row < 0 || column < 0) return null
  return { row, column }
}

const compareKeys = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0)

/**
 * Identity of the workbook edits a recalculation consumed. The save compares it
 * across the sidecar call: an edit that lands mid-flight makes the answers
 * describe a revision the user never saw, which must not be written.
 */
export function saveEditRevision(input: SaveEditFingerprintInput): string {
  const parts: string[] = []
  for (const [sheetId, cells] of [...input.sheets].sort(([left], [right]) => compareKeys(left, right))) {
    if (input.removedSheets.has(sheetId)) continue
    const rendered: string[] = []
    for (const [key, entry] of [...cells].sort(([left], [right]) => compareKeys(left, right))) {
      if (!entry.hasValue && entry.formula === undefined) continue
      const formula = entry.formula === undefined ? '' : 'f:' + entry.formula
      const value = entry.hasValue ? 'v:' + String(entry.value) : ''
      rendered.push(key + '=' + formula + '|' + value)
    }
    if (rendered.length === 0) continue
    parts.push(sheetId + '#' + (input.addedSheets.has(sheetId) ? 'new' : 'file') + ':' + rendered.join(','))
  }
  return parts.join(';')
}

/**
 * Covers every band exactly once, in as few requests as the caps allow: at most
 * `maxRanges` ranges and `maxCells` cells per request. Every band is placed —
 * a band too large for one request on its own still gets one — so a save never
 * silently refreshes only the part of the workbook that fit the first request.
 */
export function batchCellRanges(
  bands: readonly CellRange[],
  maxRanges: number,
  maxCells: number,
): CellRange[][] {
  const batches: CellRange[][] = []
  let current: CellRange[] = []
  let usedCells = 0
  for (const band of bands) {
    const area = (band.endRow - band.startRow + 1) * (band.endColumn - band.startColumn + 1)
    if (current.length > 0 && (current.length >= maxRanges || usedCells + area > maxCells)) {
      batches.push(current)
      current = []
      usedCells = 0
    }
    current.push(band)
    usedCells += area
  }
  if (current.length > 0) batches.push(current)
  return batches
}

export interface OverlaySaveExclusions {
  readonly isSheetRemoved: (sheetId: string) => boolean
  /// true when the journal holds a formula for this cell, so the overlay may
  /// still carry the result of the formula the user just replaced.
  readonly hasJournaledFormula: (sheetId: string, key: string) => boolean
}

/// The closure lane's overlay as save formula values.
export function overlaySaveFormulaValues(
  overlay: ReadonlyMap<string, ReadonlyMap<string, OverlayFormulaCell>>,
  exclusions: OverlaySaveExclusions,
): SaveFormulaValue[] {
  const values: SaveFormulaValue[] = []
  for (const [sheetId, cells] of overlay) {
    if (exclusions.isSheetRemoved(sheetId)) continue
    for (const [key, cell] of cells) {
      // #ERROR! is IronCalc's own failure, never a value Excel would cache.
      if (cell.v === undefined || cell.v === '#ERROR!') continue
      if (exclusions.hasJournaledFormula(sheetId, key)) continue
      const coords = splitCellKey(key)
      if (coords === null) continue
      values.push({
        sheetId,
        row: coords.row,
        column: coords.column,
        value: cell.isError && typeof cell.v === 'string' ? { error: cell.v } : cell.v,
      })
    }
  }
  return values
}

export interface RecalcSaveContext {
  /// The save's own edit count, so a blank or error result is no longer read as
  /// a capability gap once the inputs actually changed.
  readonly hasEdits: boolean
  readonly isSheetRemoved: (sheetId: string) => boolean
  readonly formulaTextAt: (sheetId: string, key: string) => string | undefined
  readonly cachedAt: (sheetId: string, key: string) => string | number | boolean | null | undefined
  /// univer-sync's recalcResultKeepsCache: the locale / #NAME? / #ERROR! policy
  /// that keeps the file's own cached result authoritative.
  readonly keepsCache: (
    formatted: string,
    formulaText: string | undefined,
    cached: string | number | boolean | null | undefined,
    hasEdits: boolean,
  ) => boolean
}

export interface RecalcSaveOutcome {
  readonly values: SaveFormulaValue[]
  /// Cells the sidecar answered but whose file cache stays authoritative.
  readonly keptCache: number
}

/**
 * A sidecar recalculation response as save formula values. The response was
 * produced from this save's own edits, so a journaled formula cell's answer
 * describes the formula being written and is deliberately NOT excluded — only
 * the closure lane's overlay needs that exclusion, because it may predate a
 * replacement the user just typed.
 */
export function recalcSaveFormulaValues(
  cells: readonly RecalcFormulaCell[],
  context: RecalcSaveContext,
): RecalcSaveOutcome {
  const values: SaveFormulaValue[] = []
  let keptCache = 0
  for (const cell of cells) {
    // Only a formula cell carries a cache to refresh; a literal the user typed
    // rides the ordinary edit journal.
    if (!cell.isFormula) continue
    if (context.isSheetRemoved(cell.sheetId)) continue
    const key = cell.row + ':' + cell.column
    const keeps = context.keepsCache(
      cell.formatted,
      context.formulaTextAt(cell.sheetId, key),
      context.cachedAt(cell.sheetId, key),
      context.hasEdits,
    )
    if (keeps) {
      keptCache += 1
      continue
    }
    const value = cell.number ?? cell.formatted
    if (value === '#ERROR!') {
      keptCache += 1
      continue
    }
    values.push({
      sheetId: cell.sheetId,
      row: cell.row,
      column: cell.column,
      value: cell.isError && typeof value === 'string' ? { error: value } : value,
    })
  }
  return { values, keptCache }
}

/**
 * Which lane answers one Save's formula values.
 *
 * UNI-667: the lane is NOT a question about `formulaMode`. A closure-active
 * workbook displays the engine's live values, but the overlay is
 * closure-only and stays empty for it, so answering "overlay" persisted the
 * file's stale cached <v> while the grid showed the recalculated result.
 * The sidecar consult is revision-bound and fail-closed, so every workbook the
 * file-backed engine can represent consults it. The bail-outs below keep the
 * file cache, mirroring what the display lane had on screen, rather than
 * inventing a value the user never saw. A structural edit is the one case
 * where the display lane's bail-out and the persisted bytes can still diverge
 * for a formulaMode workbook; that gap is upstream of this fix and is recorded,
 * not silently claimed closed.
 */
export type SaveFormulaLane = 'overlay' | 'sidecar'

export interface SaveFormulaLaneInput {
  /// a truncated formula index retires the engine for the session
  readonly engineOverBudget: boolean
  /// structural edits shift every coordinate the file-backed engine reads
  readonly structuralEdits: boolean
  /// false when the workbook cannot be represented by the file-backed engine
  /// at all (a sheet added this session, or more edits than the request cap)
  readonly representable: boolean
  readonly editCount: number
}

/**
 * Which lane answers one Save's formula values.
 *
 * UNI-667: this is deliberately NOT a question about `formulaMode`. A
 * closure-active workbook DISPLAYS the engine's live values, but the recalc
 * overlay is closure-only and stays empty for it, so answering "overlay"
 * persisted the file's stale cached <v> while the grid showed the
 * recalculated result. The sidecar consult is revision-bound and fail-closed,
 * so every workbook the file-backed engine can represent consults it. The
 * bail-outs below keep the file cache, mirroring what the display lane had on
 * screen, rather than inventing a value the user never saw. A structural edit
 * is the one case where the display lane's bail-out and the persisted bytes can
 * still diverge for a formulaMode workbook; that gap is upstream of this fix
 * and is recorded, not silently claimed closed.
 */
export function saveFormulaLane(input: SaveFormulaLaneInput): SaveFormulaLane {
  if (input.engineOverBudget) return 'overlay'
  if (input.structuralEdits) return 'overlay'
  if (!input.representable) return 'overlay'
  if (input.editCount === 0) return 'overlay'
  return 'sidecar'
}

/**
 * UNI-667: is this rejection the sidecar telling us its (serialized) recalc slot
 * is already held? The native engine answers a concurrent recalculation with
 * `recalc_busy` / "Formula engine is busy with another recalculation." Since
 * DOC-003 r2 the lab transport keeps the server message beside the code
 * (`lab channel host:sheets-recalc failed: engine_error: engine rejected ...`),
 * as the desktop IPC does, so the phrase reaches this predicate on the lab host
 * too. It matches only when that English phrase is actually on
 * `Error.message`. Any other error, including the lab channel code, is a real
 * failure and must not be retried as a busy signal.
 */
export function isRecalcBusy(error: unknown): boolean {
  return (
    error instanceof Error && error.message.includes('busy with another recalculation')
  )
}

/**
 * UNI-667: retry a save consult only while the error carries the English
 * sidecar busy phrase and the deadline has not been reached. A lab refusal that
 * carries only a code, or any other engine message, returns false and the
 * caller surfaces the error at once. A reached deadline also returns false, so the loop cannot
 * hang.
 */
export function retryBusySlot(error: unknown, now: number, deadline: number): boolean {
  return isRecalcBusy(error) && now < deadline
}