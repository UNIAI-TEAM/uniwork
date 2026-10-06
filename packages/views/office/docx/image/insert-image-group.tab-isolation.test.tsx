// UNI-957 (review r1 m2): two DOCX documents mounted together. Each Insert >
// Image group builds its image port over its OWN document's live editor, and a
// change in one document's editor never rebinds the other's.
import { act, render, screen, within } from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import { describe, expect, it, vi } from "vitest";
import { createDocxDocumentScope, type DocxDocumentScope } from "../editor-store";
import type { DocxToolbarGroupContext } from "../toolbar/types";
import { InsertImageGroup } from "./insert-image-group";

const bound: Array<Editor | null> = [];

vi.mock("./docx-image-commands", () => ({
  createDocxImageEditing: (getEditor: () => Editor | null) => {
    bound.push(getEditor());
    return { getSelected: () => null, subscribe: () => () => undefined, insert: () => true, apply: () => undefined, remove: () => undefined };
  },
}));

const fakeEditor = (name: string) => ({ name, on: vi.fn(), off: vi.fn() }) as unknown as Editor;

function context(docScope: DocxDocumentScope): DocxToolbarGroupContext {
  return {
    docScope,
    editor: {} as DocxToolbarGroupContext["editor"],
    coordinator: {} as DocxToolbarGroupContext["coordinator"],
    format: null,
    selection: null,
    readOnly: false,
    saving: false,
    dirty: false,
    canUndo: false,
    canRedo: false,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
  };
}

describe("Insert > Image across two documents", () => {
  it("binds each group to its own document's editor and keeps the hidden one bound", () => {
    const scopeA = createDocxDocumentScope();
    const scopeB = createDocxDocumentScope();
    const editorA = fakeEditor("a");
    const editorB = fakeEditor("b");
    render(
      <>
        <div data-testid="tab-a" hidden><InsertImageGroup {...context(scopeA)} /></div>
        <div data-testid="tab-b"><InsertImageGroup {...context(scopeB)} /></div>
      </>,
    );
    // No document open yet: no entry anywhere.
    expect(screen.queryAllByTestId("docx-image-insert-button")).toHaveLength(0);

    act(() => scopeA.publishEditor(editorA));
    expect(within(screen.getByTestId("tab-a")).getByTestId("docx-image-insert-button")).toBeInTheDocument();
    expect(within(screen.getByTestId("tab-b")).queryByTestId("docx-image-insert-button")).toBeNull();
    expect(bound).toEqual([editorA]);

    act(() => scopeB.publishEditor(editorB));
    expect(within(screen.getByTestId("tab-b")).getByTestId("docx-image-insert-button")).toBeInTheDocument();
    // B's port is built over B's editor; A's port was not rebuilt for B.
    expect(bound).toEqual([editorA, editorB]);

    // The visible document closes: the hidden one keeps its entry and binding.
    act(() => scopeB.publishEditor(null));
    expect(within(screen.getByTestId("tab-b")).queryByTestId("docx-image-insert-button")).toBeNull();
    expect(within(screen.getByTestId("tab-a")).getByTestId("docx-image-insert-button")).toBeInTheDocument();
    expect(bound).toEqual([editorA, editorB]);
  });
});
