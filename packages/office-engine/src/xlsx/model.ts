// XLSX session model — the editable workbook state an open() produces.
//
// The model owns a pending-edit plan plus the post-edit formula map: every
// cell that will carry <f> after the pending edits apply. Save plans a single
// assemble pass (cell edits + refreshed cached formula values) — never the
// input bytes with a success claim, and never a formula replaced by its
// displayed value.
import { XlsxEngineError, type XlsxCellEdit, type XlsxCellState, type XlsxRecalcEdit, type XlsxWorkbookSnapshot } from "./engine.ts";
import type { XlsxSharedFollowers } from "./shared-formulas.ts";
import {
  a1ToRowColumn,
  groupXlsxFilterStates,
  groupXlsxStructuralOps,
  isXlsxFilterOp,
  isXlsxSheetOp,
  isXlsxStructuralOp,
  toA1,
  type XlsxEditOp,
  type XlsxFilterOp,
  type XlsxSheetFilterState,
  type XlsxSheetOp,
  type XlsxSheetResolver,
  type XlsxSheetStructuralOps,
  type XlsxStructuralOp,
  groupXlsxHyperlinkEdits,
  groupXlsxNoteStates,
  isXlsxHyperlinkOp,
  isXlsxNotesOp,
  type XlsxHyperlinkOp,
  type XlsxSheetHyperlinkEdits,
  type XlsxNotesOp,
  type XlsxSheetNote,
  type XlsxSheetNoteState,
} from "./ops.ts";
import { groupXlsxPageSetupStates, isXlsxPageSetupOp, type XlsxPageSetupFields, type XlsxPageSetupOp, type XlsxSheetPageSetupState } from "./page-setup.ts";
import { groupXlsxTableAdditions, isXlsxTableOp, type XlsxTableAddOp } from "./tables.ts";
import { foldXlsxVisualOp, groupXlsxVisualAdditions, isXlsxVisualOp, shiftXlsxVisualEntries, type XlsxSheetVisualAddition, type XlsxVisualEntry } from "./ops-visuals.ts";
import { groupXlsxSheetProtectionStates, isXlsxSheetProtectionOp, type XlsxSheetProtectionOp, type XlsxSheetProtectionState } from "./ops-protection.ts";
import { groupXlsxDefinedNamesState, isXlsxDefinedNamesOp, type XlsxDefinedNamesOp, type XlsxDefinedNamesState } from "./ops-names.ts";
import {
  isXlsxRuleSetOp,
  pendingConditionalFormatStates,
  pendingDataValidationStates,
  withRuleSetOp,
  withoutRuleSetFamily,
  type XlsxRuleSetEntry,
  type XlsxSheetConditionalFormatState,
  type XlsxSheetDataValidationState,
} from "./ops-cf-dv.ts";

import { overlayCells, type ModelCheckpoint, type ModelSheetState, type PendingCell, type RemovedSheetState, type XlsxSheetEditPlan } from "./model-state.ts";
import { XlsxSheetOps } from "./model-sheet-ops.ts";

// The two names the package publishes from the session-model state module.
export type { ModelCheckpoint, XlsxSheetEditPlan } from "./model-state.ts";

