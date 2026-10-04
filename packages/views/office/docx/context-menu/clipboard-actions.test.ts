import { Editor, type JSONContent } from "@tiptap/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { docxExtensions } from "../docx-schema";
import {
  copySelection,
  cutSelection,
  insertPastePayload,
  readClipboardPayload,
  readClipboardText,
  selectAll,
} from "./clipboard-actions";

const editors: Editor[] = [];

function createEditor(texts: string[]): Editor {
  const content: JSONContent = {
    type: "doc",
    content: texts.map((text) => ({ type: "docParagraph", content: [{ type: "text", text }] })),
  };
  const editor = new Editor({ extensions: docxExtensions(), content });
  editors.push(editor);
  return editor;
}

function setClipboard(value: Partial<Clipboard> | undefined): void {
  if (value === undefined) {
    Reflect.deleteProperty(navigator, "clipboard");
    return;
  }
  Object.defineProperty(navigator, "clipboard", { value, configurable: true });
}

function setExecCommand(impl: (() => boolean) | undefined): void {
  if (impl === undefined) {
    Reflect.deleteProperty(document, "execCommand");
    return;
  }
  Object.defineProperty(document, "execCommand", { value: impl, configurable: true });
}

function documentText(editor: Editor): string {
  return editor.state.doc.textBetween(0, editor.state.doc.content.size, "\n");
}

/** End of the last paragraph, where a paste lands. */
function caretAtEnd(editor: Editor): void {
  editor.commands.setTextSelection(Math.max(1, editor.state.doc.content.size - 1));
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  setClipboard(undefined);
  setExecCommand(undefined);
});

describe("selection verbs", () => {
  it("selects the whole document from the menu verb", () => {
    const editor = createEditor(["alpha beta", "gamma"]);
    selectAll(editor);
    expect(editor.state.selection.from).toBe(0);
    expect(editor.state.selection.to).toBe(editor.state.doc.content.size);
  });

  it("inserts pasted plain text one paragraph per line", () => {
    const editor = createEditor(["start"]);
    caretAtEnd(editor);
    expect(insertPastePayload(editor, { html: "", text: "one\ntwo" })).toBe(true);
    expect(documentText(editor)).toBe("start\none\ntwo");
  });

  it("inserts pasted HTML through the editor's paste rules", () => {
    const editor = createEditor(["start"]);
    caretAtEnd(editor);
    expect(insertPastePayload(editor, { html: "<p>rich</p>", text: "rich" })).toBe(true);
    expect(documentText(editor)).toBe("start\nrich");
  });
});

describe("copy and cut", () => {
  it("copies through the legacy command when the async clipboard is absent", async () => {
    const editor = createEditor(["alpha", "keep"]);
    editor.commands.setTextSelection({ from: 1, to: 6 });
    const exec = vi.fn(() => true);
    setExecCommand(exec);
    await expect(copySelection(editor)).resolves.toBe(true);
    expect(exec).toHaveBeenCalledWith("copy");
  });

  it("refocuses the editor before the legacy copy command", async () => {
    const editor = createEditor(["alpha", "keep"]);
    editor.commands.setTextSelection({ from: 1, to: 6 });
    const requestFrame = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 0;
    });
    const focus = vi.spyOn(editor.view, "focus");
    setExecCommand(() => true);
    await expect(copySelection(editor)).resolves.toBe(true);
    expect(focus).toHaveBeenCalled();
    focus.mockRestore();
    requestFrame.mockRestore();
  });

  it("falls back to writing the selection as plain text", async () => {
    const editor = createEditor(["alpha", "keep"]);
    editor.commands.setTextSelection({ from: 1, to: 6 });
    const writeText = vi.fn(async () => undefined);
    setClipboard({ writeText });
    await expect(copySelection(editor)).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("alpha");
  });

  it("reports false without a selection or a writable clipboard", async () => {
    const editor = createEditor(["alpha", "keep"]);
    editor.commands.setTextSelection(1);
    await expect(copySelection(editor)).resolves.toBe(false);

    editor.commands.setTextSelection({ from: 1, to: 6 });
    await expect(copySelection(editor)).resolves.toBe(false);
  });

  it("cuts only after the copy landed and deletes the selection", async () => {
    const editor = createEditor(["alpha", "keep"]);
    editor.commands.setTextSelection({ from: 1, to: 6 });
    setExecCommand(() => true);
    await expect(cutSelection(editor)).resolves.toBe(true);
    expect(documentText(editor)).toBe("keep");
  });

  it("refuses to cut when the copy failed", async () => {
    const editor = createEditor(["alpha", "keep"]);
    editor.commands.setTextSelection({ from: 1, to: 6 });
    await expect(cutSelection(editor)).resolves.toBe(false);
    expect(documentText(editor)).toBe("alpha\nkeep");
  });
});

describe("readClipboardPayload", () => {
  it("prefers the rich payload and keeps its plain-text twin", async () => {
    const htmlItem = {
      types: ["text/html", "text/plain"],
      getType: vi.fn(async (type: string) => ({ text: async () => (type === "text/html" ? "<p>rich</p>" : "rich") })),
    };
    setClipboard({ read: vi.fn(async () => [htmlItem]) } as unknown as Partial<Clipboard>);
    await expect(readClipboardPayload()).resolves.toEqual({ html: "<p>rich</p>", text: "rich" });
  });

  it("falls back to readText when read is unavailable, denied or empty", async () => {
    setClipboard({ readText: vi.fn(async () => "plain") });
    await expect(readClipboardPayload()).resolves.toEqual({ html: "", text: "plain" });

    setClipboard({
      read: vi.fn(async () => {
        throw new Error("denied");
      }),
      readText: vi.fn(async () => "plain"),
    });
    await expect(readClipboardPayload()).resolves.toEqual({ html: "", text: "plain" });

    setClipboard({ readText: vi.fn(async () => "") });
    await expect(readClipboardPayload()).resolves.toBeNull();
    await expect(readClipboardText()).resolves.toBe("");
  });

  it("reads nothing without a clipboard", async () => {
    setClipboard(undefined);
    await expect(readClipboardPayload()).resolves.toBeNull();
  });
});
