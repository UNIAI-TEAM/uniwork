import { act, fireEvent, render, screen } from "@testing-library/react";
import { Editor, type JSONContent } from "@tiptap/core";
import { Document } from "@tiptap/extension-document";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Text } from "@tiptap/extension-text";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocxFindPanel } from "./docx-find-panel";
import { docxFindPluginKey } from "./find-decoration";
import { DocxFindExtension } from "./find-extension";
import { createDocxDocumentScope, DocxDocumentScopeProvider, type DocxDocumentScope } from "../editor-store";

const editors: Editor[] = [];
// One document scope per test (UNI-957): Find state and the live editor live there.
let scope: DocxDocumentScope = createDocxDocumentScope();

beforeEach(() => {
  scope = createDocxDocumentScope();
});

function renderPanel() {
  return render(<DocxDocumentScopeProvider scope={scope}><DocxFindPanel readOnly={false} /></DocxDocumentScopeProvider>);
}

function editorWith(text: string): Editor {
  const content: JSONContent = {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
  const editor = new Editor({ extensions: [Document, Paragraph, Text, DocxFindExtension], content });
  editors.push(editor);
  scope.publishEditor(editor);
  return editor;
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

describe("DocxFindPanel chrome slot", () => {
  it("renders nothing while closed or before an editor is published", () => {
    renderPanel();
    expect(screen.queryByTestId("docx-find-panel")).not.toBeInTheDocument();

    act(() => {
      scope.find.set(!scope.find.get());
    });
    expect(scope.find.get()).toBe(true);
    expect(screen.queryByTestId("docx-find-panel")).not.toBeInTheDocument();
  });

  it("opens the panel for the live editor and closes through the store", () => {
    editorWith("alpha beta");
    renderPanel();

    act(() => {
      scope.find.set(!scope.find.get());
    });
    expect(screen.getByTestId("docx-find-panel")).toBeInTheDocument();
    expect(screen.getByTestId("docx-find-input")).not.toBeDisabled();

    fireEvent.click(screen.getByTestId("docx-find-close"));
    expect(screen.queryByTestId("docx-find-panel")).not.toBeInTheDocument();
    expect(scope.find.get()).toBe(false);
  });

  it("hides the panel when the editor goes away", () => {
    const editor = editorWith("alpha");
    renderPanel();
    act(() => {
      scope.find.set(!scope.find.get());
    });
    expect(screen.getByTestId("docx-find-panel")).toBeInTheDocument();

    act(() => {
      editor.destroy();
    });
    editors.splice(editors.indexOf(editor), 1);
    expect(screen.queryByTestId("docx-find-panel")).not.toBeInTheDocument();
    expect(scope.find.get()).toBe(false);
  });

  it("releases the find session when the toolbar toggle closes the panel", async () => {
    const editor = editorWith("alpha beta alpha");
    const focus = vi.spyOn(editor.view, "focus");
    renderPanel();

    act(() => {
      scope.find.set(!scope.find.get());
    });
    fireEvent.change(screen.getByTestId("docx-find-input"), { target: { value: "alpha" } });
    expect(docxFindPluginKey.getState(editor.state)?.find() ?? []).toHaveLength(2);

    act(() => {
      scope.find.set(!scope.find.get());
    });
    expect(screen.queryByTestId("docx-find-panel")).not.toBeInTheDocument();
    expect(scope.find.get()).toBe(false);
    expect(docxFindPluginKey.getState(editor.state)?.find() ?? []).toHaveLength(0);

    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    expect(focus).toHaveBeenCalled();
  });

  it("releases the find session when Escape closes the panel", async () => {
    const editor = editorWith("alpha beta alpha");
    const focus = vi.spyOn(editor.view, "focus");
    renderPanel();

    act(() => {
      scope.find.set(!scope.find.get());
    });
    fireEvent.change(screen.getByTestId("docx-find-input"), { target: { value: "alpha" } });
    expect(docxFindPluginKey.getState(editor.state)?.find() ?? []).toHaveLength(2);

    fireEvent.keyDown(screen.getByTestId("docx-find-input"), { key: "Escape" });
    expect(screen.queryByTestId("docx-find-panel")).not.toBeInTheDocument();
    expect(scope.find.get()).toBe(false);
    expect(docxFindPluginKey.getState(editor.state)?.find() ?? []).toHaveLength(0);

    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    expect(focus).toHaveBeenCalled();
  });
});
