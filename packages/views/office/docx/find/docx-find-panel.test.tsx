import { act, fireEvent, render, screen } from "@testing-library/react";
import { Editor, type JSONContent } from "@tiptap/core";
import { Document } from "@tiptap/extension-document";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Text } from "@tiptap/extension-text";
import { afterEach, describe, expect, it } from "vitest";
import { DocxFindPanel } from "./docx-find-panel";
import { DocxFindExtension } from "./find-extension";
import { closeDocxFind, isDocxFindOpen, toggleDocxFind } from "./find-store";

const editors: Editor[] = [];

function editorWith(text: string): Editor {
  const content: JSONContent = {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
  const editor = new Editor({ extensions: [Document, Paragraph, Text, DocxFindExtension], content });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  closeDocxFind();
  for (const editor of editors.splice(0)) editor.destroy();
});

describe("DocxFindPanel chrome slot", () => {
  it("renders nothing while closed or before an editor is published", () => {
    render(<DocxFindPanel readOnly={false} />);
    expect(screen.queryByTestId("docx-find-panel")).not.toBeInTheDocument();

    act(() => {
      toggleDocxFind();
    });
    expect(isDocxFindOpen()).toBe(true);
    expect(screen.queryByTestId("docx-find-panel")).not.toBeInTheDocument();
  });

  it("opens the panel for the live editor and closes through the store", () => {
    editorWith("alpha beta");
    render(<DocxFindPanel readOnly={false} />);

    act(() => {
      toggleDocxFind();
    });
    expect(screen.getByTestId("docx-find-panel")).toBeInTheDocument();
    expect(screen.getByTestId("docx-find-input")).not.toBeDisabled();

    fireEvent.click(screen.getByTestId("docx-find-close"));
    expect(screen.queryByTestId("docx-find-panel")).not.toBeInTheDocument();
    expect(isDocxFindOpen()).toBe(false);
  });

  it("hides the panel when the editor goes away", () => {
    const editor = editorWith("alpha");
    render(<DocxFindPanel readOnly={false} />);
    act(() => {
      toggleDocxFind();
    });
    expect(screen.getByTestId("docx-find-panel")).toBeInTheDocument();

    act(() => {
      editor.destroy();
    });
    editors.splice(editors.indexOf(editor), 1);
    expect(screen.queryByTestId("docx-find-panel")).not.toBeInTheDocument();
  });
});
