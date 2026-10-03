import { Editor } from "@tiptap/core";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect, useMemo, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { createDocxCommandRuntime, type DocxCommandRuntime } from "../commands";
import { docxExtensions } from "../docx-schema";
import { HomeFontGroup } from "../toolbar/groups/home-font";
import type { DocxToolbarGroupContext } from "../toolbar/types";
import type { DocxEditorHandle, DocxSelection } from "../types";

initI18n();

beforeEach(async () => {
  await setLocale("en");
});

const editors: Editor[] = [];

function editorWith(text: string): Editor {
  const editor = new Editor({
    extensions: docxExtensions(),
    content: { type: "doc", content: [{ type: "docParagraph", content: [{ type: "text", text }] }] },
  });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

function coordinator(): DocxToolbarGroupContext["coordinator"] {
  const state = {
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
    getState: () => state,
    subscribe: () => () => undefined,
    save: vi.fn(async () => ({ accepted: false as const, reason: "clean" as const })),
  };
}

function makeHandle(editor: Editor): DocxEditorHandle {
  const listeners = new Set<(selection: DocxSelection | null) => void>();
  const readSelection = (): DocxSelection | null => {
    const { from, to } = editor.state.selection;
    return { blockId: null, from, to };
  };
  editor.on("selectionUpdate", () => {
    const next = readSelection();
    for (const listener of listeners) listener(next);
  });
  return {
    format: "docx",
    open: vi.fn(async () => undefined),
    getDirtyGeneration: () => 0,
    captureSnapshot: vi.fn(async () => ({ generation: 0, fingerprint: "fp", value: {} })),
    dispose: vi.fn(),
    selection: {
      getSelection: readSelection,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
  };
}

/** The real handle calls emitState() on every transaction; the harness wires
 * the same path so the controls mirror the editor without a save session. */
function Harness({ editor, readOnly = false }: { editor: Editor; readOnly?: boolean }) {
  const runtime: DocxCommandRuntime = useMemo(() => createDocxCommandRuntime(() => editor), [editor]);
  const handle = useMemo(() => makeHandle(editor), [editor]);
  const [format, setFormat] = useState(() => runtime.getState());

  useEffect(() => runtime.subscribe(setFormat), [runtime]);
  useEffect(() => {
    const onTransaction = () => runtime.emitState();
    editor.on("transaction", onTransaction);
    return () => {
      editor.off("transaction", onTransaction);
    };
  }, [editor, runtime]);

  const context: DocxToolbarGroupContext = {
    editor: handle,
    coordinator: coordinator(),
    format,
    commands: runtime,
    selection: null,
    readOnly,
    saving: false,
    dirty: false,
    canUndo: true,
    canRedo: true,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
  };
  return <HomeFontGroup {...context} />;
}

function attrs(editor: Editor): Record<string, unknown> {
  return editor.getAttributes("docTextStyle") as Record<string, unknown>;
}

describe("HomeFontGroup", () => {
  it("renders the character controls and mirrors the format state", () => {
    const editor = editorWith("hello world");
    editor.chain().setTextSelection({ from: 1, to: 6 }).toggleMark("strike").setMark("docTextStyle", { fontAscii: "Arial", sizeHalfPoints: 29 }).run();
    editor.commands.setTextSelection(3);
    render(<Harness editor={editor} />);

    expect(screen.getByTestId("docx-font-family")).toHaveTextContent("Arial");
    expect(screen.getByTestId("docx-font-size")).toHaveValue("14.5");
    expect(screen.getByTestId("docx-strike")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("docx-superscript")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("docx-subscript")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("docx-text-color")).toBeInTheDocument();
    expect(screen.getByTestId("docx-highlight")).toBeInTheDocument();
    expect(screen.getByTestId("docx-change-case")).toBeInTheDocument();
    expect(screen.getByTestId("docx-clear-formatting")).toBeInTheDocument();
    expect(screen.getByTestId("docx-format-painter")).toBeInTheDocument();
  });

  it("applies and reflects strike-through", async () => {
    const editor = editorWith("hello world");
    editor.commands.setTextSelection({ from: 1, to: 6 });
    render(<Harness editor={editor} />);

    fireEvent.click(screen.getByTestId("docx-strike"));
    expect(editor.isActive("strike")).toBe(true);
    await waitFor(() => expect(screen.getByTestId("docx-strike")).toHaveAttribute("aria-pressed", "true"));

    fireEvent.click(screen.getByTestId("docx-strike"));
    expect(editor.isActive("strike")).toBe(false);
    await waitFor(() => expect(screen.getByTestId("docx-strike")).toHaveAttribute("aria-pressed", "false"));
  });

  it("sets superscript and subscript as a mutual choice", async () => {
    const editor = editorWith("hello world");
    editor.commands.setTextSelection({ from: 1, to: 6 });
    render(<Harness editor={editor} />);

    fireEvent.click(screen.getByTestId("docx-superscript"));
    expect(attrs(editor).vertAlign).toBe("superscript");
    await waitFor(() => expect(screen.getByTestId("docx-superscript")).toHaveAttribute("aria-pressed", "true"));

    fireEvent.click(screen.getByTestId("docx-subscript"));
    expect(attrs(editor).vertAlign).toBe("subscript");
    await waitFor(() => expect(screen.getByTestId("docx-superscript")).toHaveAttribute("aria-pressed", "false"));
    await waitFor(() => expect(screen.getByTestId("docx-subscript")).toHaveAttribute("aria-pressed", "true"));

    fireEvent.click(screen.getByTestId("docx-subscript"));
    expect(attrs(editor).vertAlign ?? null).toBeNull();
  });

  it("offers the built-in and the document's own fonts and applies a pick", async () => {
    const editor = editorWith("hello world");
    editor.commands.setTextSelection({ from: 7, to: 12 });
    editor.chain().setMark("docTextStyle", { fontAscii: "Aptos" }).run();
    editor.commands.setTextSelection({ from: 1, to: 6 });
    render(<Harness editor={editor} />);

    fireEvent.click(screen.getByTestId("docx-font-family"));
    const list = await screen.findByTestId("docx-font-family-list");
    expect(within(list).getByRole("button", { name: "Arial" })).toBeInTheDocument();
    expect(within(list).getByRole("button", { name: "Aptos" })).toBeInTheDocument();

    fireEvent.click(within(list).getByRole("button", { name: "Arial" }));
    expect(attrs(editor).fontAscii).toBe("Arial");
    await waitFor(() => expect(screen.queryByTestId("docx-font-family-list")).toBeNull());
  });

  it("accepts a typed font name", async () => {
    const editor = editorWith("hello world");
    editor.commands.setTextSelection({ from: 1, to: 6 });
    render(<Harness editor={editor} />);

    fireEvent.click(screen.getByTestId("docx-font-family"));
    const search = await screen.findByTestId("docx-font-family-search");
    fireEvent.change(search, { target: { value: "Aptos Display" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(attrs(editor).fontAscii).toBe("Aptos Display");
  });

  it("commits a typed size and steps through the presets", async () => {
    const editor = editorWith("hello world");
    editor.commands.setTextSelection({ from: 1, to: 6 });
    render(<Harness editor={editor} />);

    const input = screen.getByTestId("docx-font-size");
    fireEvent.change(input, { target: { value: "18" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(attrs(editor).sizeHalfPoints).toBe(36);
    await waitFor(() => expect(screen.getByTestId("docx-font-size")).toHaveValue("18"));

    fireEvent.click(screen.getByTestId("docx-font-size-increase"));
    expect(attrs(editor).sizeHalfPoints).toBe(40);
    await waitFor(() => expect(screen.getByTestId("docx-font-size")).toHaveValue("20"));

    fireEvent.click(screen.getByTestId("docx-font-size-presets"));
    const options = await screen.findAllByTestId("docx-font-size-option");
    fireEvent.click(options[9] as HTMLElement);
    expect(attrs(editor).sizeHalfPoints).toBe(24);
  });

  it("applies a text colour and resets it to automatic", async () => {
    const editor = editorWith("hello world");
    editor.commands.setTextSelection({ from: 1, to: 6 });
    render(<Harness editor={editor} />);

    fireEvent.click(screen.getByTestId("docx-text-color"));
    fireEvent.click(await screen.findByTestId("docx-text-color-swatch-FF0000"));
    expect(attrs(editor).color).toBe("FF0000");

    fireEvent.click(screen.getByTestId("docx-text-color"));
    fireEvent.click(await screen.findByTestId("docx-text-color-swatch-none"));
    expect(attrs(editor).color ?? null).toBeNull();
  });

  it("applies a highlight and resets it", async () => {
    const editor = editorWith("hello world");
    editor.commands.setTextSelection({ from: 1, to: 6 });
    render(<Harness editor={editor} />);

    fireEvent.click(screen.getByTestId("docx-highlight"));
    fireEvent.click(await screen.findByTestId("docx-highlight-swatch-yellow"));
    expect(attrs(editor).highlight).toBe("yellow");

    fireEvent.click(screen.getByTestId("docx-highlight"));
    fireEvent.click(await screen.findByTestId("docx-highlight-swatch-none"));
    expect(attrs(editor).highlight ?? null).toBeNull();
  });

  it("changes case from the menu", async () => {
    const editor = editorWith("hello world");
    editor.commands.setTextSelection({ from: 1, to: 6 });
    render(<Harness editor={editor} />);

    fireEvent.click(screen.getByTestId("docx-change-case"));
    fireEvent.click(await screen.findByTestId("docx-change-case-upper"));
    expect(editor.state.doc.textBetween(1, 6)).toBe("HELLO");
  });

  it("clears the character marks", () => {
    const editor = editorWith("hello world");
    editor.commands.setTextSelection({ from: 1, to: 6 });
    editor.chain().toggleMark("strike").toggleMark("bold").run();
    render(<Harness editor={editor} />);

    fireEvent.click(screen.getByTestId("docx-clear-formatting"));
    expect(editor.isActive("strike")).toBe(false);
    expect(editor.isActive("bold")).toBe(false);
  });

  it("disables every control while read-only", () => {
    const editor = editorWith("hello world");
    render(<Harness editor={editor} readOnly />);

    for (const testId of [
      "docx-font-family",
      "docx-font-size",
      "docx-font-size-decrease",
      "docx-font-size-increase",
      "docx-font-size-presets",
      "docx-strike",
      "docx-superscript",
      "docx-subscript",
      "docx-text-color",
      "docx-highlight",
      "docx-change-case",
      "docx-clear-formatting",
      "docx-format-painter",
    ]) {
      expect(screen.getByTestId(testId)).toBeDisabled();
    }
  });

  it("keeps the picker trigger focusable and closes the panel on Escape", async () => {
    const editor = editorWith("hello world");
    render(<Harness editor={editor} />);

    const trigger = screen.getByTestId("docx-font-family");
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    const search = await screen.findByTestId("docx-font-family-search");
    fireEvent.keyDown(search, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("docx-font-family-search")).toBeNull());
  });
});

describe("HomeFontGroup: format painter", () => {
  function boldEditor(): Editor {
    const editor = editorWith("hello world");
    editor.commands.setTextSelection({ from: 1, to: 6 });
    editor.chain().toggleMark("bold").run();
    editor.commands.setTextSelection(3);
    return editor;
  }

  it("arms the painter and applies the copied formatting to the next selection", async () => {
    const editor = boldEditor();
    render(<Harness editor={editor} />);

    fireEvent.click(screen.getByTestId("docx-format-painter"));
    await waitFor(() => expect(screen.getByTestId("docx-format-painter")).toHaveAttribute("aria-pressed", "true"));

    editor.commands.setTextSelection({ from: 7, to: 12 });
    await waitFor(() => expect(screen.getByTestId("docx-format-painter")).toHaveAttribute("aria-pressed", "false"));
    expect((editor.state.doc.nodeAt(7)?.marks ?? []).map((mark) => mark.type.name)).toContain("bold");
  });

  it("cancels an armed painter on Escape without applying", async () => {
    const editor = boldEditor();
    render(<Harness editor={editor} />);

    fireEvent.click(screen.getByTestId("docx-format-painter"));
    await waitFor(() => expect(screen.getByTestId("docx-format-painter")).toHaveAttribute("aria-pressed", "true"));

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.getByTestId("docx-format-painter")).toHaveAttribute("aria-pressed", "false"));

    editor.commands.setTextSelection({ from: 7, to: 12 });
    expect(editor.isActive("bold")).toBe(false);
  });
});