/** The FIX-926-D sheet-op module, bound to this model instance. */
function sheetOpsFor(model: XlsxSessionModel): XlsxSheetOps {
  return new XlsxSheetOps({
    get sheetStates() { return model.sheetStates; },
    set sheetStates(value) { model.sheetStates = value; },
    removedStates: model.removedStates,
    removedOriginals: model.removedOriginals,
    get pending() { return model.pending; },
    set pending(value) { model.pending = value; },
    structural: model.structural,
    filters: model.filters,
    pageSetups: model.pageSetups,
    get tables() { return model.tables; },
    set tables(value) { model.tables = value; },
    get visuals() { return model.visuals; },
    set visuals(value) { model.visuals = value; },
    sheetProtections: model.sheetProtections,
    hyperlinks: model.hyperlinks,
    notes: model.notes,
    ruleSets: model.ruleSets,
    get sheetOrderChanged() { return model.sheetOrderChanged; },
    set sheetOrderChanged(value) { model.sheetOrderChanged = value; },
    get sheetOpsApplied() { return model.sheetOpsApplied; },
    set sheetOpsApplied(value) { model.sheetOpsApplied = value; },
    get addedSheetSequence() { return model.addedSheetSequence; },
    set addedSheetSequence(value) { model.addedSheetSequence = value; },
    get touched() { return model.touched; },
    set touched(value) { model.touched = value; },
    get revision() { return model.revision; },
    set revision(value) { model.revision = value; },
  });
}
export class XlsxSessionModel {
  /** The engine's parse result — sheets read through `cells()` reflect edits. */
  snapshot: XlsxWorkbookSnapshot;
  /** sha256 of the workbook bytes this model was opened from — the save path
   *  re-verifies it before any mutation is attempted. */
  inputSha256: string;
  /** Bumped on every successful rebase — one term of the session binding. */
  modelRevision = 0;
  pending = new Map<string, PendingCell>();
  /** Structural journal: row/column ops per sheet, in replay order. Cell
   *  entries above are kept in post-operation coordinates (the renderer's
   *  journal applies every shift to its own entries the same way), so the
   *  gateway replays this list first and then writes the cell edits. The map
   *  key is the sheet's CURRENT name; a rename rewrites both. */
  structural = new Map<string, XlsxStructuralOp[]>();
  /** Declarative filter journal: the LAST filter op per sheet, in first-touch
   *  order. A filter snapshot is whole-sheet, so only the last one matters
   *  (the gateway applies filterStates after structural replay and cell
   *  edits). The map key is the sheet's CURRENT name; a rename rewrites it. */
  filters = new Map<string, XlsxFilterOp>();
  /** Declarative page-setup journal: the LAST page-setup op per sheet, in
   *  first-touch order (whole-sheet, like filters). The map key is the
   *  sheet's CURRENT name; a rename rewrites it. */
  pageSetups = new Map<string, XlsxPageSetupOp>();
  /** Table additions (B9): a list, not a per-sheet snapshot. Each op pins
   *  final coordinates at emission time; remove_table drops a pending add.
   *  The key is the sheet's CURRENT name; a rename rewrites it, a removal
   *  drops the sheet's tables (nothing may reach a deleted part). */
  tables: XlsxTableAddOp[] = [];
  /** Visual additions (B8): charts, pictures and shapes inserted this session,
   *  in first-insert order; a set_visual with a pending id replaces it in
   *  place, remove_visual drops it. Keyed by CURRENT sheet name like tables.
   *  `file_visual` entries (UNI-953) are moves/deletes of visuals already in
   *  the file, addressed by drawing index; they feed visualEdits. */
  visuals: XlsxVisualEntry[] = [];
  /** Declarative sheet-protection journal: the LAST protection op per sheet,
   *  in first-touch order (whole-sheet, like filters). Keyed by CURRENT name. */
  sheetProtections = new Map<string, XlsxSheetProtectionOp>();
  /** Declarative workbook-scoped defined-names journal: the LAST snapshot in
   *  emission order (workbook.xml <definedNames> is rewritten wholesale). */
  private definedNames: XlsxDefinedNamesOp | undefined;
  /** Declarative hyperlink journal: per-cell last-write-wins links per sheet
   *  (a null target removes the link). The map key is the sheet's CURRENT
   *  name; a rename rewrites it. */
  hyperlinks = new Map<string, Map<string, XlsxHyperlinkOp>>();
  /** Declarative note journal: the LAST whole-sheet note snapshot per sheet,
   *  in first-touch order (like filters). The map key is the sheet's CURRENT
   *  name; a rename rewrites it. */
  notes = new Map<string, XlsxNotesOp>();
  /** Declarative CF/DV journal (X01): per sheet, the LAST whole-sheet
   *  conditional-format and data-validation snapshots, in first-touch order
   *  (like notes). The map key is the sheet's CURRENT name; a rename
   *  rewrites it. */
  ruleSets = new Map<string, XlsxRuleSetEntry>();
  /** Ordered sheet registry: file sheets in tab order, plus additions. Ops
   *  are applied in emission order, so every entry's `name` is current. */
  /** Non-private so the FIX-926-D sheet-op module (model-sheet-ops.ts) can
   *  apply add/rename/remove/duplicate/reorder/hide against the live registry. */
  sheetStates: ModelSheetState[] = [];
  /** Original file names of sheets removed this session (additions removed
   *  before save leave no trace). */
  removedOriginals: string[] = [];
  /** F3 tombstones: a removed sheet's state plus the pending edits it
   *  carried, keyed by the name it had when removed. An `add_sheet` whose
   *  name matches a tombstone cancels the removal and resurrects the
   *  original state (the "unremove" an undo of a removal needs); the
   *  gateway then keeps the original part untouched instead of writing a
   *  blank one. */
  removedStates = new Map<string, RemovedSheetState>();
  /** True once a reorder op applied: calcChain sheet indexes go stale. */
  sheetOrderChanged = false;
  /** Count of applied sheet ops — the save plan exists only when > 0. */
  sheetOpsApplied = 0;
  addedSheetSequence = 0;
  touched = false;
  /** Monotonic edit counter — a two-save chain can prove the base advanced. */
  revision = 0;

