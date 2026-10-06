// XLSX session-model state vocabulary: the vendored gateway SheetEditPlan,
// the sheet-registry entry, the removable-sheet tombstone and the pending
// cell/checkpoint shapes the session model owns. Split out of model.ts by
// FIX-926-D (mechanical move) so both files stay under the max-lines budget.
// model.ts re-exports the two public names, so the package surface is
// unchanged.

import { type XlsxCellEdit, type XlsxCellState } from "./engine.ts";
import { toA1, type XlsxFilterOp, type XlsxHyperlinkOp, type XlsxNotesOp, type XlsxStructuralOp } from "./ops.ts";
import { type XlsxPageSetupOp } from "./page-setup.ts";
import { type XlsxDefinedNamesOp } from "./ops-names.ts";
import { type XlsxTableAddOp } from "./tables.ts";
import { type XlsxVisualSetOp } from "./ops-visuals.ts";
import { type XlsxSheetProtectionOp } from "./ops-protection.ts";

/** The vendored gateway's SheetEditPlan, rebuilt from the model's final sheet
 *  state at save time (xlsx-sheets.ts SheetEditPlan). `order` is the COMPLETE
 *  final tab order; renames/additions name final sheets, removals name the
 *  original file name, hidden changes are keyed by the original name (or the
 *  added name). */
export interface XlsxSheetEditPlan {
  readonly renames: readonly { readonly sheetName: string; readonly newName: string }[];
  readonly additions: readonly { readonly name: string; readonly sourceSheetName?: string | undefined }[];
  readonly removals: readonly string[];
  readonly order: readonly string[];
  readonly hiddenChanges?: readonly { readonly sheetName: string; readonly hidden: boolean }[] | undefined;
  readonly orderChanged?: boolean | undefined;
}

/** One sheet's session state: a stable identity plus the user-visible current
 *  name. Sheet ops are applied in emission order, so `name` is what every
 *  later wire op addresses and what the save plan reports; `originalName` is
 *  the name the package on disk still carries (undefined for a sheet added
 *  this session). */
export interface ModelSheetState {
  readonly key: string;
  readonly originalName?: string | undefined;
  name: string;
  hidden: boolean;
  hiddenTouched: boolean;
  readonly added: boolean;
  readonly sourceKey?: string | undefined;
}

/** One removable-sheet tombstone (F3): the state and the pending edits a
 *  removal set aside so an undo can resurrect them. */
export interface RemovedSheetState {
  readonly state: ModelSheetState;
  readonly pending: PendingCell[];
  readonly structural: XlsxStructuralOp[];
  readonly filter?: XlsxFilterOp | undefined;
  readonly pageSetup?: XlsxPageSetupOp | undefined;
  readonly tables?: readonly XlsxTableAddOp[] | undefined;
  readonly visuals?: readonly XlsxVisualSetOp[] | undefined;
  readonly protection?: XlsxSheetProtectionOp | undefined;
  /** Per-cell hyperlink ops set aside at removal (address -> op). */
  readonly hyperlinks?: readonly XlsxHyperlinkOp[] | undefined;
  /** The whole-sheet note snapshot set aside at removal. */
  readonly notes?: XlsxNotesOp | undefined;
  /** Tab position at removal: an undo re-insert with no explicit index lands
   *  back where the sheet was instead of at the end of the strip. */
  readonly index: number;
}

/** Opaque model snapshot for the adapter's all-or-nothing edit (F5). */
export interface ModelCheckpoint {
  readonly pending: Map<string, PendingCell>;
  readonly structural: Map<string, XlsxStructuralOp[]>;
  readonly filters: Map<string, XlsxFilterOp>;
  readonly pageSetups: Map<string, XlsxPageSetupOp>;
  readonly tables: XlsxTableAddOp[];
  readonly visuals: XlsxVisualSetOp[];
  readonly sheetProtections: Map<string, XlsxSheetProtectionOp>;
  readonly definedNames: XlsxDefinedNamesOp | undefined;
  readonly hyperlinks: Map<string, Map<string, XlsxHyperlinkOp>>;
  readonly notes: Map<string, XlsxNotesOp>;
  readonly sheetStates: ModelSheetState[];
  readonly removedOriginals: string[];
  readonly removedStates: Map<string, RemovedSheetState>;
  readonly sheetOrderChanged: boolean;
  readonly sheetOpsApplied: number;
  readonly addedSheetSequence: number;
  readonly touched: boolean;
  readonly revision: number;
}

/** One pending cell: content and independent style fields fold separately. */
export interface PendingCell {
  readonly sheetName: string;
  readonly row: number;
  readonly column: number;
  readonly edit: XlsxCellEdit;
  readonly recalcInput: string | null;
}

/** The cell map a serialize plans against: snapshot cells overlaid with the
 *  pending edits (a clear removes the entry, a set replaces it). */
export function overlayCells(
  base: Readonly<Record<string, XlsxCellState>>,
  pending: Map<string, PendingCell>,
): Record<string, XlsxCellState> {
  const cells: Record<string, XlsxCellState> = { ...base };
  for (const entry of pending.values()) {
    const address = toA1(entry.row, entry.column);
    if (entry.edit.writeValue) {
      cells[address] = entry.edit.cell;
      if (cells[address].value === null && cells[address].formula === undefined) delete cells[address];
    } else {
      cells[address] = cells[address] ?? { value: null };
    }
  }
  return cells;
}
