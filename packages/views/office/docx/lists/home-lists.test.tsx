// B5 (UNI-924): the Home tab's list group — the gallery applies presets, the
// multilevel menu sets levels and restarts/continues the caret's list; both
// are disabled while read-only or outside a list where an action needs one.
import { Editor, type JSONContent } from "@tiptap/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocxNumberingDef } from "@uniwork/office-engine/docx";
import { createDocxCommandRuntime, type DocxCommandRuntime } from "../commands";
import { docxExtensions } from "../docx-schema";
import type { DocxToolbarGroupContext } from "../toolbar/types";
import { HomeListsGroup } from "./home-lists";

const editors: Editor[] = [];

const DEF7: DocxNumberingDef = {
  numId: "7",
  abstractNumId: "0",
  levels: { 0: { numFmt: "decimal", lvlText: "%1." }, 1: { numFmt: "decimal", lvlText: "%1.%2." } },
  startOverrides: {},
};

function paragraph(text: string): JSONContent {
  return { type: "docParagraph", attrs: { docxIndex: 0 }, content: [{ type: "text", text }] };
}

function listItem(text: string, attrs: Record<string, unknown> = {}): JSONContent {
  return {
    type: "docListItem",
    attrs: { docxIndex: 0, kind: "ordered", numId: "7", ilvl: 0, ...attrs },
    content: [{ type: "text", text }],
  };
}

function editorWith(content: JSONContent[], defs: DocxNumberingDef[] = []): Editor {
  const numbering = new Map(defs.map((def) => [def.numId, def]));
  const editor = new Editor({ extensions: docxExtensions(numbering), content: { type: "doc", content } });
  editors.push(editor);
  return editor;
}

function blockAt(editor: Editor, index = 0) {
  return editor.state.doc.child(index);
}

function attrsAt(editor: Editor, index = 0): Record<string, unknown> {
  return blockAt(editor, index).attrs as Record<string, unknown>;
}

function caretInBlock(editor: Editor, index = 0): void {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += blockAt(editor, i).nodeSize;
  editor.commands.setTextSelection(pos + 2);
}

function context(overrides: Partial<DocxToolbarGroupContext> = {}): DocxToolbarGroupContext {
  const coordinatorState = {
    state: "dirty" as const,
    identity: {
      deploymentId: "dep",
      accountId: "account",
      organizationId: "org",
      workspaceId: "workspace",
      documentId: "doc",
      generation: 1,
      baseVersionId: "version",
      baseRevision: "1",
    },
    dirtyGeneration: 1,
    lastSavedGeneration: 0,
    activeIntentId: null,
    error: null,
  };
  return {
    editor: {
      format: "docx",
      open: vi.fn(async () => undefined),
      getDirtyGeneration: () => 0,
      captureSnapshot: vi.fn(async () => ({ generation: 0, fingerprint: "fp", value: {} })),
      dispose: vi.fn(),
    },
    coordinator: {
      getState: () => coordinatorState,
      subscribe: () => () => undefined,
      save: vi.fn(async () => ({ accepted: false as const, reason: "clean" as const })),
    },
    format: null,
    selection: null,
    readOnly: false,
    saving: false,
    dirty: false,
    canUndo: true,
    canRedo: true,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onSave: vi.fn(),
    ...overrides,
  };
}

function renderGroup(
  options: {
    readOnly?: boolean;
    commands?: DocxCommandRuntime;
    content?: JSONContent[];
    defs?: DocxNumberingDef[];
    caret?: (editor: Editor) => void;
  } = {},
) {
  const editor = editorWith(options.content ?? [paragraph("hello world")], options.defs ?? []);
  const runtime = createDocxCommandRuntime(() => editor);
  if (options.caret) options.caret(editor);
  else editor.commands.setTextSelection(2);
  const format = runtime.getState() as DocxToolbarGroupContext["format"];
  const commands = "commands" in options ? options.commands : runtime;
  render(<HomeListsGroup {...context({ commands, format, readOnly: options.readOnly ?? false })} />);
  return { editor, runtime };
}

async function openGallery(): Promise<void> {
  fireEvent.click(screen.getByTestId("docx-list-gallery"));
  await screen.findByTestId("docx-list-preset-multilevel-decimal");
}