  constructor(imported: XlsxWorkbookSnapshot, inputSha256: string) {
    this.snapshot = imported;
    this.inputSha256 = inputSha256;
    this.sheetStates = imported.sheets.map((sheet) => ({
      key: sheet.name,
      originalName: sheet.name,
      name: sheet.name,
      hidden: false,
      hiddenTouched: false,
      added: false,
    }));
  }

  get isDirty(): boolean {
    return this.touched;
  }

  /** F5: an opaque rollback checkpoint of every mutable field. The adapter
   *  applies ops while parsing (emission-order resolution), so a malformed
   *  item mid-envelope would otherwise leave the valid prefix applied. It
   *  checkpoints once, then rolls back if the parse throws. */
  checkpoint(): ModelCheckpoint {
    return structuredClone({
      pending: this.pending,
      structural: this.structural,
      filters: this.filters,
      pageSetups: this.pageSetups,
      tables: this.tables,
      visuals: this.visuals,
      sheetProtections: this.sheetProtections,
      definedNames: this.definedNames,
      hyperlinks: this.hyperlinks,
      notes: this.notes,
      ruleSets: this.ruleSets,
      sheetStates: this.sheetStates,
      removedOriginals: this.removedOriginals,
      removedStates: this.removedStates,
      sheetOrderChanged: this.sheetOrderChanged,
      sheetOpsApplied: this.sheetOpsApplied,
      addedSheetSequence: this.addedSheetSequence,
      touched: this.touched,
      revision: this.revision,
    });
  }

  /** Restore the exact state a checkpoint captured (F5 rollback). */
  rollback(checkpoint: ModelCheckpoint): void {
    this.pending = new Map(checkpoint.pending);
    this.structural = new Map(checkpoint.structural);
    this.filters = new Map(checkpoint.filters);
    this.pageSetups = new Map(checkpoint.pageSetups);
    this.tables = checkpoint.tables;
    this.visuals = checkpoint.visuals;
    this.sheetProtections = new Map(checkpoint.sheetProtections);
    this.definedNames = checkpoint.definedNames;
    this.hyperlinks = new Map(checkpoint.hyperlinks);
    this.notes = new Map(checkpoint.notes);
    this.ruleSets = new Map(checkpoint.ruleSets);
    this.sheetStates = checkpoint.sheetStates;
    this.removedOriginals = checkpoint.removedOriginals;
    this.removedStates = new Map(checkpoint.removedStates);
    this.sheetOrderChanged = checkpoint.sheetOrderChanged;
    this.sheetOpsApplied = checkpoint.sheetOpsApplied;
    this.addedSheetSequence = checkpoint.addedSheetSequence;
    this.touched = checkpoint.touched;
    this.revision = checkpoint.revision;
  }

