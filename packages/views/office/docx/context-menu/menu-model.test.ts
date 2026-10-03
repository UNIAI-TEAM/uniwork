import { Editor, type JSONContent } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { CellSelection } from "@tiptap/pm/tables";
import { afterEach, describe, expect, it } from "vitest";
import { docxExtensions } from "../docx-schema";
import { buildDocxMenuSections, readDocxMenuContext, type DocxMenuContext } from "./menu-model";

const editors: Editor[] = [];

function createEditor(content: JSONContent, editable = true): Editor {
  const editor = new Editor({ extensions: docxExtensions(), content, editable });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

const paragraph = (text: string): JSONContent => ({
  type: "docParagraph",
  ...(text.length > 0 ? { content: [{ type: "text", text }] } : {}),
});

const cell = (text: string): JSONContent => ({ type: "docTableCell", content: [paragraph(text)] });

function tableEditor(editable = true): Editor {
  return createEditor(
    {
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
    },
    editable,
  );
}

function linkEditor(): Editor {
  return createEditor({
    type: "doc",
    content: [
      {
        type: "docParagraph",
        content: [
          { type: "text", text: "visit " },
          { type: "text", text: "uniwork", marks: [{ type: "link", attrs: { href: "https://uniwork.vn" } }] },
        ],
      },
    ],
  });
}

function tableNodePosition(editor: Editor): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "docTable") {
      found = pos;
      return false;
    }
    return true;
  });
  return found;
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

const context = (overrides: Partial<DocxMenuContext> = {}): DocxMenuContext => ({
  hasSelection: false,
  inTable: false,
  activeLink: null,
  readOnly: false,
  canMergeCells: false,
  canSplitCell: false,
  ...overrides,
});

const sectionIds = (ctx: DocxMenuContext) => buildDocxMenuSections(ctx).map((section) => section.id);
const itemsOf = (ctx: DocxMenuContext, sectionId: "clipboard" | "table" | "link") =>
  buildDocxMenuSections(ctx).find((section) => section.id === sectionId)?.items ?? [];
const itemById = (ctx: DocxMenuContext, id: string) => itemsOf(ctx, "clipboard").concat(itemsOf(ctx, "table"), itemsOf(ctx, "link")).find((item) => item.id === id);

describe("readDocxMenuContext", () => {
  it("reads an unopened editor as an empty read-only context", () => {
    expect(readDocxMenuContext(null, false)).toEqual(context());
    expect(readDocxMenuContext(null, true)).toEqual(context({ readOnly: true }));
  });

  it("reports selection, table and link state from the live editor", () => {
    const editor = createEditor({ type: "doc", content: [paragraph("Body text")] });
    expect(readDocxMenuContext(editor, false)).toMatchObject({ hasSelection: false, inTable: false, activeLink: null });

    editor.commands.setTextSelection({ from: 1, to: 5 });
    expect(readDocxMenuContext(editor, false)).toMatchObject({ hasSelection: true, inTable: false, activeLink: null });
  });

  it("reports a caret inside a table, with merge and split availability", () => {
    const editor = tableEditor();
    const [a1, b1] = firstTwoCells(editor);
    editor.commands.setTextSelection(a1 + 1);
    const inCell = readDocxMenuContext(editor, false);
    expect(inCell.inTable).toBe(true);
    expect(inCell.canMergeCells).toBe(false);
    expect(inCell.canSplitCell).toBe(false);

    editor.view.dispatch(
      editor.state.tr.setSelection(
        new CellSelection(editor.state.doc.resolve(a1 + 1), editor.state.doc.resolve(b1 + 1)),
      ),
    );
    expect(readDocxMenuContext(editor, false).canMergeCells).toBe(true);
  });

  it("keeps the whole-table node selection inside the table context", () => {
    const editor = tableEditor();
    const tablePos = tableNodePosition(editor);
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, tablePos)));
    expect(readDocxMenuContext(editor, false).inTable).toBe(true);
  });

  it("reports the link under the caret", () => {
    const editor = linkEditor();
    editor.commands.setTextSelection(10);
    const active = readDocxMenuContext(editor, false).activeLink;
    expect(active?.href).toBe("https://uniwork.vn");
    expect(active?.text).toBe("uniwork");

    editor.commands.setTextSelection(2);
    expect(readDocxMenuContext(editor, false).activeLink).toBeNull();
  });

  it("passes the host read-only flag through", () => {
    const editor = createEditor({ type: "doc", content: [paragraph("Body")] });
    expect(readDocxMenuContext(editor, true).readOnly).toBe(true);
  });
});

