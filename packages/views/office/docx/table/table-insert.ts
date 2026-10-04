import type { Editor, JSONContent } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import { TextSelection } from "@tiptap/pm/state";
import { docxTableContext } from "./table-selection";

/** Word's hover picker caps (genoffice: 8 rows x 10 columns). */
export const MAX_TABLE_ROWS = 8;
export const MAX_TABLE_COLS = 10;

export interface DocxTableSize {
  rows: number;
  cols: number;
}

export function clampTableSize(rows: number, cols: number): DocxTableSize {
  return {
    rows: Math.min(MAX_TABLE_ROWS, Math.max(1, Math.round(rows))),
    cols: Math.min(MAX_TABLE_COLS, Math.max(1, Math.round(cols))),
  };
}

/** Word's default grid: a single 0.5pt line on every edge plus inner lines — the
 * same defaults the save path writes for a table without explicit borders. */
const BORDER_LINE = { style: "single", szEighths: 4, color: "auto" };

/** A fresh `docTable` node: full-width AutoFit window layout with the Word grid
 * borders, no table style and no docxIndex (the save plan generates its XML). */
export function buildTableContent(size: DocxTableSize): JSONContent {
  const colWidth = 100 / size.cols;
  const cell = (): JSONContent => ({ type: "docTableCell", content: [{ type: "docParagraph" }] });
  return {
    type: "docTable",
    attrs: {
      docxIndex: null,
      colWidthsPct: Array.from({ length: size.cols }, () => colWidth),
      widthPct: 100,
      tblAutoFit: "window",
      borders: {
        top: BORDER_LINE,
        bottom: BORDER_LINE,
        left: BORDER_LINE,
        right: BORDER_LINE,
        insideH: BORDER_LINE,
        insideV: BORDER_LINE,
      },
    },
    content: Array.from({ length: size.rows }, () => ({
      type: "docTableRow",
      content: Array.from({ length: size.cols }, cell),
    })),
  };
}

/** Moves the caret into the first cell at or after `from` (Word lands in the
 * inserted table's first cell, so the next keystroke types into it instead of
 * after it). `from` bounds the walk so an earlier table in the document cannot
 * steal the caret. */
export function selectFirstCell(tr: Transaction, from = 0): void {
  let cellPos = -1;
  const start = Math.max(0, Math.min(from, tr.doc.content.size));
  tr.doc.nodesBetween(start, tr.doc.content.size, (node, pos) => {
    if (cellPos >= 0) return false;
    if (node.type.name === "docTableCell" || node.type.name === "docTableHeader") {
      cellPos = pos;
      return false;
    }
    return true;
  });
  if (cellPos < 0) return;
  tr.setSelection(TextSelection.near(tr.doc.resolve(cellPos + 1)));
}

/**
 * Inserts a generated table at the caret. Refused inside an existing table:
 * the vendored renderer treats nested tables as read-only atoms (their model
 * round-trips, structure editing does not), so a top-level insert there would
 * either split the outer table or produce a table the table UI cannot reach.
 */
export function insertDocxTable(editor: Editor, rows: number, cols: number): boolean {
  if (editor.isDestroyed || !editor.isEditable) return false;
  if (docxTableContext(editor.state)) return false;
  const size = clampTableSize(rows, cols);
  const insertAt = editor.state.selection.from;
  return editor
    .chain()
    .focus()
    .insertContent(buildTableContent(size))
    .command(({ tr }) => {
      selectFirstCell(tr, insertAt);
      return true;
    })
    .run();
}
