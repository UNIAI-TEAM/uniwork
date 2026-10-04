import { Editor, type JSONContent } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it, vi } from "vitest";
import enDict from "@uniwork/core/i18n/locales/en.json";
import viDict from "@uniwork/core/i18n/locales/vi.json";
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

function lookup(dictionary: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((value, part) => {
    if (value === null || typeof value !== "object") return undefined;
    return (value as Record<string, unknown>)[part];
  }, dictionary);
}

/** Every labelKey the contextual tabs can render, from groups and menu entries. */
function labelKeys(tabs: ReturnType<typeof buildDocxContextualTabs>): string[] {
  const keys: string[] = [];
  for (const tab of tabs) {
    keys.push(tab.labelKey);
    for (const group of tab.groups) {
      keys.push(group.labelKey);
      for (const item of group.items) {
        keys.push(item.labelKey);
        if (item.kind === "dropdown" || item.kind === "split") keys.push(...item.menu.map((entry) => entry.labelKey));
      }
    }
  }
  return keys;
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

describe("label keys resolve and never render a raw placeholder", () => {
  /** Every contextual tab forced visible, so every labelKey is collected. */
  function allTabs() {
    const editor = createEditor(tableDocument);
    caretInFirstCell(editor);
    publishDocxEditor(editor);
    return buildDocxContextualTabs(context(editor));
  }

  it("uses the real paragraph align keys on the table-layout align group", () => {
    const layout = tabById(allTabs(), "table-layout");
    const align = layout.groups.find((group) => group.id === "table-layout-align");
    expect(align).toBeDefined();
    expect(align!.items.map((item) => item.labelKey)).toEqual([
      "office.docx.toolbar.paragraph.alignLeft",
      "office.docx.toolbar.paragraph.alignCenter",
      "office.docx.toolbar.paragraph.alignRight",
    ]);
  });

  it("resolves every labelKey in both en.json and vi.json", () => {
    const missing = labelKeys(allTabs()).filter(
      (key) => typeof lookup(enDict, key) !== "string" || typeof lookup(viDict, key) !== "string",
    );
    expect(missing).toEqual([]);
  });

  it("never points a labelKey at a string carrying an uninterpolated {{var}}", () => {
    // RibbonMenuEntry has only labelKey and the ribbon renders t(labelKey) with
    // no vars, so any {{...}} in a referenced value would show verbatim.
    const withVars = labelKeys(allTabs()).filter((key) => /\{\{/.test(String(lookup(enDict, key))));
    expect(withVars).toEqual([]);
  });

  it("gives the shading/fill/outline menus per-colour plain labels", () => {
    const tabs = allTabs();
    const swatchKeys = (tabId: string, itemId: string): string[] => {
      const group = tabById(tabs, tabId).groups.find((entry) =>
        entry.items.some((item) => item.id === itemId),
      );
      if (!group) throw new Error(`group for ${itemId} missing`);
      const item = group.items.find((entry) => entry.id === itemId);
      if (!item || item.kind !== "dropdown") throw new Error(`${itemId} is not a dropdown`);
      return item.menu.map((entry) => entry.labelKey);
    };
    expect(swatchKeys("table-design", "table-design-shading-menu")).toContain("office.docx.toolbar.contextual.swatch.lightBlue");
    expect(swatchKeys("shape-format", "shape-format-fill-menu")).toContain("office.docx.toolbar.contextual.swatch.lightBlue");
    expect(swatchKeys("shape-format", "shape-format-outline-menu")).toContain("office.docx.toolbar.contextual.swatch.lightBlue");
    for (const key of [
      ...swatchKeys("table-design", "table-design-shading-menu"),
      ...swatchKeys("shape-format", "shape-format-fill-menu"),
      ...swatchKeys("shape-format", "shape-format-outline-menu"),
    ]) {
      expect(key).not.toBe("office.docx.toolbar.contextual.colorSwatch");
      expect(String(lookup(enDict, key))).not.toContain("{{");
    }
  });
});