  /** Sheet-name resolver the ops parser validates targets against. It is a
   *  LIVE view: the adapter parses and applies in one pass, so an op after a
   *  rename resolves to the new name and a removed sheet stops resolving.
   *  `nameForId` maps a grid id to the sheet's current name (undefined once
   *  that sheet is gone). */
  resolver(sheetNamesById: Readonly<Record<string, string>>): XlsxSheetResolver {
    return {
      sheetNames: () => this.sheetStates.map((sheet) => sheet.name),
      nameForId: (id) => {
        const original = sheetNamesById[id];
        if (original === undefined) return undefined;
        return this.sheetStates.find((sheet) => sheet.originalName === original)?.name;
      },
    };
  }

  /** Cells of one sheet with pending edits overlaid (the save-plan view). An
   *  added sheet has no file cells; a renamed sheet reads its original part. */
  cells(sheetName: string): Record<string, XlsxCellState> {
    const sheet = this.sheetStates.find((s) => s.name === sheetName);
    if (!sheet) throw new XlsxEngineError("bad_target", "unknown sheet " + JSON.stringify(sheetName));
    const base =
      sheet.originalName === undefined
        ? {}
        : this.snapshot.sheets.find((s) => s.name === sheet.originalName)?.cells ?? {};
    return overlayCells(base, this.pendingFor(sheetName));
  }

  private pendingFor(sheetName: string): Map<string, PendingCell> {
    const out = new Map<string, PendingCell>();
    for (const [key, entry] of this.pending) {
      if (entry.sheetName === sheetName) out.set(key, entry);
    }
    return out;
  }

  applyEdit(op: XlsxEditOp): void {
    if (isXlsxSheetOp(op)) {
      sheetOpsFor(this).applySheetOp(op);
      return;
    }
    if (isXlsxFilterOp(op)) {
      this.applyFilterOp(op);
      return;
    }
    if (isXlsxSheetProtectionOp(op)) {
      this.applySheetProtectionOp(op);
      return;
    }
    if (isXlsxDefinedNamesOp(op)) {
      this.applyDefinedNamesOp(op);
      return;
    }
    if (isXlsxPageSetupOp(op)) {
      this.applyPageSetupOp(op);
      return;
    }
    if (isXlsxTableOp(op)) {
      this.applyTableOp(op);
      return;
    }
    if (isXlsxVisualOp(op)) {
      this.visuals = foldXlsxVisualOp(this.visuals, op);
      this.touched = true;
      this.revision += 1;
      return;
    }
    if (isXlsxHyperlinkOp(op)) {
      this.applyHyperlinkOp(op);
      return;
    }
    if (isXlsxNotesOp(op)) {
      this.applyNotesOp(op);
      return;
    }
    if (isXlsxRuleSetOp(op)) {
      // CF/DV snapshots are whole-sheet and final at emission: last write per
      // family wins, nothing shifts (the renderer re-snapshots after a shift).
      this.ruleSets.set(op.sheetName, withRuleSetOp(this.ruleSets.get(op.sheetName), op));
      this.touched = true;
      this.revision += 1;
      return;
    }
    if (isXlsxStructuralOp(op)) {
      this.applyStructuralOp(op);
      return;
    }
    const key = JSON.stringify([op.target.sheetName, op.target.address]);
    const previous = this.pending.get(key);
    const writesContent = op.kind === "clear_cell" || op.writeValue;
    const resetsStyle = op.kind === "set_cell" && op.styleReset === true;
    const delta = op.kind === "set_cell" ? op.style : undefined;
    // A nested style field (border, color, fill) is a complete gateway value.
    // Replace that field atomically; keep the other independently edited fields.
    const style = resetsStyle ? delta : previous?.edit.style || delta ? { ...previous?.edit.style, ...delta } : undefined;
    const styleReset = resetsStyle || previous?.edit.styleReset === true;
    const cell = writesContent
      ? op.kind === "clear_cell" ? { value: null } : op.cell
      : previous?.edit.cell ?? (op.kind === "set_cell" ? op.cell : { value: null });
    this.pending.set(key, {
      sheetName: op.target.sheetName,
      row: op.target.row,
      column: op.target.column,
      edit: {
        sheetName: op.target.sheetName,
        row: op.target.row,
        column: op.target.column,
        writeValue: writesContent || previous?.edit.writeValue === true,
        cell: structuredClone(cell),
        ...(style === undefined ? {} : { style: structuredClone(style) }),
        ...(styleReset ? { styleReset: true } : {}),
      },
      // Styling preserves an earlier native input, including a clear's "".
      recalcInput: writesContent ? op.recalcInput : previous?.recalcInput ?? null,
    });
    this.touched = true;
    this.revision += 1;
  }