describe("buildDocxMenuSections", () => {
  it("keeps the clipboard verbs and gates mutations on read-only", () => {
    const editable = context({ hasSelection: true });
    expect(itemsOf(editable, "clipboard").map((item) => item.id)).toEqual([
      "cut",
      "copy",
      "paste",
      "pastePlain",
      "selectAll",
    ]);
    expect(itemById(editable, "cut")?.enabled).toBe(true);
    expect(itemById(editable, "copy")?.enabled).toBe(true);
    expect(itemById(editable, "paste")?.enabled).toBe(true);
    expect(itemById(editable, "selectAll")?.enabled).toBe(true);
    expect(sectionIds(editable)).toEqual(["clipboard"]);

    const readOnly = context({ hasSelection: true, readOnly: true });
    expect(itemById(readOnly, "cut")?.enabled).toBe(false);
    expect(itemById(readOnly, "copy")?.enabled).toBe(true);
    expect(itemById(readOnly, "paste")?.enabled).toBe(false);
    expect(itemById(readOnly, "pastePlain")?.enabled).toBe(false);
    expect(itemById(readOnly, "selectAll")?.enabled).toBe(true);

    const emptyReadOnly = context({ readOnly: true });
    expect(itemById(emptyReadOnly, "copy")?.enabled).toBe(false);
    expect(itemById(emptyReadOnly, "cut")?.enabled).toBe(false);
  });

  it("adds the table section only inside a table, with merge and split following their predicates", () => {
    const inTable = context({ inTable: true, canMergeCells: true, canSplitCell: false });
    expect(sectionIds(inTable)).toEqual(["clipboard", "table"]);
    expect(itemsOf(inTable, "table").map((item) => item.id)).toEqual([
      "insertRowAbove",
      "insertRowBelow",
      "insertColumnLeft",
      "insertColumnRight",
      "deleteRow",
      "deleteColumn",
      "mergeCells",
      "splitCell",
      "toggleHeaderRow",
    ]);
    expect(itemById(inTable, "mergeCells")?.enabled).toBe(true);
    expect(itemById(inTable, "splitCell")?.enabled).toBe(false);
    expect(itemById(inTable, "insertRowBelow")?.enabled).toBe(true);

    const readOnly = context({ inTable: true, canMergeCells: true, canSplitCell: true, readOnly: true });
    expect(itemsOf(readOnly, "table").every((item) => !item.enabled)).toBe(true);
  });

  it("adds the link section only with an active link, keeping open and copy reachable read-only", () => {
    const activeLink = { from: 7, to: 14, href: "https://uniwork.vn", rId: null, text: "uniwork", tooltip: null };
    const editable = context({ activeLink });
    expect(sectionIds(editable)).toEqual(["clipboard", "link"]);
    expect(itemsOf(editable, "link").map((item) => item.id)).toEqual(["openLink", "copyLink", "editLink", "removeLink"]);
    expect(itemsOf(editable, "link").every((item) => item.enabled)).toBe(true);

    const readOnly = context({ activeLink, readOnly: true });
    expect(itemById(readOnly, "openLink")?.enabled).toBe(true);
    expect(itemById(readOnly, "copyLink")?.enabled).toBe(true);
    expect(itemById(readOnly, "editLink")?.enabled).toBe(false);
    expect(itemById(readOnly, "removeLink")?.enabled).toBe(false);
  });

  it("uses the links module's existing labels for link items", () => {
    const activeLink = { from: 7, to: 14, href: "https://uniwork.vn", rId: null, text: "uniwork", tooltip: null };
    expect(itemById(context({ activeLink }), "removeLink")?.labelKey).toBe("office.docx.links.remove");
    expect(itemById(context({ activeLink }), "openLink")?.labelKey).toBe("office.docx.links.open");
  });
});
