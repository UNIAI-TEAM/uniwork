// XLSX worksheet-level op parsers (add / duplicate / rename / remove /
// reorder / hide). Split out of ops.ts (FIX-926-B); the shared vocabulary
// lives in ops-shared.ts.
import { XlsxOpError, isDict, int, str, parseStructuralTarget, parseStructuralAttributes, type Dict, type XlsxEditOp, type XlsxSheetResolver } from "./ops-shared.ts";
// ── sheet ops (add / rename / remove / duplicate / reorder / hide) ─────────
//
// Wire shape mirrors B1/B2: { op, target: { sheet } , attributes: { ... } }.
// `add_sheet` has no sheet to address (target absent or empty). Names are
// validated against the upstream rules (validateSheetName, xlsx-sheets.ts):
// 1-31 characters, no \ / ? * [ ] :, no leading/trailing apostrophe, unique
// among the live sheets (case-insensitive, as Excel treats names). Every name
// check runs against the live resolver, so a name freed by an earlier removal
// in the same envelope is reusable and one taken by an earlier addition is
// not.

/** OOXML worksheet-name bound (validateSheetName). */
const MAX_SHEET_NAME_LEN = 31;
const INVALID_SHEET_NAME_CHARS = /[\\/?*[\]:]/;
/** Tab-position ceiling: an envelope carries at most max_edit_ops items, so a
 *  workbook with more sheets than that cannot be addressed in one save. */
const MAX_SHEET_INDEX = 9_999;

function parseSheetNameValue(raw: unknown, op: string, field: string): string {
  const name = str(raw, op, field);
  if (name.length === 0 || name.length > MAX_SHEET_NAME_LEN) {
    throw new XlsxOpError(op, field, `sheet name must be 1-${MAX_SHEET_NAME_LEN} characters`);
  }
  if (INVALID_SHEET_NAME_CHARS.test(name)) {
    throw new XlsxOpError(op, field, "sheet name cannot contain \\ / ? * [ ] :");
  }
  if (name.startsWith("'") || name.endsWith("'")) {
    throw new XlsxOpError(op, field, "sheet name cannot start or end with an apostrophe");
  }
  return name;
}

/** Refuses a name already taken by a live sheet. `except` exempts the sheet a
 *  rename is about, so a case-only rewrite stays a legal no-op. */
function assertSheetNameFree(
  name: string,
  op: string,
  field: string,
  sheets: XlsxSheetResolver,
  except?: string,
): void {
  const needle = name.toLowerCase();
  for (const existing of sheets.sheetNames()) {
    if (except !== undefined && existing === except) continue;
    if (existing.toLowerCase() === needle) {
      throw new XlsxOpError(op, field, `sheet name ${JSON.stringify(name)} is already used`);
    }
  }
}

function optionalSheetIndex(item: Dict, op: string): number | undefined {
  const a = parseStructuralAttributes(item, op);
  if (a.index === undefined) return undefined;
  const index = int(a.index, op, "attributes.index");
  if (index < 0 || index > MAX_SHEET_INDEX) {
    throw new XlsxOpError(op, "attributes.index", `index must be 0-${MAX_SHEET_INDEX}`);
  }
  return index;
}

export function parseAddSheet(item: Dict, op: string, sheets: XlsxSheetResolver): XlsxEditOp[] {
  if (item.target !== undefined && (!isDict(item.target) || Object.keys(item.target).length > 0)) {
    throw new XlsxOpError(op, "target", "add_sheet addresses no existing sheet");
  }
  const name = parseSheetNameValue(parseStructuralAttributes(item, op).name, op, "attributes.name");
  assertSheetNameFree(name, op, "attributes.name", sheets);
  const index = optionalSheetIndex(item, op);
  if (index !== undefined && index > sheets.sheetNames().length) {
    throw new XlsxOpError(op, "attributes.index", "index outside the tab range");
  }
  return [{ kind: "add_sheet", name, ...(index === undefined ? {} : { index }) }];
}

export function parseDuplicateSheet(item: Dict, op: string, sheets: XlsxSheetResolver): XlsxEditOp[] {
  const sheetName = parseStructuralTarget(item, op, sheets);
  const name = parseSheetNameValue(parseStructuralAttributes(item, op).name, op, "attributes.name");
  assertSheetNameFree(name, op, "attributes.name", sheets);
  const index = optionalSheetIndex(item, op);
  if (index !== undefined && index > sheets.sheetNames().length) {
    throw new XlsxOpError(op, "attributes.index", "index outside the tab range");
  }
  return [{ kind: "duplicate_sheet", sheetName, name, ...(index === undefined ? {} : { index }) }];
}

export function parseRenameSheet(item: Dict, op: string, sheets: XlsxSheetResolver): XlsxEditOp[] {
  const sheetName = parseStructuralTarget(item, op, sheets);
  const newName = parseSheetNameValue(parseStructuralAttributes(item, op).newName, op, "attributes.newName");
  assertSheetNameFree(newName, op, "attributes.newName", sheets, sheetName);
  return [{ kind: "rename_sheet", sheetName, newName }];
}

export function parseRemoveSheet(item: Dict, op: string, sheets: XlsxSheetResolver): XlsxEditOp[] {
  const sheetName = parseStructuralTarget(item, op, sheets);
  if (sheets.sheetNames().length <= 1) {
    throw new XlsxOpError(op, "target.sheet", "a workbook needs at least one sheet");
  }
  return [{ kind: "remove_sheet", sheetName }];
}

export function parseReorderSheet(item: Dict, op: string, sheets: XlsxSheetResolver): XlsxEditOp[] {
  const sheetName = parseStructuralTarget(item, op, sheets);
  const attributes = parseStructuralAttributes(item, op);
  const index = int(attributes.index, op, "attributes.index");
  if (index < 0 || index >= sheets.sheetNames().length) {
    throw new XlsxOpError(op, "attributes.index", "index outside the tab range");
  }
  return [{ kind: "reorder_sheet", sheetName, index }];
}

export function parseSheetHidden(item: Dict, op: string, sheets: XlsxSheetResolver): XlsxEditOp[] {
  const sheetName = parseStructuralTarget(item, op, sheets);
  const attributes = parseStructuralAttributes(item, op);
  if (typeof attributes.hidden !== "boolean") {
    throw new XlsxOpError(op, "attributes.hidden", "boolean required");
  }
  return [{ kind: "set_sheet_hidden", sheetName, hidden: attributes.hidden }];
}