async function openMultilevel(): Promise<void> {
  fireEvent.click(screen.getByTestId("docx-list-multilevel"));
  await screen.findByTestId("docx-list-level-0");
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  vi.restoreAllMocks();
});

describe("HomeListsGroup", () => {
  it("opens the multilevel menu in the real Base UI tree without throwing (B-1)", async () => {
    // Regression for visual B-1: the group label used to render outside any
    // Menu.Group, so opening the menu in real Chrome threw
    // `MenuGroupContext is missing` and unmounted the page. This exercises the
    // real @uniwork/ui dropdown primitive (no mock) and asserts the labelled
    // radio rows are reachable.
    renderGroup({ content: [listItem("one")], defs: [DEF7], caret: (e) => caretInBlock(e) });
    fireEvent.click(screen.getByTestId("docx-list-multilevel"));
    expect(await screen.findByTestId("docx-list-level-0")).toBeInTheDocument();
    expect(screen.getByText("Cấp danh sách")).toBeInTheDocument();
  });

  it("names both triggers", () => {
    renderGroup();
    expect(screen.getByTestId("docx-list-gallery")).toHaveAccessibleName("Kiểu danh sách");
    expect(screen.getByTestId("docx-list-multilevel")).toHaveAccessibleName("Danh sách nhiều cấp");
  });

  it("disables both triggers while read-only", () => {
    renderGroup({ readOnly: true });
    expect(screen.getByTestId("docx-list-gallery")).toBeDisabled();
    expect(screen.getByTestId("docx-list-multilevel")).toBeDisabled();
  });

  it("disables both triggers without a command runtime", () => {
    renderGroup({ commands: undefined });
    expect(screen.getByTestId("docx-list-gallery")).toBeDisabled();
    expect(screen.getByTestId("docx-list-multilevel")).toBeDisabled();
  });

  it("shows the three libraries and applies a multilevel preset", async () => {
    const { editor } = renderGroup({ content: [paragraph("one"), paragraph("two")] });
    await openGallery();
    expect(screen.getByTestId("docx-list-preset-bullet-dot")).toBeInTheDocument();
    expect(screen.getByTestId("docx-list-preset-number-roman-dot")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("docx-list-preset-multilevel-decimal"));
    expect(blockAt(editor).type.name).toBe("docListItem");
    expect(attrsAt(editor)).toMatchObject({ kind: "ordered", numId: "3", ilvl: 0 });
  });

  it("picks the caret's level from the multilevel menu", async () => {
    const { editor } = renderGroup({ content: [listItem("one")], defs: [DEF7], caret: (e) => caretInBlock(e) });
    await openMultilevel();
    fireEvent.click(screen.getByTestId("docx-list-level-2"));
    expect(attrsAt(editor).ilvl).toBe(2);
  });

  it("steps the level up and down from the menu", async () => {
    const { editor } = renderGroup({ content: [listItem("one")], defs: [DEF7], caret: (e) => caretInBlock(e) });
    await openMultilevel();
    fireEvent.click(screen.getByTestId("docx-list-level-increase"));
    expect(attrsAt(editor).ilvl).toBe(1);
    await openMultilevel();
    fireEvent.click(screen.getByTestId("docx-list-level-decrease"));
    expect(attrsAt(editor).ilvl).toBe(0);
  });

  it("restarts and continues numbering from the menu", async () => {
    const { editor } = renderGroup({
      content: [listItem("one"), listItem("two", { numId: "9" })],
      defs: [DEF7],
      caret: (e) => caretInBlock(e, 1),
    });
    await openMultilevel();
    fireEvent.click(screen.getByTestId("docx-list-continue"));
    expect(attrsAt(editor, 1).numId).toBe("7");

    await openMultilevel();
    fireEvent.click(screen.getByTestId("docx-list-restart"));
    expect(attrsAt(editor, 1).numId).toBe("8");
    expect(attrsAt(editor, 0).numId).toBe("7");
  });

  it("disables the list-only rows outside a list item", async () => {
    renderGroup({ content: [paragraph("hello")] });
    await openMultilevel();
    // Base UI's menu rows are role=menuitem/menuitemradio divs: they signal
    // unavailability with aria-disabled, not the disabled attribute.
    expect(screen.getByTestId("docx-list-level-0")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("docx-list-level-increase")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("docx-list-restart")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("docx-list-continue")).toHaveAttribute("aria-disabled", "true");
  });
});
