import { Editor, type JSONContent } from "@tiptap/core";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { docxExtensions } from "../docx-schema";
import { DocxContextMenuSurface } from "./index";
import { createDocxPasteOptionsController, type DocxPasteOptionsController } from "./use-docx-paste-options";

const editors: Editor[] = [];
const controllers: DocxPasteOptionsController[] = [];

const paragraph = (text: string): JSONContent => ({
  type: "docParagraph",
  content: [{ type: "text", text }],
});

const cell = (text: string): JSONContent => ({ type: "docTableCell", content: [paragraph(text)] });

const richDocument: JSONContent = {
  type: "doc",
  content: [
    paragraph("Body text"),
    {
      type: "docTable",
      content: [
        { type: "docTableRow", content: [cell("A1"), cell("B1")] },
        { type: "docTableRow", content: [cell("A2"), cell("B2")] },
      ],
    },
    {
      type: "docParagraph",
      content: [
        { type: "text", text: "visit " },
        { type: "text", text: "uniwork", marks: [{ type: "link", attrs: { href: "https://uniwork.vn" } }] },
      ],
    },
  ],
};

function createEditor(editable = true): Editor {
  const editor = new Editor({ extensions: docxExtensions(), content: richDocument, editable });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose();
  for (const editor of editors.splice(0)) editor.destroy();
  Reflect.deleteProperty(navigator, "clipboard");
});

/** First character of the text node carrying `needle`. */
function textPosition(editor: Editor, needle: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text === needle) {
      found = pos + 1;
      return false;
    }
    return true;
  });
  return found;
}

function rowCount(editor: Editor): number {
  let rows = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === "docTableRow") rows += 1;
    return true;
  });
  return rows;
}

function linkHref(editor: Editor): string | null {
  let href: string | null = null;
  editor.state.doc.descendants((node) => {
    for (const mark of node.marks) {
      if (mark.type.name === "link") href = String(mark.attrs.href);
    }
    return true;
  });
  return href;
}

function renderSurface(
  editor: Editor,
  options: { readOnly?: boolean; pasteOptions?: DocxPasteOptionsController } = {},
) {
  return render(
    <DocxContextMenuSurface editor={editor} readOnly={options.readOnly} pasteOptions={options.pasteOptions}>
      <div data-testid="surface-child">Document</div>
    </DocxContextMenuSurface>,
  );
}

async function openMenu(): Promise<HTMLElement> {
  fireEvent.contextMenu(screen.getByTestId("surface-child"));
  return screen.findByTestId("docx-context-menu");
}

async function closeMenu(menu: HTMLElement): Promise<void> {
  fireEvent.keyDown(menu, { key: "Escape" });
  await waitFor(() => expect(screen.queryByTestId("docx-context-menu")).toBeNull());
}

