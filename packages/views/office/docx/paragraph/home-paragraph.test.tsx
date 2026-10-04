import { Editor, type JSONContent } from "@tiptap/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDocxCommandRuntime, type DocxCommandRuntime } from "../commands";
import { docxExtensions } from "../docx-schema";
import { HomeParagraphGroup } from "../toolbar/groups/home-paragraph";
import type { DocxToolbarGroupContext } from "../toolbar/types";

const editors: Editor[] = [];

function paragraph(text: string, attrs: Record<string, unknown> = {}): JSONContent {
  return { type: "docParagraph", attrs: { docxIndex: 0, ...attrs }, content: [{ type: "text", text }] };
}

function editorWith(content: JSONContent[]): Editor {
  const editor = new Editor({ extensions: docxExtensions(), content: { type: "doc", content } });
  editors.push(editor);
  return editor;
}

function attrsOf(editor: Editor): Record<string, unknown> {
  return editor.state.doc.child(0).attrs as Record<string, unknown>;
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
    saving?: boolean;
    commands?: DocxCommandRuntime;
    formatOverride?: Partial<NonNullable<DocxToolbarGroupContext["format"]>>;
    attrs?: Record<string, unknown>;
  } = {},
) {
  const editor = editorWith([paragraph("hello world", options.attrs)]);
  const runtime = createDocxCommandRuntime(() => editor);
  editor.commands.setTextSelection(2);
  const format = { ...runtime.getState(), ...(options.formatOverride ?? {}) } as DocxToolbarGroupContext["format"];
  const commands = "commands" in options ? options.commands : runtime;
  render(<HomeParagraphGroup {...context({ commands, format, readOnly: options.readOnly ?? false, saving: options.saving ?? false })} />);
  return { editor, runtime };
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  vi.restoreAllMocks();
});

