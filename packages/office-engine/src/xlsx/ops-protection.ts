// XLSX sheet-protection op parser + fold (sheetProtections slot). A sibling of
// the other op-family modules (ops-structure / ops-filter / ops-page-setup).
//
// Wire shape: { op: "set_sheet_protection", target: { sheet }, attributes:
// { protected: boolean } }. The vendored gateway's applySheetProtection adds
// or removes <sheetProtection> for the sheet (no password support: unprotecting
// a password-protected sheet fails closed). The state is whole-sheet and
// declarative, so the model folds last-write-per-sheet in emission order.
import { XlsxOpError, parseStructuralTarget, parseStructuralAttributes, type Dict, type XlsxEditOp, type XlsxSheetResolver } from "./ops-shared.ts";

/** One sheet's declarative protection state (upstream SheetProtectionState,
 *  xlsx-gateway.ts:166) - the shape of the sheetProtections argument. */
export interface XlsxSheetProtectionState {
  readonly sheetName: string;
  readonly protected: boolean;
}

/** The envelope op (sheetProtections slot): the sheet's CURRENT name plus the
 *  desired protection flag. A later op for the same sheet replaces it. */
export type XlsxSheetProtectionOp = {
  readonly kind: "set_sheet_protection";
  readonly sheetName: string;
  readonly protected: boolean;
};

export const SHEET_PROTECTION_OP_KIND = "set_sheet_protection";

export function isXlsxSheetProtectionOp(op: XlsxEditOp): op is XlsxSheetProtectionOp {
  return op.kind === SHEET_PROTECTION_OP_KIND;
}

/** Fold protection ops per sheet, emission order, last write wins; first-touch
 *  sheet order is kept. Empty when the session has no protection edits. */
export function groupXlsxSheetProtectionStates(ops: readonly XlsxEditOp[]): XlsxSheetProtectionState[] {
  const bySheet = new Map<string, XlsxSheetProtectionState>();
  for (const op of ops) {
    if (!isXlsxSheetProtectionOp(op)) continue;
    bySheet.set(op.sheetName, { sheetName: op.sheetName, protected: op.protected });
  }
  return [...bySheet.values()];
}

export function parseSetSheetProtection(item: Dict, op: string, sheets: XlsxSheetResolver): XlsxEditOp[] {
  const sheetName = parseStructuralTarget(item, op, sheets);
  const a = parseStructuralAttributes(item, op);
  for (const key of Object.keys(a)) {
    if (key !== "protected") throw new XlsxOpError(op, "attributes." + key, "unknown protection field");
  }
  if (typeof a.protected !== "boolean") {
    throw new XlsxOpError(op, "attributes.protected", "boolean required");
  }
  return [{ kind: SHEET_PROTECTION_OP_KIND, sheetName, protected: a.protected }];
}
