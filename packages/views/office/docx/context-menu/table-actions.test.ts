import { Editor, type JSONContent } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import { NodeSelection } from "@tiptap/pm/state";
import { CellSelection } from "@tiptap/pm/tables";
import { afterEach, describe, expect, it } from "vitest";
import { docxExtensions } from "../docx-schema";
import {
  deleteTableColumn,
  deleteTableRow,
  insertColumnLeft,
  insertColumnRight,
  insertRowAbove,
  insertRowBelow,
  isDocxInTable,
  mergeSelectedCells,
  splitSelectedCell,
  toggleHeaderRow,
} from "./table-actions";

const editors: Editor[] = [];

const paragraph = (text: string): JSONContent => ({
  type: "docParagraph",
  content: [{ type: "text", text }],
});

const cell = (text: string): JSONContent => ({ type: "docTableCell", content: [paragraph(text)] });

const tableDocument: JSONContent = {
  type: "doc",
  content: [
    paragraph("Before"),
    {
      type: "docTable",
      content: [
        { type: "docTableRow", content: [cell("A1"), cell("B1")] },
        { type: "docTableRow", content: [cell("A2"), cell("B2")] },
      ],
    },
    paragraph("After"),
  ],
};

function createTableEditor(editable = true): Editor {
  const editor = new Editor({ extensions: docxExtensions(), content: tableDocument, editable });
  editors.push(editor);
  return editor;
}

function createTextEditor(): Editor {
  const editor = new Editor({ extensions: docxExtensions(), content: { type: "doc", content: [paragraph("Body")] } });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

function tableOf(editor: Editor): PmNode {
  let table: PmNode | null = null;
  editor.state.doc.descendants((node) => {
    if (node.type.name === "docTable") {
      table = node;
      return false;
    }
    return true;
  });
  if (!table) throw new Error("table missing");
  return table;
}

function tablePos(editor: Editor): number {
  let pos = -1;
  editor.state.doc.descendants((node, at) => {
    if (node.type.name === "docTable") {
      pos = at;
      return false;
    }
    return true;
  });
  return pos;
}

function cellPositions(editor: Editor): number[] {
  const positions: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "docTableCell") positions.push(pos);
    return true;
  });
  return positions;
}

/** The first two cells of the first row, as the merge tests need them. */
function firstTwoCells(editor: Editor): [number, number] {
  const [first, second] = cellPositions(editor);
  if (first === undefined || second === undefined) throw new Error("table cells missing");
  return [first, second];
}

function caretInFirstCell(editor: Editor): void {
  const [first] = cellPositions(editor);
  if (first === undefined) throw new Error("table cell missing");
  editor.commands.setTextSelection(first + 1);
}

function rowCount(editor: Editor): number {
  return tableOf(editor).childCount;
}

describe("table commands", () => {
  it("inserts and deletes rows and columns at the caret", () => {
    const editor = createTableEditor();
    caretInFirstCell(editor);

    expect(insertRowBelow(editor)).toBe(true);
    expect(rowCount(editor)).toBe(3);
    expect(insertRowAbove(editor)).toBe(true);
    expect(rowCount(editor)).toBe(4);

    expect(insertColumnRight(editor)).toBe(true);
    expect(tableOf(editor).firstChild?.childCount).toBe(3);
    expect(insertColumnLeft(editor)).toBe(true);
    expect(tableOf(editor).firstChild?.childCount).toBe(4);

    expect(deleteTableRow(editor)).toBe(true);
    expect(rowCount(editor)).toBe(3);
    expect(deleteTableColumn(editor)).toBe(true);
    expect(tableOf(editor).firstChild?.childCount).toBe(3);
  });

  it("merges a cell selection and splits it back", () => {
    const editor = createTableEditor();
    const [a1, b1] = firstTwoCells(editor);
    editor.view.dispatch(
      editor.state.tr.setSelection(
        new CellSelection(editor.state.doc.resolve(a1), editor.state.doc.resolve(b1)),
      ),
    );

    expect(mergeSelectedCells(editor)).toBe(true);
    const mergedRow = tableOf(editor).firstChild;
    expect(mergedRow?.childCount).toBe(1);
    expect(mergedRow?.firstChild?.attrs.colspan).toBe(2);

    expect(splitSelectedCell(editor)).toBe(true);
    expect(tableOf(editor).firstChild?.childCount).toBe(2);
    expect(tableOf(editor).firstChild?.firstChild?.attrs.colspan).toBe(1);
  });

  it("toggles the header row between header and body cells", () => {
    const editor = createTableEditor();
    caretInFirstCell(editor);
    expect(tableOf(editor).firstChild?.firstChild?.type.name).toBe("docTableCell");

    expect(toggleHeaderRow(editor)).toBe(true);
    expect(tableOf(editor).firstChild?.firstChild?.type.name).toBe("docTableHeader");

    expect(toggleHeaderRow(editor)).toBe(true);
    expect(tableOf(editor).firstChild?.firstChild?.type.name).toBe("docTableCell");
  });

  it("drops a whole-table node selection into its first cell first", () => {
    const editor = createTableEditor();
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, tablePos(editor))));
    expect(insertRowBelow(editor)).toBe(true);
    expect(rowCount(editor)).toBe(3);
  });

  it("refuses every command on a read-only document", () => {
    const editor = createTableEditor(false);
    caretInFirstCell(editor);
    expect(insertRowBelow(editor)).toBe(false);
    expect(insertRowAbove(editor)).toBe(false);
    expect(insertColumnLeft(editor)).toBe(false);
    expect(insertColumnRight(editor)).toBe(false);
    expect(deleteTableRow(editor)).toBe(false);
    expect(deleteTableColumn(editor)).toBe(false);
    expect(mergeSelectedCells(editor)).toBe(false);
    expect(splitSelectedCell(editor)).toBe(false);
    expect(toggleHeaderRow(editor)).toBe(false);
    expect(rowCount(editor)).toBe(2);
  });

  it("refuses table commands outside a table", () => {
    const editor = createTextEditor();
    expect(isDocxInTable(editor)).toBe(false);
    expect(insertRowBelow(editor)).toBe(false);
    expect(toggleHeaderRow(editor)).toBe(false);
  });

  it("reports the table context for caret and whole-table selections", () => {
    const editor = createTableEditor();
    expect(isDocxInTable(editor)).toBe(false);
    caretInFirstCell(editor);
    expect(isDocxInTable(editor)).toBe(true);
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, tablePos(editor))));
    expect(isDocxInTable(editor)).toBe(true);
  });
});
