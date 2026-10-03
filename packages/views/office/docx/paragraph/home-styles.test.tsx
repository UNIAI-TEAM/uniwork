import { Editor, type JSONContent } from "@tiptap/core";
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

function editorWith(content: JSONContent[]): Editor {
  const editor = new Editor({ extensions: docxExtensions(), content: { type: "doc", content } });
  editors.push(editor);
  return editor;
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
  } = {},
) {
  const editor = editorWith([paragraph("hello world")]);
  const runtime = createDocxCommandRuntime(() => editor);
  editor.commands.setTextSelection(2);
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
