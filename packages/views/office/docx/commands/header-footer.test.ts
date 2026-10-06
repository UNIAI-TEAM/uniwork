// A13 wire (UNI-924): the header/footer command area over a real editor -
// seed from the engine parse, record the pending set_header_footer /
// set_title_pg / set_even_odd_headers edits, replay them onto a save session
// and re-seed them from a draft snapshot. This is the seam the editing handle
// now calls; without it the dialog is reachable but dead.
import { Editor, type JSONContent } from "@tiptap/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { docxExtensions } from "../docx-schema";
import { createHeaderFooterCommands } from "./header-footer";

const editors: Editor[] = [];

function editorWith(text = "body"): Editor {
  const content: JSONContent = {
    type: "doc",
    content: [{ type: "docParagraph", attrs: { docxIndex: 0 }, content: [{ type: "text", text }] }],
  };
  const editor = new Editor({ extensions: docxExtensions(), content });
  editors.push(editor);
  return editor;
}

/** The engine parse slice the area reads (header-footer-state.ts). */
const PARSED = {
  headerText: "Confidential",
  headerHasPageNumber: true,
  titlePg: true,
};

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  vi.restoreAllMocks();
});

describe("createHeaderFooterCommands", () => {
  it("is inert before a document opens", () => {
    const area = createHeaderFooterCommands({ getEditor: () => null });
    expect(area.readState(null)).toEqual({ docxHeaderFooter: null });
    expect(area.commands.setDocxHeaderFooterSlot("header", { text: "x" })).toBe(false);
    expect(area.commands.setDocxTitlePg(true)).toBe(false);
    expect(area.commands.setDocxEvenOddHeaders(true)).toBe(false);
    expect(area.commands.listDocxHeaderFooterEdits()).toEqual([]);
  });

  it("seeds the read state from the parse and records the slot/flag edits", () => {
    const editor = editorWith();
    const area = createHeaderFooterCommands({ getEditor: () => editor });
    area.commands.seedDocxHeaderFooter(PARSED);

    const seeded = area.readState(editor).docxHeaderFooter;
    expect(seeded?.slots.header.value).toEqual({ text: "Confidential", pageNumber: true });
    expect(seeded?.slots.footer.value).toBeNull();
    expect(seeded?.titlePg).toBe(true);

    expect(area.commands.setDocxHeaderFooterSlot("footer", { text: "Draft" })).toBe(true);
    expect(area.commands.setDocxEvenOddHeaders(true)).toBe(true);
    // An unchanged flag is a no-op: it records nothing.
    expect(area.commands.setDocxTitlePg(true)).toBe(false);
    expect(area.readState(editor).docxHeaderFooter?.slots.footer.value).toEqual({ text: "Draft" });

    expect(area.commands.listDocxHeaderFooterEdits()).toEqual([
      { op: "set_header_footer", slot: "footer", hf: { text: "Draft" } },
      { op: "set_even_odd_headers", value: true },
    ]);
  });

  it("replays the pending edits onto the save session in order", () => {
    const editor = editorWith();
    const area = createHeaderFooterCommands({ getEditor: () => editor });
    area.commands.seedDocxHeaderFooter(PARSED);
    area.commands.setDocxHeaderFooterSlot("header", { text: "New header" });
    area.commands.setDocxTitlePg(false);

    const adapter = { edit: vi.fn() };
    area.commands.applyDocxHeaderFooterEdits(adapter, "save-ref");

    expect(adapter.edit.mock.calls).toEqual([
      ["save-ref", { op: "set_header_footer", slot: "header", hf: { text: "New header" } }],
      ["save-ref", { op: "set_title_pg", value: false }],
    ]);
  });

  it("re-seeds the pending edits and the display state from a draft snapshot", () => {
    const editor = editorWith();
    const area = createHeaderFooterCommands({ getEditor: () => editor });
    area.commands.seedDocxHeaderFooter(PARSED);

    area.commands.restoreDocxHeaderFooterEdits([
      { op: "set_header_footer", slot: "headerEven", hf: { text: "Even header" } },
      { op: "set_even_odd_headers", value: true },
    ]);

    const restored = area.readState(editor).docxHeaderFooter;
    expect(restored?.slots.headerEven.value).toEqual({ text: "Even header" });
    expect(restored?.evenAndOddHeaders).toBe(true);
    // The replay reads back out unchanged, so a re-save is idempotent.
    expect(area.commands.listDocxHeaderFooterEdits()).toEqual([
      { op: "set_header_footer", slot: "headerEven", hf: { text: "Even header" } },
      { op: "set_even_odd_headers", value: true },
    ]);
  });
});
