import { Editor, type JSONContent } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import { NodeSelection } from "@tiptap/pm/state";
import { CellSelection } from "@tiptap/pm/tables";
import { afterEach, describe, expect, it } from "vitest";
import { docxExtensions } from "../docx-schema";
import { createDocxCommandRuntime, type DocxCommandRuntime } from "./index";

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
      attrs: {
        borders: { insideH: { style: "single", szEighths: 4 }, insideV: { style: "single", szEighths: 4 } },
      },
      content: [
        { type: "docTableRow", content: [cell("A1"), cell("B1")] },
        { type: "docTableRow", content: [cell("A2"), cell("B2")] },
      ],
    },
    paragraph("After"),
  ],
};

const textDocument: JSONContent = { type: "doc", content: [paragraph("Body")] };

function createEditor(content: JSONContent, editable = true): Editor {
  const editor = new Editor({ extensions: docxExtensions(), content, editable });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

function runtime(editor: Editor): DocxCommandRuntime {
  return createDocxCommandRuntime(() => editor);
}

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

function tablePositions(editor: Editor): number[] {
  const positions: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "docTable") positions.push(pos);
    return true;
  });
  return positions;
}

/** Position of the table the caret sits in, or -1 outside every table. */
function selectionTablePos(editor: Editor): number {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name === "docTable") return $from.before(depth);
  }
  return -1;
}

function cellPositions(editor: Editor): number[] {
  const positions: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "docTableCell" || node.type.name === "docTableHeader") positions.push(pos);
    return true;
  });
  return positions;
}

function caretInCell(editor: Editor, index = 0): void {
  const pos = cellPositions(editor)[index];
  if (pos === undefined) throw new Error("table cell missing");
  editor.commands.setTextSelection(pos + 1);
}

function selectCells(editor: Editor, anchor: number, head: number): void {
  const [from, to] = [cellPositions(editor)[anchor], cellPositions(editor)[head]];
  if (from === undefined || to === undefined) throw new Error("table cells missing");
  editor.view.dispatch(editor.state.tr.setSelection(new CellSelection(editor.state.doc.resolve(from + 1), editor.state.doc.resolve(to + 1))));
}

function selectionFill(editor: Editor, index = 0): unknown {
  const node = editor.state.doc.nodeAt(cellPositions(editor)[index] ?? -1);
  return node?.attrs.fill ?? null;
}

function rowCellTypes(table: PmNode, row: number): string[] {
  const types: string[] = [];
  table.child(row).forEach((cell) => {
    types.push(cell.type.name);
  });
  return types;
}

