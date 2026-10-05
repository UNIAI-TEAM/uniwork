// XLSX table state (B9, UNI-926): the typed table ops the envelope carries and
// the fold into the gateway's `tableAdditions` argument. The wire parser
// lives in ops-tables.ts (it needs the shared target/attributes helpers).
//
// A table is a NEW workbook part written on save (xl/tables/tableN.xml, the
// worksheet <tableParts> element and its relationship). Unlike
// filter/page-setup the state is a LIST of additions pinned to final
// coordinates at emission time, not a per-sheet snapshot.
//
// Gateway limits (honest): the vendored buildTableXml hardcodes
// totalsRowShown="0" with no <totalsRow>, and always treats the range's first
// row as the header. So a total row is not writable and a header-less table is
// not expressible; the parser refuses both rather than dropping them silently.
// remove_table only cancels a table created EARLIER IN THE SAME SESSION (the
// gateway has no table-removal write path; a file-native table stays
// view-only), matching the renderer journal's removeTableAdd.
import type { XlsxEditOp } from "./ops-shared.ts";

/** One table addition: the gateway's SheetTableAddition minus the sheet name
 *  the envelope target carries. `area` is 0-based and header-inclusive. */
export interface XlsxTableAddOp {
  readonly kind: "create_table";
  readonly sheetName: string;
  readonly area: { readonly startRow: number; readonly startColumn: number; readonly endRow: number; readonly endColumn: number };
  readonly name: string;
  readonly columnNames: readonly string[];
  readonly style?: string | undefined;
  readonly bandedRows: boolean;
}

/** Cancels an earlier create_table of the same name this session. */
export interface XlsxTableRemoveOp {
  readonly kind: "remove_table";
  readonly sheetName: string;
  readonly name: string;
}

/** The gateway's SheetTableAddition (xlsx-gateway.ts), the shape of the
 *  `tableAdditions` argument. */
export interface XlsxSheetTableAddition {
  readonly sheetName: string;
  readonly area: XlsxTableAddOp["area"];
  readonly name: string;
  readonly columnNames: readonly string[];
  readonly style?: string | undefined;
  readonly bandedRows: boolean;
}

export const TABLE_OP_KIND = "create_table";
export const TABLE_REMOVE_OP_KIND = "remove_table";

export function isXlsxTableAddOp(op: XlsxEditOp): op is XlsxTableAddOp {
  return op.kind === TABLE_OP_KIND;
}

export function isXlsxTableRemoveOp(op: XlsxEditOp): op is XlsxTableRemoveOp {
  return op.kind === TABLE_REMOVE_OP_KIND;
}

export function isXlsxTableOp(op: XlsxEditOp): op is XlsxTableAddOp | XlsxTableRemoveOp {
  return op.kind === TABLE_OP_KIND || op.kind === TABLE_REMOVE_OP_KIND;
}

/** Fold table ops into the gateway's list, in emission order: create_table
 *  appends, remove_table drops the matching pending add (case-insensitive on
 *  the table name, like Excel). Empty when the session has no table edits. */
export function groupXlsxTableAdditions(ops: readonly XlsxEditOp[]): XlsxSheetTableAddition[] {
  const out: XlsxSheetTableAddition[] = [];
  for (const op of ops) {
    if (isXlsxTableAddOp(op)) {
      out.push({
        sheetName: op.sheetName,
        area: { ...op.area },
        name: op.name,
        columnNames: [...op.columnNames],
        ...(op.style === undefined ? {} : { style: op.style }),
        bandedRows: op.bandedRows,
      });
      continue;
    }
    if (isXlsxTableRemoveOp(op)) {
      const needle = op.name.toLowerCase();
      const index = out.findIndex((table) => table.sheetName === op.sheetName && table.name.toLowerCase() === needle);
      if (index >= 0) out.splice(index, 1);
    }
  }
  return out;
}