  /** Records one structural op and moves already-pending cells into the
   *  op's post-operation space — exactly the shift the renderer journal
   *  applies when it records the same op, so both sides of the save agree on
   *  final coordinates. Ops that don't shift anything (sizes, hidden flags,
   *  outline levels) only append to the journal. */
  private applyStructuralOp(op: XlsxStructuralOp): void {
    const ops = this.structural.get(op.sheetName) ?? [];
    ops.push(op);
    this.structural.set(op.sheetName, ops);
    if ("index" in op) {
      this.shiftPendingCells(op);
      this.shiftLinkAndNoteJournals(op);
      this.visuals = shiftXlsxVisualEntries(this.visuals, op.sheetName, op);
    }
    this.touched = true;
    this.revision += 1;
  }

  /** Filters are declarative whole-sheet snapshots: the last op per sheet
   *  wins, in first-touch order. Nothing shifts — filter coordinates are
   *  final when the renderer snapshots them (the gateway applies the states
   *  after structural replay and cell edits). */
  private applyFilterOp(op: XlsxFilterOp): void {
    this.filters.set(op.sheetName, op);
    this.touched = true;
    this.revision += 1;
  }

  /** Page setup is a declarative whole-sheet snapshot; the op carries only the
   *  fields the UI changed, so the journal merges field-wise (last write per
   *  field wins) in first-touch order — a second dialog apply must not drop
   *  the first one's settings. The gateway then merges each present field into
   *  the file and keeps absent fields verbatim. */
  private applyPageSetupOp(op: XlsxPageSetupOp): void {
    const previous = this.pageSetups.get(op.sheetName)?.setup;
    const setup: XlsxPageSetupFields = { ...previous };
    for (const [key, value] of Object.entries(op.setup)) {
      if (value !== undefined) (setup as Record<string, unknown>)[key] = value;
    }
    this.pageSetups.set(op.sheetName, { kind: "set_page_setup", sheetName: op.sheetName, setup });
    this.touched = true;
    this.revision += 1;
  }

  /** Sheet protection is a declarative whole-sheet flag: the last op per
   *  sheet wins, in first-touch order. */
  private applySheetProtectionOp(op: XlsxSheetProtectionOp): void {
    this.sheetProtections.set(op.sheetName, op);
    this.touched = true;
    this.revision += 1;
  }

  /** Defined names are a workbook-scoped declarative snapshot: the last op
   *  wins outright. */
  private applyDefinedNamesOp(op: XlsxDefinedNamesOp): void {
    this.definedNames = op;
    this.touched = true;
    this.revision += 1;
  }

  /** Hyperlinks are a per-cell declarative journal: a later op for the same
   *  cell replaces the earlier one (a null target removes the link). The
   *  journal shifts with later row/column ops (F3), matching the renderer's own
   *  hyperlink journal, so the gateway applies the list after structural replay
   *  at final coordinates. */
  private applyHyperlinkOp(op: XlsxHyperlinkOp): void {
    const links = this.hyperlinks.get(op.sheetName) ?? new Map<string, XlsxHyperlinkOp>();
    links.set(op.address, op);
    this.hyperlinks.set(op.sheetName, links);
    this.touched = true;
    this.revision += 1;
  }

  /** Notes are a declarative whole-sheet snapshot: the last op per sheet wins,
   *  in first-touch order (the gateway's applySheetNotes replaces the sheet's
   *  complete comment set). A later row/column op shifts the snapshot (F3) so
   *  the anchors follow the cells they annotate. */
  private applyNotesOp(op: XlsxNotesOp): void {
    this.notes.set(op.sheetName, op);
    this.touched = true;
    this.revision += 1;
  }

