import { Editor, type JSONContent } from "@tiptap/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDocxCommandRuntime, type DocxCommandRuntime } from "../commands";
import { docxExtensions } from "../docx-schema";
import { HomeFontGroup } from "../toolbar/groups/home-font";
import type { DocxToolbarGroupContext } from "../toolbar/types";

/**
 * C7/C8 dedupe: the pre-wave "Formatting" group carried a Heading select and
 * bullet/numbered toggles that duplicated the Styles gallery and the list
 * gallery. Those controls are gone; the Home command strip renders the list
 * entry exactly once (lists/home-lists.tsx) and the character trio once (in the
 * Font group). The `toggleList` command itself still backs the list gallery and
 * is exercised here through the command runtime, not through a duplicate
 * button.
 */
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

function attrsOf(editor: Editor): Record<string, unknown> {
  return blockAt(editor).attrs as Record<string, unknown>;
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
    formatOverride?: Partial<NonNullable<DocxToolbarGroupContext["format"]>>;
  } = {},
) {
  const editor = editorWith([paragraph("hello world")]);
  const runtime = createDocxCommandRuntime(() => editor);
  editor.commands.setTextSelection(2);
  const format = { ...runtime.getState(), ...(options.formatOverride ?? {}) } as DocxToolbarGroupContext["format"];
  const commands = "commands" in options ? options.commands : runtime;
  render(<HomeFontGroup {...context({ commands, format, readOnly: options.readOnly ?? false })} />);
  return { editor, runtime };
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  vi.restoreAllMocks();
});

describe("Home character trio (Font group)", () => {
  it("renders bold/italic/underline once and no duplicate list or heading controls", () => {
    renderGroup();
    expect(screen.getByTestId("docx-bold")).toBeInTheDocument();
    expect(screen.getByTestId("docx-italic")).toBeInTheDocument();
    expect(screen.getByTestId("docx-underline")).toBeInTheDocument();
    // The deduped controls: no bullet/numbered toggle and no heading select in
    // this group (the list gallery and the Styles gallery own them).
    expect(screen.queryByRole("button", { name: "Danh s?ch d?u ??u d?ng" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Danh s?ch ??nh s?" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Ti?u ??" })).not.toBeInTheDocument();
  });

  it("toggles the trio through the shared command runtime", () => {
    const { editor } = renderGroup();
    editor.commands.setTextSelection({ from: 1, to: 6 });
    fireEvent.click(screen.getByTestId("docx-bold"));
    fireEvent.click(screen.getByTestId("docx-italic"));
    fireEvent.click(screen.getByTestId("docx-underline"));
    expect(editor.isActive("bold")).toBe(true);
    expect(editor.isActive("italic")).toBe(true);
    expect(editor.isActive("underline")).toBe(true);
  });

  it("marks the active marks from the composed state", () => {
    renderGroup({ formatOverride: { bold: true, italic: false, underline: true } });
    expect(screen.getByTestId("docx-bold")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("docx-italic")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("docx-underline")).toHaveAttribute("aria-pressed", "true");
  });

  it("disables the trio while read-only", () => {
    renderGroup({ readOnly: true });
    expect(screen.getByTestId("docx-bold")).toBeDisabled();
    expect(screen.getByTestId("docx-italic")).toBeDisabled();
    expect(screen.getByTestId("docx-underline")).toBeDisabled();
  });
});

describe("toggleList command (single list entry)", () => {
  it("adds a bullet list at level 0 and returns to a paragraph on the second call", () => {
    const editor = editorWith([paragraph("hello world")]);
    const runtime = createDocxCommandRuntime(() => editor);
    editor.commands.setTextSelection(2);

    runtime.toggleList("bullet");
    expect(blockAt(editor).type.name).toBe("docListItem");
    expect(attrsOf(editor).kind).toBe("bullet");
    expect(attrsOf(editor).ilvl).toBe(0);
    expect(typeof attrsOf(editor).numId).toBe("string");

    runtime.toggleList("bullet");
    expect(blockAt(editor).type.name).toBe("docParagraph");
  });

  it("switches a list item to numbering through the same command", () => {
    const editor = editorWith([paragraph("hello world")]);
    const runtime = createDocxCommandRuntime(() => editor);
    editor.commands.setTextSelection(2);

    runtime.toggleList("bullet");
    runtime.toggleList("ordered");
    expect(blockAt(editor).type.name).toBe("docListItem");
    expect(attrsOf(editor).kind).toBe("ordered");
    expect(attrsOf(editor).ilvl).toBe(0);
  });
});
