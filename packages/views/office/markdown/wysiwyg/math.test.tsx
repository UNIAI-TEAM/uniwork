// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import { createMarkdownEditorExtensions } from "./extensions";
import {
  MathPopover,
  applyMath,
  createMathPasteExtension,
  insertMath,
  parseMathPaste,
  readMathSelection,
} from "./math";

initI18n();
beforeEach(async () => {
  await setLocale("en");
});

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
  document.body.innerHTML = "";
});

/** The Markdown WYSIWYG stack (shared math nodes included) plus the normaliser. */
function makeEditor(): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    extensions: [...createMarkdownEditorExtensions(), createMathPasteExtension()],
    content: "<p>before</p>",
  });
}

/** Fire a real paste event so the whole handlePaste chain runs. */
function paste(source: Editor, text: string): void {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { files: [], getData: (type: string) => (type === "text/plain" ? text : "") },
  });
  source.view.dom.dispatchEvent(event);
}

function findAll(node: JSONContent, type: string, acc: JSONContent[] = []): JSONContent[] {
  if (node.type === type) acc.push(node);
  for (const child of node.content ?? []) findAll(child, type, acc);
  return acc;
}

describe("parseMathPaste", () => {
  it("classifies the three delimiters and leaves prose alone", () => {
    expect(parseMathPaste("\\(E = mc^2\\)")).toEqual({ kind: "inline", expression: "E = mc^2" });
    expect(parseMathPaste("\\[x^2 + y^2 = z^2\\]")).toEqual({ kind: "block", expression: "x^2 + y^2 = z^2" });
    expect(parseMathPaste("$$\\frac{a}{b}$$")).toEqual({ kind: "block", expression: "\\frac{a}{b}" });
    // Not a formula: the markdown paste path keeps it.
    expect(parseMathPaste("costs $5 to $9")).toBeNull();
    expect(parseMathPaste("see \\(x\\) in the text")).toBeNull();
    expect(parseMathPaste("   ")).toBeNull();
  });
});

describe("math paste normalisation", () => {
  it("turns a pasted \\(…\\) into an inline math node", async () => {
    editor = makeEditor();
    await act(async () => {
      paste(editor!, "\\(E = mc^2\\)");
    });
    await waitFor(() => expect(findAll(editor!.getJSON(), "inlineMath")).toHaveLength(1));
    expect(findAll(editor!.getJSON(), "inlineMath")[0]?.attrs?.expression).toBe("E = mc^2");
    expect(findAll(editor!.getJSON(), "blockMath")).toHaveLength(0);
  });

  it("turns a pasted \\[…\\] into a block math node", async () => {
    editor = makeEditor();
    await act(async () => {
      paste(editor!, "\\[x^2 + y^2 = z^2\\]");
    });
    await waitFor(() => expect(findAll(editor!.getJSON(), "blockMath")).toHaveLength(1));
    expect(findAll(editor!.getJSON(), "blockMath")[0]?.attrs?.expression).toBe("x^2 + y^2 = z^2");
  });

  it("turns a pasted $$…$$ into a block math node", async () => {
    editor = makeEditor();
    await act(async () => {
      paste(editor!, "$$\\frac{a}{b}$$");
    });
    await waitFor(() => expect(findAll(editor!.getJSON(), "blockMath")).toHaveLength(1));
    expect(findAll(editor!.getJSON(), "blockMath")[0]?.attrs?.expression).toBe("\\frac{a}{b}");
  });

  it("leaves a pasted dollar amount as text", async () => {
    editor = makeEditor();
    await act(async () => {
      paste(editor!, "Revenue grew from $100 to $120.");
    });
    await waitFor(() => expect(editor!.getText()).toContain("$100 to $120."));
    expect(findAll(editor!.getJSON(), "inlineMath")).toHaveLength(0);
    expect(findAll(editor!.getJSON(), "blockMath")).toHaveLength(0);
  });
});

describe("insertMath / applyMath", () => {
  it("inserts inline and block nodes and edits the one under the cursor", async () => {
    editor = makeEditor();
    await act(async () => {
      insertMath(editor, "inline", "a^2");
    });
    await waitFor(() => expect(findAll(editor!.getJSON(), "inlineMath")).toHaveLength(1));
    await act(async () => {
      insertMath(editor, "block", "b^2");
    });
    await waitFor(() => expect(findAll(editor!.getJSON(), "blockMath")).toHaveLength(1));
    // Editing the block node in place keeps one node and replaces its source.
    // Selecting the node is what a click on it does in the product.
    let blockPos = -1;
    editor!.state.doc.descendants((node, pos) => {
      if (node.type.name === "blockMath") blockPos = pos;
      return true;
    });
    act(() => {
      editor!.commands.setNodeSelection(blockPos);
    });
    const target = readMathSelection(editor);
    expect(target?.kind).toBe("block");
    await act(async () => {
      applyMath(editor, "block", "c^2");
    });
    await waitFor(() => expect(findAll(editor!.getJSON(), "blockMath")[0]?.attrs?.expression).toBe("c^2"));
    expect(findAll(editor!.getJSON(), "blockMath")).toHaveLength(1);
  });
});

describe("MathPopover", () => {
  it("applies a formula through the caller's callback", async () => {
    const onApply = vi.fn();
    render(<MathPopover math={null} onApply={onApply} />);
    fireEvent.click(screen.getByRole("button", { name: "Block formula" }));
    const input = await screen.findByLabelText("Enter LaTeX");
    fireEvent.change(input, { target: { value: "e^{i\\pi}" } });
    fireEvent.click(screen.getByRole("button", { name: "Insert block formula" }));
    await waitFor(() => expect(onApply).toHaveBeenCalledWith("block", "e^{i\\pi}"));
    cleanup();
  });
});
