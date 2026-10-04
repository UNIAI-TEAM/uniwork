import { Editor, type JSONContent } from "@tiptap/core";
import { CellSelection } from "@tiptap/pm/tables";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDocxCommandRuntime, type DocxCommandRuntime } from "../commands";
import { docxExtensions } from "../docx-schema";
import { HomeStylesGroup } from "../toolbar/groups/home-styles";
import type { DocxToolbarGroupContext } from "../toolbar/types";
import type { DocxGalleryStyleId } from "./styles-gallery";

const editors: Editor[] = [];

function paragraph(text: string): JSONContent {
  return { type: "docParagraph", attrs: { docxIndex: 0 }, content: [{ type: "text", text }] };
}

function cell(text: string): JSONContent {
  return { type: "docTableCell", content: [paragraph(text)] };
}

function tableContent(...cells: string[]): JSONContent[] {
  return [
    paragraph("outside"),
    { type: "docTable", content: [{ type: "docTableRow", content: cells.map(cell) }] },
  ];
}

function editorWith(content: JSONContent[]): Editor {
  const editor = new Editor({ extensions: docxExtensions(), content: { type: "doc", content } });
  editors.push(editor);
  return editor;
}

function paragraphPos(editor: Editor, text: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found === -1 && node.type.name === "docParagraph" && node.textContent === text) found = pos;
    return found === -1;
  });
  return found;
}

function caretInCell(editor: Editor, text: string): void {
  const pos = paragraphPos(editor, text);
  if (pos < 0) throw new Error("cell paragraph missing");
  editor.commands.setTextSelection(pos + 2);
}

function selectCells(editor: Editor): void {
  const positions: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "docTableCell" || node.type.name === "docTableHeader") positions.push(pos);
    return true;
  });
  const first = positions[0];
  const last = positions[positions.length - 1];
  if (first === undefined || last === undefined) throw new Error("table cells missing");
  editor.view.dispatch(
    editor.state.tr.setSelection(
      new CellSelection(editor.state.doc.resolve(first), editor.state.doc.resolve(last)),
    ),
  );
}

function blockAt(editor: Editor) {
  return editor.state.doc.child(0);
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
    paragraphStyle?: DocxGalleryStyleId | null;
    content?: JSONContent[];
    caret?: (editor: Editor) => void;
  } = {},
) {
  const editor = editorWith(options.content ?? [paragraph("hello world")]);
  const runtime = createDocxCommandRuntime(() => editor);
  if (options.caret) options.caret(editor);
  else editor.commands.setTextSelection(2);
  const format = {
    ...runtime.getState(),
    paragraphStyle: options.paragraphStyle === undefined ? "normal" : options.paragraphStyle,
  } as DocxToolbarGroupContext["format"];
  const commands = "commands" in options ? options.commands : runtime;
  render(<HomeStylesGroup {...context({ commands, format, readOnly: options.readOnly ?? false })} />);
  return { editor, runtime };
}

async function openGallery(): Promise<void> {
  fireEvent.click(screen.getByTestId("docx-styles-gallery"));
  await screen.findByTestId("docx-style-normal");
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  vi.restoreAllMocks();
});

describe("HomeStylesGroup", () => {
  it("names the trigger and shows the current style", () => {
    renderGroup();
    const trigger = screen.getByTestId("docx-styles-gallery");
    expect(trigger).toHaveAccessibleName("Kiểu đoạn");
    expect(trigger).toHaveTextContent("Chuẩn");
  });

  it("shows the heading style the caret sits in", () => {
    renderGroup({ paragraphStyle: "heading-2" });
    expect(screen.getByTestId("docx-styles-gallery")).toHaveTextContent("Tiêu đề 2");
  });

  it("labels the Title style apart from the numbered heading levels", async () => {
    renderGroup();
    await openGallery();
    expect(screen.getByTestId("docx-style-title")).toHaveTextContent("Tên đề");
    expect(screen.getByTestId("docx-style-heading-2")).toHaveTextContent("Tiêu đề 2");
  });

  it("shows a neutral label for a style outside the gallery", () => {
    renderGroup({ paragraphStyle: null });
    expect(screen.getByTestId("docx-styles-gallery")).toHaveTextContent("Kiểu khác");
  });

  it("applies a heading entry to the caret's paragraph", async () => {
    const { editor } = renderGroup();
    await openGallery();
    fireEvent.click(screen.getByTestId("docx-style-heading-2"));
    expect(blockAt(editor).type.name).toBe("docHeading");
    expect(blockAt(editor).attrs.level).toBe(2);
  });

  it("applies Title and Quote as paragraph styles", async () => {
    const { editor } = renderGroup();
    await openGallery();
    fireEvent.click(screen.getByTestId("docx-style-title"));
    expect(blockAt(editor).attrs.styleId).toBe("Title");

    await openGallery();
    fireEvent.click(screen.getByTestId("docx-style-quote"));
    expect(blockAt(editor).attrs.styleId).toBe("Quote");
  });

  it("checks the entry the caret's block matches", async () => {
    renderGroup({ paragraphStyle: "heading-2" });
    await openGallery();
    expect(screen.getByTestId("docx-style-heading-2")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("docx-style-normal")).toHaveAttribute("aria-checked", "false");
  });

  it("disables the gallery while read-only", () => {
    renderGroup({ readOnly: true });
    expect(screen.getByTestId("docx-styles-gallery")).toBeDisabled();
  });

  it("disables the gallery without a command runtime", () => {
    renderGroup({ commands: undefined });
    expect(screen.getByTestId("docx-styles-gallery")).toBeDisabled();
  });
});

describe("HomeStylesGroup: table cells", () => {
  it("refuses a heading swap for a caret inside a table cell", async () => {
    const { editor } = renderGroup({
      content: tableContent("cell text"),
      caret: (e) => caretInCell(e, "cell text"),
    });
    const before = editor.getJSON();
    await openGallery();
    fireEvent.click(screen.getByTestId("docx-style-heading-2"));
    expect(paragraphPos(editor, "cell text")).toBeGreaterThan(-1);
    expect(editor.getJSON()).toEqual(before);
  });

  it("refuses a heading swap for a selection spanning table cells", async () => {
    const { editor } = renderGroup({
      content: tableContent("cell one", "cell two"),
      caret: selectCells,
    });
    const before = editor.getJSON();
    await openGallery();
    fireEvent.click(screen.getByTestId("docx-style-heading-2"));
    expect(editor.getJSON()).toEqual(before);
  });

  it("refuses Title and Quote inside a table cell instead of faking the save", async () => {
    const { editor } = renderGroup({
      content: tableContent("cell text"),
      caret: (e) => caretInCell(e, "cell text"),
    });
    const before = editor.getJSON();
    await openGallery();
    fireEvent.click(screen.getByTestId("docx-style-title"));
    expect(editor.getJSON()).toEqual(before);

    await openGallery();
    fireEvent.click(screen.getByTestId("docx-style-quote"));
    expect(editor.getJSON()).toEqual(before);
  });
});
