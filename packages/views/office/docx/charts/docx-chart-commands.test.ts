// B8 (UNI-924): editor-side chart insertion against a real TipTap document
// with the vendored schema, plus the command-area factory the toolbar reads.
import { Editor, type JSONContent } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";
import { createChartCommands } from "../commands/charts";
import { docxExtensions } from "../docx-schema";
import { createDocxChartEditing, type DocxChartInsertSpec } from "./docx-chart-commands";
import { chartDisplayFromSpec, chartDraftToSpec, emptyDocxChartDraft } from "./docx-chart-model";

const editors: Editor[] = [];

function editorWith(content: JSONContent[], editable = true): Editor {
  const editor = new Editor({ extensions: docxExtensions(), content: { type: "doc", content }, editable });
  editors.push(editor);
  return editor;
}

function paragraph(text = ""): JSONContent {
  return { type: "docParagraph", attrs: { docxIndex: 0 }, content: text === "" ? [] : [{ type: "text", text }] };
}

const TABLE: JSONContent = {
  type: "docProtected",
  attrs: {
    docxIndex: 0,
    blockType: "table",
    table: {
      rows: [
        [{ paras: [""] }, { paras: ["Bắc"] }, { paras: ["Nam"] }],
        [{ paras: ["Q1"] }, { paras: ["1"] }, { paras: ["3"] }],
        [{ paras: ["Q2"] }, { paras: ["2"] }, { paras: ["x"] }],
      ],
    },
  },
};

const SPEC = chartDraftToSpec({
  kind: "bar",
  title: "Doanh thu",
  categories: ["Q1", "Q2"],
  series: [{ name: "Bắc", values: [1, 2] }],
})!;

function insertSpec(label = "Biểu đồ"): DocxChartInsertSpec {
  return { chart: SPEC, display: chartDisplayFromSpec(SPEC), label };
}

function protectedNodes(editor: Editor): Array<{ attrs: Record<string, unknown>; pos: number }> {
  const out: Array<{ attrs: Record<string, unknown>; pos: number }> = [];
  editor.state.doc.forEach((node, offset) => {
    if (node.type.name === "docProtected") out.push({ attrs: node.attrs as Record<string, unknown>, pos: offset });
  });
  return out;
}

function selectNode(editor: Editor, pos: number): void {
  editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)));
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

describe("createDocxChartEditing.insert", () => {
  it("writes the chart node with spec + display and leaves a text caret", () => {
    const editor = editorWith([paragraph()]);
    const editing = createDocxChartEditing(() => editor);
    expect(editing.canInsert()).toBe(true);
    expect(editing.insert(insertSpec())).toBe(true);
    const charts = protectedNodes(editor).filter((node) => node.attrs.blockType === "chart");
    expect(charts).toHaveLength(1);
    expect(charts[0]!.attrs.genChart).toEqual(SPEC);
    expect(charts[0]!.attrs.chartDisplay).toMatchObject({
      partPath: "",
      kind: "bar",
      title: "Doanh thu",
      widthPx: 560,
      heightPx: 262,
    });
    // the caret sits in a textblock: a keystroke cannot replace the chart
    expect(editor.state.selection.$from.parent.isTextblock).toBe(true);
  });

  it("lands after a selected node instead of replacing it", () => {
    const editor = editorWith([TABLE, paragraph("x")]);
    const editing = createDocxChartEditing(() => editor);
    selectNode(editor, protectedNodes(editor)[0]!.pos);
    expect(editing.insert(insertSpec())).toBe(true);
    expect(protectedNodes(editor).map((node) => node.attrs.blockType)).toEqual(["table", "chart"]);
  });

  it("refuses a read-only document without touching it", () => {
    const editor = editorWith([paragraph()], false);
    const editing = createDocxChartEditing(() => editor);
    expect(editing.canInsert()).toBe(false);
    expect(editing.insert(insertSpec())).toBe(false);
    expect(protectedNodes(editor)).toHaveLength(0);
  });
});

describe("createDocxChartEditing.readSelectedTable", () => {
  it("reads the selected table as series/categories", () => {
    const editor = editorWith([TABLE, paragraph("x")]);
    const editing = createDocxChartEditing(() => editor);
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    expect(editing.readSelectedTable()).toBeNull();
    selectNode(editor, protectedNodes(editor)[0]!.pos);
    expect(editing.readSelectedTable()).toEqual({
      categories: ["Q1", "Q2"],
      series: [
        { name: "Bắc", values: [1, 2] },
        { name: "Nam", values: [3, null] },
      ],
    });
  });

  it("returns null for a caret, an image node and an unusable table", () => {
    const editor = editorWith([
      { type: "docProtected", attrs: { docxIndex: 0, blockType: "image" } },
      paragraph("x"),
    ]);
    const editing = createDocxChartEditing(() => editor);
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    expect(editing.readSelectedTable()).toBeNull();
    selectNode(editor, protectedNodes(editor)[0]!.pos);
    expect(editing.readSelectedTable()).toBeNull();

    const singleRow = editorWith([{ type: "docProtected", attrs: { docxIndex: 0, blockType: "table", table: { rows: [[{ paras: [""] }, { paras: ["S"] }]] } } }]);
    const single = createDocxChartEditing(() => singleRow);
    selectNode(singleRow, protectedNodes(singleRow)[0]!.pos);
    expect(single.readSelectedTable()).toBeNull();
  });
});

describe("createChartCommands", () => {
  it("publishes the flow and mirrors the selected table into the format state", () => {
    const editor = editorWith([TABLE, paragraph("x")]);
    const area = createChartCommands({ getEditor: () => editor });
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    expect(area.commands.canInsertDocxChart()).toBe(true);
    expect(area.commands.readDocxChartTable()).toBeNull();
    expect(area.readState(editor)).toEqual({ docxChartTableReady: false });

    selectNode(editor, protectedNodes(editor)[0]!.pos);
    expect(area.readState(editor)).toEqual({ docxChartTableReady: true });
    expect(area.commands.readDocxChartTable()?.categories).toEqual(["Q1", "Q2"]);

    expect(area.commands.insertDocxChart(insertSpec())).toBe(true);
    expect(protectedNodes(editor).filter((node) => node.attrs.blockType === "chart")).toHaveLength(1);
  });

  it("keeps an empty draft uninsertable through the model", () => {
    expect(chartDraftToSpec(emptyDocxChartDraft())).toBeNull();
  });
});