describe("table command factory", () => {
  it("wires the table area into the runtime and drops the caret into an inserted table", () => {
    const editor = createEditor(textDocument);
    const commands = runtime(editor);
    expect(commands.getState()).toMatchObject({ inTable: false, canMergeCells: false, canSplitCell: false });

    expect(commands.insertTable(3, 4)).toBe(true);
    expect(tableOf(editor).childCount).toBe(3);
    expect(tableOf(editor).firstChild?.childCount).toBe(4);
    expect(commands.getState().inTable).toBe(true);
  });

  it("clamps the picker size to the Word grid caps", () => {
    const editor = createEditor(textDocument);
    const commands = runtime(editor);
    expect(commands.insertTable(99, 99)).toBe(true);
    expect(tableOf(editor).childCount).toBe(8);
    expect(tableOf(editor).firstChild?.childCount).toBe(10);
  });

  it("refuses a second table inside an existing table", () => {
    const editor = createEditor(tableDocument);
    const commands = runtime(editor);
    caretInCell(editor);
    expect(commands.insertTable(2, 2)).toBe(false);
    expect(tableOf(editor).childCount).toBe(2);
  });

  it("adds and deletes rows and columns at the caret", () => {
    const editor = createEditor(tableDocument);
    const commands = runtime(editor);
    caretInCell(editor);

    expect(commands.addRowBelow()).toBe(true);
    expect(tableOf(editor).childCount).toBe(3);
    expect(commands.addRowAbove()).toBe(true);
    expect(tableOf(editor).childCount).toBe(4);
    expect(commands.addColumnRight()).toBe(true);
    expect(tableOf(editor).firstChild?.childCount).toBe(3);
    expect(commands.addColumnLeft()).toBe(true);
    expect(tableOf(editor).firstChild?.childCount).toBe(4);
    expect(commands.deleteRow()).toBe(true);
    expect(tableOf(editor).childCount).toBe(3);
    expect(commands.deleteColumn()).toBe(true);
    expect(tableOf(editor).firstChild?.childCount).toBe(3);
    expect(commands.deleteTable()).toBe(true);
    expect(editor.state.doc.textContent).not.toContain("A1");
  });

  it("drops a whole-table node selection into its first cell for cell commands", () => {
    const editor = createEditor(tableDocument);
    const commands = runtime(editor);
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, tablePos(editor))));
    expect(commands.getState().inTable).toBe(true);
    expect(commands.addRowBelow()).toBe(true);
    expect(tableOf(editor).childCount).toBe(3);
  });

  it("merges and splits the selected cells", () => {
    const editor = createEditor(tableDocument);
    const commands = runtime(editor);
    selectCells(editor, 0, 1);
    expect(commands.getState().canMergeCells).toBe(true);

    expect(commands.mergeCells()).toBe(true);
    expect(tableOf(editor).firstChild?.childCount).toBe(1);
    expect(tableOf(editor).firstChild?.firstChild?.attrs.colspan).toBe(2);

    caretInCell(editor);
    expect(commands.getState().canSplitCell).toBe(true);
    expect(commands.splitCell()).toBe(true);
    expect(tableOf(editor).firstChild?.childCount).toBe(2);
    expect(commands.getState().canSplitCell).toBe(false);
  });

  it("toggles the header row style option and the repeating header rows", () => {
    const editor = createEditor(tableDocument);
    const commands = runtime(editor);
    caretInCell(editor);
    expect(commands.getState()).toMatchObject({ headerRow: false, canRepeatHeaderRows: true, repeatHeaderRows: false });

    expect(commands.toggleHeaderRow()).toBe(true);
    expect(tableOf(editor).attrs.tblLook).toMatchObject({ firstRow: true });
    expect(tableOf(editor).firstChild?.firstChild?.type.name).toBe("docTableHeader");
    expect(commands.getState().headerRow).toBe(true);

    expect(commands.toggleRepeatHeaderRows()).toBe(true);
    expect(tableOf(editor).firstChild?.attrs.repeatHeader).toBe(true);
    expect(commands.getState().repeatHeaderRows).toBe(true);

    expect(commands.toggleRepeatHeaderRows()).toBe(true);
    expect(tableOf(editor).firstChild?.attrs.repeatHeader).toBe(false);

    expect(commands.toggleHeaderRow()).toBe(true);
    expect(tableOf(editor).attrs.tblLook).toMatchObject({ firstRow: false });
    expect(tableOf(editor).firstChild?.firstChild?.type.name).toBe("docTableCell");
  });

  it("flips exactly the first row's cells when toggling the header row", () => {
    const editor = createEditor(tableDocument);
    const commands = runtime(editor);
    caretInCell(editor);

    expect(commands.toggleHeaderRow()).toBe(true);
    expect(rowCellTypes(tableOf(editor), 0)).toEqual(["docTableHeader", "docTableHeader"]);
    expect(rowCellTypes(tableOf(editor), 1)).toEqual(["docTableCell", "docTableCell"]);

    expect(commands.toggleHeaderRow()).toBe(true);
    expect(rowCellTypes(tableOf(editor), 0)).toEqual(["docTableCell", "docTableCell"]);
    expect(rowCellTypes(tableOf(editor), 1)).toEqual(["docTableCell", "docTableCell"]);
  });

  it("lands the caret in the inserted table when an earlier table exists", () => {
    const editor = createEditor({
      type: "doc",
      content: [
        {
          type: "docTable",
          content: [
            { type: "docTableRow", content: [cell("X1"), cell("Y1")] },
            { type: "docTableRow", content: [cell("X2"), cell("Y2")] },
          ],
        },
        paragraph("Between"),
        paragraph("Tail"),
      ],
    });
    const commands = runtime(editor);
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);

    expect(commands.insertTable(2, 3)).toBe(true);
    const tables = tablePositions(editor);
    expect(tables).toHaveLength(2);
    expect(selectionTablePos(editor)).toBe(tables[1]);
  });

  it("refuses the repeat-header toggle when the selection starts below row 0", () => {
    const editor = createEditor(tableDocument);
    const commands = runtime(editor);
    caretInCell(editor, 2);
    expect(commands.getState().canRepeatHeaderRows).toBe(false);
    expect(commands.toggleRepeatHeaderRows()).toBe(false);
    expect(tableOf(editor).child(1).attrs.repeatHeader).toBe(false);
  });

  it("applies border presets and clearing to the selected cells", () => {
    const editor = createEditor(tableDocument);
    const commands = runtime(editor);
    caretInCell(editor);

    expect(commands.applyTableBorders("grid")).toBe(true);
    expect(cellBorder(tableOf(editor), 0, 0, "top")).toMatchObject({ style: "single" });
    expect(cellBorder(tableOf(editor), 0, 0, "right")).toMatchObject({ style: "single" });

    expect(commands.applyTableBorders("none")).toBe(true);
    expect(cellBorder(tableOf(editor), 0, 0, "top")).toMatchObject({ style: "none" });
    // "No borders" scopes to the selected cells: unselected cells keep the
    // table-level inside lines.
    expect(cellBorder(tableOf(editor), 1, 1, "top")).toBeUndefined();
    expect(tableOf(editor).attrs.borders).toMatchObject({
      insideH: { style: "single", szEighths: 4 },
      insideV: { style: "single", szEighths: 4 },
    });

    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, tablePos(editor))));
    expect(commands.applyTableBorders("none")).toBe(true);
    expect(cellBorder(tableOf(editor), 1, 1, "top")).toMatchObject({ style: "none" });
  });

  it("draws only the selection boundary for the outline preset", () => {
    const editor = createEditor(tableDocument);
    const commands = runtime(editor);
    selectCells(editor, 0, 1);
    expect(commands.applyTableBorders("outline")).toBe(true);
    const table = tableOf(editor);
    expect(cellBorder(table, 0, 0, "top")).toMatchObject({ style: "single" });
    expect(cellBorder(table, 0, 0, "left")).toMatchObject({ style: "single" });
    expect(cellBorder(table, 0, 0, "right")).toBeUndefined();
    expect(cellBorder(table, 0, 1, "right")).toMatchObject({ style: "single" });
    expect(cellBorder(table, 0, 1, "left")).toBeUndefined();
  });

  it("shades the selected cells, the whole table node selection, and clears the fill", () => {
    const editor = createEditor(tableDocument);
    const commands = runtime(editor);
    caretInCell(editor);

    expect(commands.setCellFill("D9EAF7")).toBe(true);
    expect(selectionFill(editor, 0)).toBe("D9EAF7");
    expect(selectionFill(editor, 1)).toBeNull();

    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, tablePos(editor))));
    expect(commands.setCellFill("E7E6E6")).toBe(true);
    expect(selectionFill(editor, 0)).toBe("E7E6E6");
    expect(selectionFill(editor, 3)).toBe("E7E6E6");

    caretInCell(editor);
    expect(commands.setCellFill(null)).toBe(true);
    expect(selectionFill(editor, 0)).toBeNull();
  });

  it("refuses every command on a read-only document", () => {
    const editor = createEditor(tableDocument, false);
    const commands = runtime(editor);
    caretInCell(editor);

    expect(commands.getState().inTable).toBe(true);
    expect(commands.addRowAbove()).toBe(false);
    expect(commands.addRowBelow()).toBe(false);
    expect(commands.addColumnLeft()).toBe(false);
    expect(commands.addColumnRight()).toBe(false);
    expect(commands.deleteRow()).toBe(false);
    expect(commands.deleteColumn()).toBe(false);
    expect(commands.deleteTable()).toBe(false);
    expect(commands.mergeCells()).toBe(false);
    expect(commands.splitCell()).toBe(false);
    expect(commands.toggleHeaderRow()).toBe(false);
    expect(commands.toggleRepeatHeaderRows()).toBe(false);
    expect(commands.applyTableBorders("grid")).toBe(false);
    expect(commands.setCellFill("D9EAF7")).toBe(false);
    expect(commands.insertTable(2, 2)).toBe(false);
    expect(tableOf(editor).childCount).toBe(2);
  });

  it("refuses table commands outside a table", () => {
    const editor = createEditor(textDocument);
    const commands = runtime(editor);
    expect(commands.getState()).toMatchObject({ inTable: false, canRepeatHeaderRows: false });
    expect(commands.addRowAbove()).toBe(false);
    expect(commands.deleteTable()).toBe(false);
    expect(commands.toggleHeaderRow()).toBe(false);
    expect(commands.applyTableBorders("grid")).toBe(false);
    expect(commands.setCellFill("D9EAF7")).toBe(false);
    expect(editor.state.doc.textContent).toBe("Body");
  });
});

function cellBorder(table: PmNode, row: number, column: number, side: string): Record<string, unknown> | undefined {
  const cellNode = table.child(row).child(column);
  const borders = cellNode.attrs.borders as Record<string, Record<string, unknown>> | null;
  return borders?.[side];
}