describe("DocxContextMenuSurface", () => {
  it("opens the clipboard verbs on right click, gated by the selection, and closes on Escape", async () => {
    const editor = createEditor();
    renderSurface(editor);
    const menu = await openMenu();

    expect(within(menu).getAllByRole("menuitem")).toHaveLength(5);
    expect(screen.getByTestId("docx-menu-cut")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("docx-menu-copy")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("docx-menu-paste")).not.toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("docx-menu-pastePlain")).not.toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("docx-menu-selectAll")).not.toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByTestId("docx-menu-insertRowBelow")).toBeNull();
    expect(screen.queryByTestId("docx-menu-openLink")).toBeNull();

    await closeMenu(menu);
  });

  it("enables cut and copy with a selection and selects all from the menu", async () => {
    const editor = createEditor();
    const start = textPosition(editor, "Body text");
    editor.commands.setTextSelection({ from: start, to: start + 4 });
    renderSurface(editor);
    const menu = await openMenu();

    expect(screen.getByTestId("docx-menu-cut")).not.toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("docx-menu-copy")).not.toHaveAttribute("aria-disabled", "true");

    fireEvent.click(screen.getByTestId("docx-menu-selectAll"));
    expect(editor.state.selection.from).toBe(0);
    expect(editor.state.selection.to).toBe(editor.state.doc.content.size);
    await waitFor(() => expect(screen.queryByTestId("docx-context-menu")).toBeNull());
  });

  it("runs a table command when the click is in a table", async () => {
    const editor = createEditor();
    editor.commands.setTextSelection(textPosition(editor, "A1") + 1);
    renderSurface(editor);
    await openMenu();

    expect(screen.getByTestId("docx-menu-insertRowBelow")).toBeInTheDocument();
    expect(screen.getByTestId("docx-menu-mergeCells")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("docx-menu-splitCell")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("docx-menu-toggleHeaderRow")).not.toHaveAttribute("aria-disabled", "true");

    fireEvent.click(screen.getByTestId("docx-menu-insertRowBelow"));
    await waitFor(() => expect(rowCount(editor)).toBe(3));
  });

  it("removes and edits the link under the caret from the menu", async () => {
    const editor = createEditor();
    editor.commands.setTextSelection(textPosition(editor, "uniwork"));
    renderSurface(editor);

    await openMenu();
    expect(screen.getByTestId("docx-menu-openLink")).not.toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByTestId("docx-menu-removeLink"));
    await waitFor(() => expect(linkHref(editor)).toBeNull());

    editor.commands.undo();
    expect(linkHref(editor)).toBe("https://uniwork.vn");
    editor.commands.setTextSelection(textPosition(editor, "uniwork"));
    await openMenu();
    fireEvent.click(screen.getByTestId("docx-menu-editLink"));

    const dialog = await screen.findByTestId("docx-link-dialog");
    expect(dialog).toBeInTheDocument();
    const url = screen.getByTestId("docx-link-url") as HTMLInputElement;
    expect(url.value).toBe("https://uniwork.vn");
    fireEvent.change(url, { target: { value: "https://example.com" } });
    fireEvent.click(screen.getByTestId("docx-link-submit"));
    await waitFor(() => expect(linkHref(editor)).toBe("https://example.com"));
    await waitFor(() => expect(screen.queryByTestId("docx-link-dialog")).toBeNull());
  });

  it("keeps copy and link opening live on a read-only document while blocking mutations", async () => {
    const editor = createEditor(false);
    const start = textPosition(editor, "Body text");
    editor.commands.setTextSelection({ from: start, to: start + 4 });
    renderSurface(editor, { readOnly: true });
    const menu = await openMenu();

    expect(screen.getByTestId("docx-menu-copy")).not.toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("docx-menu-cut")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("docx-menu-paste")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("docx-menu-pastePlain")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("docx-menu-selectAll")).not.toHaveAttribute("aria-disabled", "true");
    await closeMenu(menu);

    editor.commands.setTextSelection(textPosition(editor, "A1") + 1);
    await openMenu();
    expect(screen.getByTestId("docx-menu-insertRowBelow")).toHaveAttribute("aria-disabled", "true");
    await closeMenu(screen.getByTestId("docx-context-menu"));

    editor.commands.setTextSelection(textPosition(editor, "uniwork"));
    await openMenu();
    expect(screen.getByTestId("docx-menu-openLink")).not.toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("docx-menu-editLink")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("docx-menu-removeLink")).toHaveAttribute("aria-disabled", "true");
  });

  it("pastes from the clipboard and shows the paste chip", async () => {
    const editor = createEditor();
    const controller = createDocxPasteOptionsController(editor);
    controllers.push(controller);
    vi.spyOn(editor.view, "coordsAtPos").mockReturnValue({ left: 10, right: 20, top: 30, bottom: 40 });
    const htmlItem = {
      types: ["text/html", "text/plain"],
      getType: vi.fn(async (type: string) => ({ text: async () => (type === "text/html" ? "<p>pasted</p>" : "pasted") })),
    };
    Object.defineProperty(navigator, "clipboard", {
      value: { read: vi.fn(async () => [htmlItem]) },
      configurable: true,
    });

    const end = editor.state.doc.content.size - 1;
    editor.commands.setTextSelection(end);
    renderSurface(editor, { pasteOptions: controller });
    await openMenu();
    await act(async () => {
      fireEvent.click(screen.getByTestId("docx-menu-paste"));
      await Promise.resolve();
    });

    const chip = await screen.findByTestId("docx-paste-chip");
    expect(chip).toBeInTheDocument();
    expect(editor.state.doc.textBetween(0, editor.state.doc.content.size, "\n")).toContain("pasted");

    fireEvent.click(screen.getByTestId("docx-paste-text"));
    await waitFor(() => expect(screen.queryByTestId("docx-paste-chip")).toBeNull());
  });
});
