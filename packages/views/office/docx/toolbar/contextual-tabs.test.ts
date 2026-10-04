import { Editor, type JSONContent } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDocxCommandRuntime } from "../commands";
import { docxExtensions } from "../docx-schema";
import { publishDocxEditor } from "../editor-store";
import { insertDocxShape } from "../shapes/docx-shape-actions";
import { buildDocxContextualTabs, isSelectionInTable, selectedNodeKind } from "./contextual-tabs";
import type { DocxToolbarGroupContext } from "./types";

const editors: Editor[] = [];

const paragraph = (text: string): JSONContent => ({ type: "docParagraph", content: [{ type: "text", text }] });
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


const imageDocument: JSONContent = {
  type: "doc",
  content: [
    paragraph("Before"),
    {
      type: "docProtected",
      attrs: {
        docxIndex: null,
        blockType: "image",
        label: "Picture",
        imageDataUrl: "data:image/png;base64,AAAA",
        imageWidthPx: 100,
        imageHeightPx: 50,
      },
    },
    paragraph("After"),
  ],
};

function createEditor(content: JSONContent, editable = true): Editor {
  const editor = new Editor({ extensions: docxExtensions(), content, editable });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  publishDocxEditor(null);
  for (const editor of editors.splice(0)) editor.destroy();
});

function context(editor: Editor): DocxToolbarGroupContext {
  const runtime = createDocxCommandRuntime(() => editor);
  return {
    editor: {
      format: "docx",
      open: vi.fn(async () => undefined),
      getDirtyGeneration: () => 0,
      captureSnapshot: vi.fn(async () => ({ generation: 0, fingerprint: "fp", value: {} })),
      dispose: vi.fn(),
    },
    coordinator: {
      getState: () => ({ state: "dirty" }) as never,
      subscribe: () => () => undefined,
      save: vi.fn(async () => ({ accepted: false as const, reason: "clean" as const })),
    },
    format: runtime.getState(),
    commands: runtime,
    selection: null,
    readOnly: false,
    saving: false,
    dirty: false,
    canUndo: true,
    canRedo: true,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onSave: vi.fn(),
  };
}

function positions(editor: Editor, name: string): number[] {
  const found: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === name) found.push(pos);
    return true;
  });
  return found;
}

function caretInFirstCell(editor: Editor): void {
  const [first] = positions(editor, "docTableCell");
  if (first === undefined) throw new Error("table cell missing");
  editor.commands.setTextSelection(first + 1);
}

function tabById(tabs: ReturnType<typeof buildDocxContextualTabs>, id: string) {
  const tab = tabs.find((entry) => entry.id === id);
  if (!tab) throw new Error(`tab ${id} missing`);
  return tab;
}

describe("selection detection", () => {
  it("reports a caret inside a table, and not a plain paragraph", () => {
    const editor = createEditor(tableDocument);
    expect(isSelectionInTable(editor)).toBe(false);
    caretInFirstCell(editor);
    expect(isSelectionInTable(editor)).toBe(true);
    expect(isSelectionInTable(createEditor({ type: "doc", content: [paragraph("Body")] }))).toBe(false);
    expect(isSelectionInTable(null)).toBe(false);
  });

  it("reads the selected protected node kind", () => {
    const image = createEditor(imageDocument);
    expect(selectedNodeKind(image)).toBe(null);
    const [imagePos] = positions(image, "docProtected");
    image.view.dispatch(image.state.tr.setSelection(NodeSelection.create(image.state.doc, imagePos!)));
    expect(selectedNodeKind(image)).toBe("image");
    expect(selectedNodeKind(createEditor(tableDocument))).toBe(null);
    expect(selectedNodeKind(null)).toBe(null);
  });
});

describe("buildDocxContextualTabs", () => {
  it("exposes the two table tabs with when:true while the caret is in a table", () => {
    const editor = createEditor(tableDocument);
    caretInFirstCell(editor);
    publishDocxEditor(editor);

    const tabs = buildDocxContextualTabs(context(editor));
    const design = tabById(tabs, "table-design");
    const layout = tabById(tabs, "table-layout");

    expect(design.contextual).toEqual({ when: true, accent: "brand" });
    expect(layout.contextual).toEqual({ when: true, accent: "brand" });
    expect(design.labelKey).toBe("office.docx.toolbar.tabTableDesign");
    expect(layout.labelKey).toBe("office.docx.toolbar.tabTableLayout");
    expect(design.groups.length).toBeGreaterThan(0);
    expect(layout.groups.length).toBeGreaterThan(0);
    // The picture and shape tabs stay hidden for a table selection.
    expect(tabById(tabs, "picture-format").contextual?.when).toBe(false);
    expect(tabById(tabs, "shape-format").contextual?.when).toBe(false);
  });

  it("exposes no contextual tab for a caret in a plain paragraph", () => {
    const editor = createEditor({ type: "doc", content: [paragraph("Body")] });
    editor.commands.setTextSelection(2);
    publishDocxEditor(editor);

    for (const tab of buildDocxContextualTabs(context(editor))) {
      expect(tab.contextual?.when).toBe(false);
    }
  });

  it("exposes Picture Format with its accent and labelKey for a selected image", () => {
    const editor = createEditor(imageDocument);
    const [imagePos] = positions(editor, "docProtected");
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, imagePos!)));
    publishDocxEditor(editor);

    const tabs = buildDocxContextualTabs(context(editor));
    const picture = tabById(tabs, "picture-format");
    expect(picture.contextual).toEqual({ when: true, accent: "info" });
    expect(picture.labelKey).toBe("office.docx.toolbar.tabPictureFormat");
    expect(picture.groups.length).toBeGreaterThan(0);
    expect(tabById(tabs, "table-design").contextual?.when).toBe(false);
    expect(tabById(tabs, "shape-format").contextual?.when).toBe(false);
  });

  it("exposes Shape Format for a selected shape and never force-switches a tab", () => {
    const editor = createEditor({ type: "doc", content: [paragraph("")] });
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    expect(insertDocxShape(editor, "rect", "Rectangle")).toBe(true);
    const [shapePos] = positions(editor, "docProtected");
    editor.commands.setNodeSelection(shapePos!);
    publishDocxEditor(editor);

    const tabs = buildDocxContextualTabs(context(editor));
    const shape = tabById(tabs, "shape-format");
    expect(shape.contextual).toEqual({ when: true, accent: "info" });
    expect(shape.labelKey).toBe("office.docx.toolbar.tabShapeFormat");
    // Nothing here selects a tab: the contextual tabs only declare when/accent.
    expect(shape).not.toHaveProperty("active");
  });

  it("keeps every contextual tab hidden without a live editor", () => {
    publishDocxEditor(null);
    for (const tab of buildDocxContextualTabs(context(createEditor({ type: "doc", content: [paragraph("x")] })))) {
      expect(tab.contextual?.when).toBe(false);
    }
  });
});
