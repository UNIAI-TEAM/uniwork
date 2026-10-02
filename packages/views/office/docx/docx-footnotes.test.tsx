import { Editor } from "@tiptap/core";
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { setPageGaps, type RendererParsed } from "@uniwork/office-upstream/docs-renderer-editor";
import { createDocxFootnotes, docxGapFootnotes } from "./docx-footnotes";
import { DocxNoteAreas } from "./docx-note-areas";
import { buildPaginationFrame, docxBlockMeta } from "./docx-pagination";
import { docxExtensions } from "./docx-schema";

const section = { settings: { pageWidth: 11906, pageHeight: 16838, marginTop: 1440, marginRight: 1440, marginBottom: 1440, marginLeft: 1440 }, firstBlockIndex: 0, lastBlockIndex: 1 };
const parsed: RendererParsed = {
  blocks: [
    { type: "paragraph", docxIndex: 0, runs: [{ text: "Early body", noteRef: { kind: "footnote", id: "1" } }] },
    { type: "paragraph", docxIndex: 1, runs: [{ text: "Final body", noteRef: { kind: "footnote", id: "2" } }] },
  ],
  footnotes: [{ id: "1", text: "Early note" }, { id: "2", text: "Final note" }],
  noteNumbers: { "footnote:1": 3, "footnote:2": 4 },
};
const slices = [{ start: 0, end: 200, section: 0 }, { start: 200, end: 280, section: 0 }];

describe("per-page DOCX footnotes (F1)", () => {
  it("reserves note height even when the paragraph has no keep/break metadata", () => {
    const notes = createDocxFootnotes(parsed, [section]);
    const meta = docxBlockMeta(parsed, notes.bandsOf)(0);
    expect(meta?.footnoteBands).toHaveLength(1);
    expect(meta?.footnoteExtraPx).toBeGreaterThan(0);
    expect(meta?.footnoteExtraPx).toBe(meta?.footnoteBands?.[0]?.heightPx);
  });

  it("assigns notes to reference-line pages when a paragraph is split", () => {
    const split = { ...parsed, blocks: [{ ...parsed.blocks[0]!, runs: [...parsed.blocks[0]!.runs!, ...parsed.blocks[1]!.runs!] }] };
    const notes = createDocxFootnotes(split, [section]);
    const pages = notes.pageItems([{ top: 0, height: 280, docxIndex: 0, noteBands: [{ offset: 10, height: 20 }, { offset: 220, height: 20 }] }], slices);
    expect(pages.map((items) => items.map((item) => item.id))).toEqual([["1"], ["2"]]);
    expect(pages.map((items) => items[0]?.no)).toEqual([3, 4]);
  });

  it("includes references in nested table cells in the reservation", () => {
    const doc = { ...parsed, blocks: [{ type: "table", docxIndex: 0, table: { rows: [[{ richParas: [], nestedTables: [{ rows: [[{ richParas: [{ runs: parsed.blocks[0]!.runs }] }]] }] }]] } }] };
    const notes = createDocxFootnotes(doc, [section]);
    expect(docxBlockMeta(doc, notes.bandsOf)(0)?.footnoteBands).toHaveLength(1);
  });

  it("puts the early note in its page gap, preserving the full paper height", () => {
    const first = document.createElement("p"), second = document.createElement("p");
    const blocks = [{ top: 0, height: 80, docxIndex: 0, el: first }, { top: 200, height: 80, docxIndex: 1, el: second }];
    const notes = createDocxFootnotes(parsed, [section]);
    const frame = buildPaginationFrame({ spec: { sections: [section], defaultHeader: null, defaultFooter: null, hfParts: undefined, evenAndOddHeaders: false, parsedDoc: parsed }, live: [section], blocks, hfHeights: [{ headerPx: 0, footerPx: 0 }], slices, pageNotes: notes.pageItems(blocks, slices) });
    expect(frame.gaps).toHaveLength(1);
    const gap = frame.gaps[0]!;
    expect(gap.notes?.textContent).toContain("Early note");
    expect(gap.notes?.textContent).not.toContain("Final note");
    expect(gap.notes?.querySelector(".page-gap-note")?.getAttribute("data-note-id")).toBe("1");
    expect(gap.notes?.querySelector(".page-gap-note")?.hasAttribute("title")).toBe(false);
    expect(parseFloat(gap.notes?.style.top ?? "0")).toBeGreaterThan(5);
    const available = section.settings.pageHeight * 96 / 1440 - 192;
    expect(Math.abs(gap.metrics.marginBottom - 96 - (available - 200))).toBeLessThan(1);
  });

  it("skips only notes actually mounted in a gap and keeps final-page notes", async () => {
    const editor = new Editor({ extensions: docxExtensions(), content: { type: "doc", content: [{ type: "docParagraph", content: [{ type: "text", text: "Body" }] }] } });
    const pm = editor.view.dom;
    document.body.append(pm);
    try {
      const { container } = render(<DocxNoteAreas editor={editor} parsed={parsed} />);
      const noteArea = docxGapFootnotes(createDocxFootnotes(parsed, [section]).pageItems([{ top: 0, height: 80, docxIndex: 0 }], slices)[0]!, section.settings);
      setPageGaps(editor.view, [{ el: editor.view.dom.firstElementChild as HTMLElement, metrics: { marginTop: 96, marginBottom: 96 + noteArea.height, marginLeft: 96, marginRight: 96 }, notes: noteArea.notes, notesKey: noteArea.notesKey }]);
      await waitFor(() => {
        const area = container.querySelector(".page-notes:not(.page-endnotes)");
        expect(area?.textContent).toContain("Final note");
        expect(area?.textContent).not.toContain("Early note");
      });
      expect(editor.view.dom.querySelector(".page-gap-notes")?.textContent).toContain("Early note");
      expect(container.querySelectorAll("button")).toHaveLength(0);
    } finally { editor.destroy(); pm.remove(); }
  });
});