  /** Table ops: create_table appends an addition (final coordinates), and
   *  remove_table cancels an earlier add of the same name (session adds
   *  only; the gateway has no table-removal write path). Nothing shifts. */
  private applyTableOp(op: XlsxTableAddOp | { kind: "remove_table"; sheetName: string; name: string }): void {
    if (op.kind === "create_table") {
      this.tables.push(op);
    } else {
      const needle = op.name.toLowerCase();
      const index = this.tables.findIndex((table) => table.sheetName === op.sheetName && table.name.toLowerCase() === needle);
      if (index >= 0) this.tables.splice(index, 1);
    }
    this.touched = true;
    this.revision += 1;
  }

  /** The post-operation position map one row/column op applies: a position
   *  inside a removed span disappears (null), one past it slides back, and an
   *  insertion pushes everything at/after its index forward. Shared by the
   *  pending-cell shift and the hyperlink/note journal shift so both stay in
   *  step with the renderer's own journal. */
  private structuralMove(op: Extract<XlsxStructuralOp, { index: number }>): (position: number) => number | null {
    const removing = op.kind === "remove_rows" || op.kind === "remove_cols";
    return (position) => {
      if (removing) {
        if (position >= op.index && position < op.index + op.count) return null;
        return position >= op.index + op.count ? position - op.count : position;
      }
      return position >= op.index ? position + op.count : position;
    };
  }

  /** F3: a row/column op shifts the hyperlink and note journals too, exactly
   *  like the renderer's own hyperlink journal (edit-journal.ts). Without this
   *  a link or note anchored before the op would persist at a stale cell while
   *  the content moved. A cell inside a removed span drops its link/note. */
  private shiftLinkAndNoteJournals(op: Extract<XlsxStructuralOp, { index: number }>): void {
    const axis = op.kind === "insert_cols" || op.kind === "remove_cols" ? "column" : "row";
    const move = this.structuralMove(op);
    const links = this.hyperlinks.get(op.sheetName);
    if (links !== undefined) {
      const shifted = new Map<string, XlsxHyperlinkOp>();
      for (const link of links.values()) {
        const row = axis === "row" ? move(link.row) : link.row;
        const column = axis === "column" ? move(link.column) : link.column;
        if (row === null || column === null) continue;
        const address = toA1(row, column);
        shifted.set(address, { ...link, row, column, address });
      }
      this.hyperlinks.set(op.sheetName, shifted);
    }
    const notes = this.notes.get(op.sheetName);
    if (notes !== undefined) {
      const shifted: XlsxSheetNote[] = [];
      for (const note of notes.notes) {
        const row = axis === "row" ? move(note.row) : note.row;
        const column = axis === "column" ? move(note.column) : note.column;
        if (row === null || column === null) continue;
        shifted.push({ ...note, row, column });
      }
      this.notes.set(op.sheetName, { ...notes, notes: shifted });
    }
  }

  private shiftPendingCells(op: Extract<XlsxStructuralOp, { index: number }>): void {
    const axis = op.kind === "insert_cols" || op.kind === "remove_cols" ? "column" : "row";
    const move = this.structuralMove(op);
    const shifted = new Map<string, PendingCell>();
    for (const entry of this.pending.values()) {
      if (entry.sheetName !== op.sheetName) {
        shifted.set(JSON.stringify([entry.sheetName, toA1(entry.row, entry.column)]), entry);
        continue;
      }
      const moved = move(axis === "row" ? entry.row : entry.column);
      if (moved === null) continue;
      const row = axis === "row" ? moved : entry.row;
      const column = axis === "column" ? moved : entry.column;
      shifted.set(JSON.stringify([entry.sheetName, toA1(row, column)]), { ...entry, row, column, edit: { ...entry.edit, row, column } });
    }
    this.pending = shifted;
  }

  /** The gateway's SheetEditPlan rebuilt from the model's final state. Field
   *  names follow the vendored interface exactly: renames/addition names are
   *  final, removals are original file names, `order` is the complete final
   *  tab order and hidden changes are keyed by the original (or added) name. */
  pendingSheetPlan(): XlsxSheetEditPlan | undefined {
    return sheetOpsFor(this).pendingSheetPlan();
  }
  /** The name the package on disk currently holds for a sheet the envelope
   *  addresses by its current name: the original file name for a pre-existing
   *  sheet, the (final) name itself for an addition. Cell edits, structural
   *  ops and recalc reads are translated through this before the gateway call
   *  — the gateway resolves parts by the CURRENT file names and applies the
   *  plan's renames last. */
  gatewaySheetName(name: string): string {
    return this.sheetStates.find((sheet) => sheet.name === name)?.originalName ?? name;
  }

