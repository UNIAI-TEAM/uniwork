import { act, fireEvent, render, screen } from "@testing-library/react";
import { Editor, type JSONContent } from "@tiptap/core";
import { Document } from "@tiptap/extension-document";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Text } from "@tiptap/extension-text";
import { afterEach, describe, expect, it, vi } from "vitest";
import { docxFindPluginKey } from "./find-decoration";
import { DocxFindPanel } from "./find-panel";

const editors: Editor[] = [];

function createEditor(lines: string[], editable = true): Editor {
  const content: JSONContent = {
    type: "doc",
    content: lines.map((line) => ({ type: "paragraph", content: [{ type: "text", text: line }] })),
  };
  const editor = new Editor({ extensions: [Document, Paragraph, Text], content, editable });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

function renderPanel(editor: Editor, options?: { readOnly?: boolean; onClose?: () => void }) {
  const onClose = options?.onClose ?? vi.fn();
  render(<DocxFindPanel editor={editor} onClose={onClose} readOnly={options?.readOnly} />);
  return { onClose };
}

function search(value: string) {
  fireEvent.change(screen.getByTestId("docx-find-input"), { target: { value } });
}

function documentText(editor: Editor) {
  return editor.state.doc.textBetween(0, editor.state.doc.content.size, "\n");
}

describe("DocxFindPanel", () => {
  it("shows the empty state, counts live and wraps next/previous", () => {
    const editor = createEditor(["alpha beta", "gamma alpha"]);
    renderPanel(editor);
    expect(screen.getByTestId("docx-find-count")).toHaveTextContent("Nhập để tìm");

    search("alpha");
    expect(screen.getByTestId("docx-find-count")).toHaveTextContent("1 / 2");

    fireEvent.click(screen.getByTestId("docx-find-next"));
    expect(screen.getByTestId("docx-find-count")).toHaveTextContent("2 / 2");

    fireEvent.click(screen.getByTestId("docx-find-next"));
    expect(screen.getByTestId("docx-find-count")).toHaveTextContent("1 / 2");

    fireEvent.click(screen.getByTestId("docx-find-previous"));
    expect(screen.getByTestId("docx-find-count")).toHaveTextContent("2 / 2");
  });

  it("steps with Enter / Shift+Enter from the search field", () => {
    const editor = createEditor(["alpha beta", "gamma alpha"]);
    renderPanel(editor);
    search("alpha");
    const input = screen.getByTestId("docx-find-input");

    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByTestId("docx-find-count")).toHaveTextContent("2 / 2");

    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(screen.getByTestId("docx-find-count")).toHaveTextContent("1 / 2");
  });

  it("shows the no-match state and highlights the hits in the editor", () => {
    const editor = createEditor(["alpha beta", "gamma alpha"]);
    renderPanel(editor);
    search("zzz");
    expect(screen.getByTestId("docx-find-count")).toHaveTextContent("Không có kết quả");
    expect(docxFindPluginKey.getState(editor.state)?.find() ?? []).toHaveLength(0);

    search("alpha");
    expect(docxFindPluginKey.getState(editor.state)?.find() ?? []).toHaveLength(2);
  });

  it("re-runs the search when the case and whole-word toggles change", () => {
    const editor = createEditor(["Cat cat catalog"]);
    renderPanel(editor);
    search("cat");
    expect(screen.getByTestId("docx-find-count")).toHaveTextContent("1 / 3");

    fireEvent.click(screen.getByTestId("docx-find-whole-word"));
    expect(screen.getByTestId("docx-find-count")).toHaveTextContent("1 / 2");

    fireEvent.click(screen.getByTestId("docx-find-match-case"));
    expect(screen.getByTestId("docx-find-count")).toHaveTextContent("1 / 1");
  });

  it("replaces the current hit and reports how many were replaced", () => {
    const editor = createEditor(["alpha beta", "alpha gamma"]);
    renderPanel(editor);
    search("alpha");
    fireEvent.change(screen.getByTestId("docx-find-replace-input"), { target: { value: "omega" } });

    fireEvent.click(screen.getByTestId("docx-find-replace"));
    expect(documentText(editor)).toBe("omega beta\nalpha gamma");
    expect(screen.getByTestId("docx-find-count")).toHaveTextContent("1 / 1");
    expect(screen.getByTestId("docx-find-status")).toHaveTextContent("Đã thay thế 1 kết quả");
  });

  it("replaces every hit and reports how many were replaced", () => {
    const editor = createEditor(["alpha beta", "alpha gamma"]);
    renderPanel(editor);
    search("alpha");
    fireEvent.change(screen.getByTestId("docx-find-replace-input"), { target: { value: "omega" } });

    fireEvent.click(screen.getByTestId("docx-find-replace-all"));
    expect(documentText(editor)).toBe("omega beta\nomega gamma");
    expect(screen.getByTestId("docx-find-status")).toHaveTextContent("Đã thay thế 2 kết quả");
    expect(screen.getByTestId("docx-find-count")).toHaveTextContent("Không có kết quả");
  });

  it("disables replace on a read-only document", () => {
    const editor = createEditor(["alpha"], false);
    renderPanel(editor);
    search("alpha");

    expect(screen.getByTestId("docx-find-count")).toHaveTextContent("1 / 1");
    expect(screen.getByTestId("docx-find-replace-input")).toBeDisabled();
    expect(screen.getByTestId("docx-find-replace")).toBeDisabled();
    expect(screen.getByTestId("docx-find-replace-all")).toBeDisabled();
  });

  it("closes on Escape and on the close button, clearing the highlight", () => {
    const editor = createEditor(["alpha"]);
    const onClose = vi.fn();
    renderPanel(editor, { onClose });
    search("alpha");
    expect(docxFindPluginKey.getState(editor.state)?.find() ?? []).toHaveLength(1);

    fireEvent.keyDown(screen.getByTestId("docx-find-input"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(docxFindPluginKey.getState(editor.state)?.find() ?? []).toHaveLength(0);

    fireEvent.click(screen.getByTestId("docx-find-close"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("re-scans when the document changes underneath", () => {
    const editor = createEditor(["alpha"]);
    renderPanel(editor);
    search("alpha");
    expect(screen.getByTestId("docx-find-count")).toHaveTextContent("1 / 1");

    act(() => {
      editor.commands.insertContentAt(editor.state.doc.content.size, { type: "paragraph", content: [{ type: "text", text: "alpha again" }] });
    });
    expect(screen.getByTestId("docx-find-count")).toHaveTextContent("1 / 2");
  });
});