describe("HomeParagraphGroup", () => {
  it("marks the effective alignment active", () => {
    renderGroup();
    expect(screen.getByTestId("docx-align-left")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("docx-align-center")).toHaveAttribute("aria-pressed", "false");
  });

  it("follows a stored alignment", () => {
    renderGroup({ formatOverride: { align: "justify" } });
    expect(screen.getByTestId("docx-align-justify")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("docx-align-left")).toHaveAttribute("aria-pressed", "false");
  });

  it("shows no pressed button for an alignment outside the four (distribute)", () => {
    renderGroup({ attrs: { align: "distribute" } });
    for (const value of ["left", "center", "right", "justify"]) {
      expect(screen.getByTestId(`docx-align-${value}`)).toHaveAttribute("aria-pressed", "false");
    }
  });

  it("labels every control through i18n", () => {
    renderGroup();
    expect(screen.getByRole("button", { name: "Căn trái" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Căn giữa" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Căn phải" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Căn đều hai bên" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Giảm thụt lề" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tăng thụt lề" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Giãn cách đoạn" })).toBeInTheDocument();
  });

  it("applies alignment through the runtime", () => {
    const { editor } = renderGroup();
    fireEvent.click(screen.getByTestId("docx-align-center"));
    expect(attrsOf(editor).align).toBe("center");
    fireEvent.click(screen.getByTestId("docx-align-right"));
    expect(attrsOf(editor).align).toBe("right");
  });

  it("steps the indent by one stop and clears the direct indent at the margin", () => {
    const { editor } = renderGroup();
    fireEvent.click(screen.getByTestId("docx-indent-increase"));
    expect(attrsOf(editor).indentLeft).toBe(720);
    fireEvent.click(screen.getByTestId("docx-indent-increase"));
    expect(attrsOf(editor).indentLeft).toBe(1440);
    fireEvent.click(screen.getByTestId("docx-indent-decrease"));
    expect(attrsOf(editor).indentLeft).toBe(720);
    fireEvent.click(screen.getByTestId("docx-indent-decrease"));
    expect(attrsOf(editor).indentLeft ?? null).toBeNull();
    const before = editor.getJSON();
    fireEvent.click(screen.getByTestId("docx-indent-decrease"));
    expect(editor.getJSON()).toEqual(before);
  });

  it("snaps an outdent from between stops down to the stop below", () => {
    const { editor } = renderGroup({ attrs: { indentLeft: 820 } });
    fireEvent.click(screen.getByTestId("docx-indent-decrease"));
    expect(attrsOf(editor).indentLeft).toBe(720);
    fireEvent.click(screen.getByTestId("docx-indent-increase"));
    expect(attrsOf(editor).indentLeft).toBe(1440);
  });

  it("snaps a non-stop indent up to the next stop before stepping back home", () => {
    const { editor } = renderGroup({ attrs: { indentLeft: 100 } });
    fireEvent.click(screen.getByTestId("docx-indent-increase"));
    expect(attrsOf(editor).indentLeft).toBe(720);
    fireEvent.click(screen.getByTestId("docx-indent-decrease"));
    expect(attrsOf(editor).indentLeft ?? null).toBeNull();
  });

  it("sets a line-spacing preset from the spacing popover", async () => {
    const { editor } = renderGroup();
    fireEvent.click(screen.getByTestId("docx-paragraph-spacing"));
    const options = await screen.findAllByTestId("docx-line-spacing-option");
    const oneAndHalf = options.find((option) => option.textContent === "1.5");
    expect(oneAndHalf).toBeDefined();
    fireEvent.click(oneAndHalf as HTMLElement);
    expect(attrsOf(editor).lineSpacing).toBe(1.5);
  });

  it("applies a custom line spacing and both paragraph spacings", async () => {
    const { editor } = renderGroup();
    fireEvent.click(screen.getByTestId("docx-paragraph-spacing"));

    const custom = await screen.findByTestId("docx-line-spacing-custom");
    fireEvent.change(custom, { target: { value: "1.25" } });
    fireEvent.keyDown(custom, { key: "Enter" });
    expect(attrsOf(editor).lineSpacing).toBe(1.25);

    const before = screen.getByTestId("docx-space-before");
    fireEvent.change(before, { target: { value: "12" } });
    fireEvent.blur(before);
    expect(attrsOf(editor).spaceBefore).toBe(240);

    const after = screen.getByTestId("docx-space-after");
    fireEvent.change(after, { target: { value: "6" } });
    fireEvent.keyDown(after, { key: "Enter" });
    expect(attrsOf(editor).spaceAfter).toBe(120);
  });

  it("clears line and paragraph spacing back to inherit when 0 is entered", async () => {
    const { editor } = renderGroup({ attrs: { lineSpacing: 1.5, spaceBefore: 240, spaceAfter: 240 } });
    fireEvent.click(screen.getByTestId("docx-paragraph-spacing"));

    const custom = await screen.findByTestId("docx-line-spacing-custom");
    fireEvent.change(custom, { target: { value: "0" } });
    fireEvent.keyDown(custom, { key: "Enter" });
    expect(attrsOf(editor).lineSpacing ?? null).toBeNull();

    const before = screen.getByTestId("docx-space-before");
    fireEvent.change(before, { target: { value: "0" } });
    fireEvent.blur(before);
    expect(attrsOf(editor).spaceBefore ?? null).toBeNull();

    const after = screen.getByTestId("docx-space-after");
    fireEvent.change(after, { target: { value: "0" } });
    fireEvent.keyDown(after, { key: "Enter" });
    expect(attrsOf(editor).spaceAfter ?? null).toBeNull();
  });

  it("disables every control while read-only", () => {
    renderGroup({ readOnly: true });
    expect(screen.getByTestId("docx-align-center")).toBeDisabled();
    expect(screen.getByTestId("docx-indent-increase")).toBeDisabled();
    expect(screen.getByTestId("docx-paragraph-spacing")).toBeDisabled();
  });

  it("disables every control while saving", () => {
    renderGroup({ saving: true });
    expect(screen.getByTestId("docx-align-center")).toBeDisabled();
    expect(screen.getByTestId("docx-indent-increase")).toBeDisabled();
  });

  it("disables every control without a command runtime", () => {
    renderGroup({ commands: undefined });
    expect(screen.getByTestId("docx-align-center")).toBeDisabled();
    expect(screen.getByTestId("docx-indent-decrease")).toBeDisabled();
    expect(screen.getByTestId("docx-paragraph-spacing")).toBeDisabled();
  });
});
