// XLSX hyperlink op parser (hyperlinkEdits slot). The shared vocabulary lives
// in ops-shared.ts. Split out so ops.ts stays under the max-lines budget.
//
// Wire shape: { op: "set_hyperlink", target: { sheet }, attributes: { cell,
// target } }. `cell` is an A1 address; `target` is a URL, an internal anchor
// ('#Sheet!A1') or null to remove the link. One op kind serves both set and
// clear (like the vendored HyperlinkEdit), because the gateway applies a
// per-cell last-write-wins list and a null target is a removal. Coordinates
// are final (post-operation) at emission time, so the gateway applies the
// list after structural replay.
import {
  XlsxOpError,
  str,
  a1ToRowColumn,
  parseStructuralTarget,
  parseStructuralAttributes,
  toA1,
  type Dict,
  type XlsxEditOp,
  type XlsxSheetResolver,
} from "./ops-shared.ts";

/** The IE/Office legacy URL ceiling the vendored wire schema carries
 *  (desktop-api.ts workbookHyperlinkEditSchema: string 1..2083). */
const MAX_HYPERLINK_TARGET_LEN = 2_083;

export const HYPERLINK_OP_KIND = "set_hyperlink";

/** One hyperlink change at a cell (the engine's typed op). `target` null
 *  removes the link. */
export type XlsxHyperlinkOp = {
  readonly kind: "set_hyperlink";
  readonly sheetName: string;
  readonly row: number;
  readonly column: number;
  readonly address: string;
  readonly target: string | null;
};

/** The gateway's SheetHyperlinkEdits: one sheet's per-cell changes, in
 *  emission order (xlsx-hyperlinks.ts HyperlinkEdit). */
export interface XlsxSheetHyperlinkEdits {
  readonly sheetName: string;
  readonly edits: readonly { readonly row: number; readonly column: number; readonly target: string | null }[];
}

export function isXlsxHyperlinkOp(op: XlsxEditOp): op is XlsxHyperlinkOp {
  return op.kind === HYPERLINK_OP_KIND;
}

export function parseSetHyperlink(item: Dict, op: string, sheets: XlsxSheetResolver): XlsxEditOp[] {
  const sheetName = parseStructuralTarget(item, op, sheets);
  const a = parseStructuralAttributes(item, op);
  const cell = str(a.cell, op, "attributes.cell");
  const { row, column } = a1ToRowColumn(cell, op, "attributes.cell");
  let target: string | null;
  if (a.target === null) {
    target = null;
  } else {
    const value = str(a.target, op, "attributes.target");
    if (value.length === 0 || value.length > MAX_HYPERLINK_TARGET_LEN) {
      throw new XlsxOpError(op, "attributes.target", `a URL/anchor of 1-${MAX_HYPERLINK_TARGET_LEN} characters, or null, required`);
    }
    target = value;
  }
  return [{ kind: HYPERLINK_OP_KIND, sheetName, row, column, address: toA1(row, column), target }];
}

/** Fold hyperlink ops per sheet, last write per cell wins (the gateway applies
 *  each cell once), in first-touch sheet order. Every op is kept - including a
 *  null target, which removes the link - because the gateway's list is a
 *  per-cell last-write-wins application. */
export function groupXlsxHyperlinkEdits(ops: readonly XlsxEditOp[]): XlsxSheetHyperlinkEdits[] {
  const bySheet = new Map<string, Map<string, { row: number; column: number; target: string | null }>>();
  for (const op of ops) {
    if (!isXlsxHyperlinkOp(op)) continue;
    const links = bySheet.get(op.sheetName) ?? new Map<string, { row: number; column: number; target: string | null }>();
    links.set(op.address, { row: op.row, column: op.column, target: op.target });
    bySheet.set(op.sheetName, links);
  }
  return [...bySheet].map(([sheetName, links]) => ({ sheetName, edits: [...links.values()] }));
}
