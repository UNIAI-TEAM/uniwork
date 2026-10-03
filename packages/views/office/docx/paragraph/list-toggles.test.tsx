import { Editor, type JSONContent } from "@tiptap/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDocxCommandRuntime, type DocxCommandRuntime } from "../commands";
import { docxExtensions } from "../docx-schema";
import { HomeBaseFormatGroup } from "../toolbar/groups/home-base";
import type { DocxToolbarGroupContext } from "../toolbar/types";

/**
 * A3 checklist item 3: the bullet/numbering toggles stay at one level and keep
 * their active state. The buttons live in the pre-wave base group; these tests
 * pin the behaviour the paragraph work reuses instead of duplicating them.
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
  render(<HomeBaseFormatGroup {...context({ commands, format, readOnly: options.readOnly ?? false })} />);
  return { editor, runtime };
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  vi.restoreAllMocks();
});

describe("list toggles (base group)", () => {
  it("adds a bullet list at level 0 and returns to a paragraph on the second click", () => {
    const { editor } = renderGroup();
    fireEvent.click(screen.getByRole("button", { name: "Danh sách dấu đầu dòng" }));
    expect(blockAt(editor).type.name).toBe("docListItem");
    expect(attrsOf(editor).kind).toBe("bullet");
    expect(attrsOf(editor).ilvl).toBe(0);
    expect(typeof attrsOf(editor).numId).toBe("string");
    fireEvent.click(screen.getByRole("button", { name: "Danh sách dấu đầu dòng" }));
    expect(blockAt(editor).type.name).toBe("docParagraph");
  });

  it("switches a list item to numbering through the same command", () => {
    const { editor } = renderGroup();
    fireEvent.click(screen.getByRole("button", { name: "Danh sách dấu đầu dòng" }));
    fireEvent.click(screen.getByRole("button", { name: "Danh sách đánh số" }));
    expect(blockAt(editor).type.name).toBe("docListItem");
    expect(attrsOf(editor).kind).toBe("ordered");
    expect(attrsOf(editor).ilvl).toBe(0);
  });

  it("marks the active list kind from the composed state", () => {
    renderGroup({ formatOverride: { listKind: "ordered" } });
    expect(screen.getByRole("button", { name: "Danh sách đánh số" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Danh sách dấu đầu dòng" })).toHaveAttribute("aria-pressed", "false");
  });

  it("disables the toggles while read-only", () => {
    renderGroup({ readOnly: true });
    expect(screen.getByRole("button", { name: "Danh sách dấu đầu dòng" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Danh sách đánh số" })).toBeDisabled();
  });
});