  /** The structural journal for the gateway's structuralOps argument: ops
   *  grouped per sheet, first-touch sheet order, journal order inside a
   *  sheet. Empty when the session has no structural edits. */
  pendingStructuralOps(): XlsxSheetStructuralOps[] {
    return groupXlsxStructuralOps([...this.structural.values()].flat());
  }

  /** The filter plan for the gateway's filterStates argument: one declarative
   *  state per touched sheet, last write per sheet, in first-touch order. A
   *  sheet whose last filter op was a clear folds to `filter: null` (remove
   *  the autoFilter, unhide the visibility range). Empty when the session has
   *  no filter edits. */
  pendingFilterStates(): XlsxSheetFilterState[] {
    return groupXlsxFilterStates([...this.filters.values()]);
  }

  /** The page-setup plan for the gateway's pageSetupStates argument: one
   *  declarative state per touched sheet, fields merged last-write-per-field
   *  across that sheet's ops, in first-touch sheet order. Empty when the
   *  session has no page-setup edits. */
  pendingPageSetupStates(): XlsxSheetPageSetupState[] {
    return groupXlsxPageSetupStates([...this.pageSetups.values()]);
  }

  /** The table additions for the gateway's tableAdditions argument, in
   *  emission order with any remove_table cancellations applied. Empty when
   *  the session has no table edits. */
  pendingTableAdditions() {
    return groupXlsxTableAdditions(this.tables);
  }

  /** The visual additions for the gateway visualAdditions argument (patch
   *  0010), in first-insert order. Empty when the session inserted none. */
  pendingVisualAdditions(): XlsxSheetVisualAddition[] {
    return groupXlsxVisualAdditions(this.visuals);
  }

  /** The protection plan for the gateway sheetProtections argument: one
   *  declarative flag per touched sheet, last write per sheet, first-touch
   *  order. Empty when the session has no protection edits. */
  pendingSheetProtectionStates(): XlsxSheetProtectionState[] {
    return groupXlsxSheetProtectionStates([...this.sheetProtections.values()]);
  }

  /** The defined-names snapshot for the gateway definedNamesState argument:
   *  the last set_defined_names op, or undefined when the session has none. */
  pendingDefinedNamesState(): XlsxDefinedNamesState | undefined {
    return this.definedNames === undefined ? undefined : groupXlsxDefinedNamesState([this.definedNames]);
  }

  /** The hyperlink plan for the gateway's hyperlinkEdits argument: one
   *  per-cell list per touched sheet, last write per cell, in first-touch
   *  sheet order. Empty when the session has no hyperlink edits. */
  pendingHyperlinkEdits(): XlsxSheetHyperlinkEdits[] {
    return groupXlsxHyperlinkEdits([...this.hyperlinks.values()].flatMap((links) => [...links.values()]));
  }

  /** The note plan for the gateway's noteStates argument: one whole-sheet
   *  snapshot per touched sheet, last write per sheet, in first-touch order.
   *  Empty when the session has no note edits. */
  pendingNoteStates(): XlsxSheetNoteState[] {
    return groupXlsxNoteStates([...this.notes.values()]);
  }

  /** The gateway's cfStates argument (X01): one whole-sheet rule set per
   *  touched sheet, in first-touch order. Empty without CF edits. */
  pendingConditionalFormatStates(): XlsxSheetConditionalFormatState[] {
    return pendingConditionalFormatStates(this.ruleSets.values());
  }

  /** The gateway's dvStates argument (X01), same shape as the CF one. */
  pendingDataValidationStates(): XlsxSheetDataValidationState[] {
    return pendingDataValidationStates(this.ruleSets.values());
  }

  /** Drop one family's snapshot of a sheet after the save named it
   *  unsaveable (adapter-rule-sets.ts), so later saves are not blocked. */
  discardRuleSet(sheetName: string, family: "conditionalFormats" | "dataValidations"): void {
    const entry = withoutRuleSetFamily(this.ruleSets.get(sheetName), family);
    if (entry) this.ruleSets.set(sheetName, entry);
    else this.ruleSets.delete(sheetName);
    this.revision += 1;
  }

  /** Edits in insertion order (last write wins per cell already applied). */
  pendingEdits(): XlsxCellEdit[] {
    return [...this.pending.values()].map((e) => e.edit);
  }

  /** The recalc wire edits — one per pending writeValue edit; style-only
   *  edits carry no input so IronCalc never hears about them. */
  pendingRecalcEdits(): XlsxRecalcEdit[] {
    const out: XlsxRecalcEdit[] = [];
    for (const entry of this.pending.values()) {
      if (entry.recalcInput === null) continue;
      out.push({ sheet: entry.sheetName, row: entry.row, column: entry.column, input: entry.recalcInput });
    }
    return out;
  }

  /** Every cell that carries a formula AFTER the pending edits apply —
   *  existing <f> cells a literal overwrite drops, plus new formula edits.
   *  These are exactly the cells whose cached <v> must be refreshed on save.
   *  Added sheets are skipped: the recalc sidecar reads the ORIGINAL bytes,
   *  where such a part does not exist, and an identity-changing sheet op skips
   *  the recalc pass entirely (adapter.serialize). `followers` are the input
   *  bytes' shared-formula followers (keyed by the file's sheet name): the
   *  snapshot reads them as literals, so they count as formula cells unless
   *  a pending edit wrote the cell's content. */
  formulaCellsAfterEdits(followers: XlsxSharedFollowers = new Map()): { sheetName: string; row: number; column: number; address: string }[] {
    const out: { sheetName: string; row: number; column: number; address: string }[] = [];
    for (const state of this.sheetStates) {
      if (state.added) continue;
      const cells = this.cells(state.name);
      const addresses = new Set<string>();
      for (const address of (state.originalName === undefined ? undefined : followers.get(state.originalName)) ?? []) {
        addresses.add(address);
      }
      for (const entry of this.pendingFor(state.name).values()) {
        if (entry.edit.writeValue) addresses.delete(toA1(entry.row, entry.column));
      }
      for (const [address, cell] of Object.entries(cells)) {
        if (cell.formula !== undefined) addresses.add(address);
      }
      for (const address of addresses) {
        const { row, column } = a1ToRowColumn(address, "<model>", "address");
        out.push({ sheetName: state.name, row, column, address });
      }
    }
    return out;
  }

  /** A sheet whose formula a pending edit dropped (literal over <f>) still
   *  must NOT be recalc-read as a formula — the engine types it as a literal
   *  after edits, so coverage checks read the post-edit model. */
  coveredFormulaCount(): number {
    return this.formulaCellsAfterEdits().length;
  }

  /** Re-base after a successful serialize: the produced bytes become the new
   *  original (their own parse) and pending edits drain — the xlsx equivalent
   *  of docx commitSaved. The sheet registry is rebuilt from the new snapshot,
   *  so final names become the new originals. */
  rebase(newSnapshot: XlsxWorkbookSnapshot, newInputSha256: string): void {
    this.snapshot = newSnapshot;
    this.inputSha256 = newInputSha256;
    this.pending.clear();
    this.structural.clear();
    this.filters.clear();
    this.pageSetups.clear();
    this.tables = [];
    this.visuals = [];
    this.sheetProtections.clear();
    this.ruleSets.clear();
    this.definedNames = undefined;
    this.sheetStates = newSnapshot.sheets.map((sheet) => ({
      key: sheet.name,
      originalName: sheet.name,
      name: sheet.name,
      hidden: false,
      hiddenTouched: false,
      added: false,
    }));
    this.removedOriginals = [];
    this.removedStates.clear();
    this.sheetOrderChanged = false;
    this.sheetOpsApplied = 0;
    this.addedSheetSequence = 0;
    this.touched = false;
    this.modelRevision += 1;
  }
}

export function createXlsxSessionModel(imported: XlsxWorkbookSnapshot, inputSha256: string): XlsxSessionModel {
  return new XlsxSessionModel(imported, inputSha256);
}
