import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Editor } from "@tiptap/core";
import JSZip from "jszip";
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { parseDocx } from "@uniwork/office-upstream/docs-renderer-editor";
import { DocxNoteAreas } from "./docx-note-areas";
import { docxExtensions } from "./docx-schema";

describe("DOCX display-only note areas", () => {
  it("renders the fixture footnote and endnote without editing controls", async () => {
    const bytes = readFileSync(resolve(__dirname, "../../../../docs/office/g0/fixtures/files/docs/docx-vietnamese.docx"));
    // Extend the real footnote fixture with an endnote part: the measured eight
    // fixtures have no endnotes, so this also covers the separate endnote area.
    const zip = await JSZip.loadAsync(bytes);
    zip.file("word/endnotes.xml", '<w:endnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:endnote w:id="1"><w:p><w:r><w:t>Fixture endnote</w:t></w:r></w:p></w:endnote></w:endnotes>');
    const parsed = await parseDocx(await zip.generateAsync({ type: "uint8array" }));
    const editor = new Editor({ extensions: docxExtensions(), content: { type: "doc", content: [{ type: "docParagraph" }] } });
    try {
      const { container } = render(<DocxNoteAreas editor={editor} parsed={parsed} />);
      const notes = parsed as unknown as { footnotes: { text: string }[]; endnotes: { text: string }[] };
      expect(notes.footnotes.length).toBeGreaterThan(0);
      expect(notes.endnotes.length).toBeGreaterThan(0);
      expect(container.querySelector(".page-notes:not(.page-endnotes)")?.textContent).toContain(notes.footnotes[0]?.text);
      expect(container.querySelector(".page-endnotes")?.textContent).toContain(notes.endnotes[0]?.text);
      expect(container.querySelectorAll("button")).toHaveLength(0);
    } finally { editor.destroy(); }
  });

  it("anchors endnotes below the last body block rather than the page bottom", async () => {
    const editor = new Editor({ extensions: docxExtensions(), content: { type: "doc", content: [{ type: "docParagraph" }] } });
    const wrap = document.createElement("div");
    wrap.className = "page-wrap";
    wrap.append(editor.view.dom);
    document.body.append(wrap);
    Object.defineProperty(wrap, "getBoundingClientRect", { value: () => ({ top: 40 }) });
    Object.defineProperty(editor.view.dom.firstElementChild, "getBoundingClientRect", { value: () => ({ bottom: 300, height: 30 }) });
    try {
      const { container } = render(<DocxNoteAreas editor={editor} parsed={{ blocks: [], footnotes: [], endnotes: [{ id: "1", text: "Endnote" }] }} />);
      await waitFor(() => expect((container.querySelector(".page-endnotes") as HTMLElement)?.style.top).toBe("260px"));
    } finally { editor.destroy(); wrap.remove(); }
  });
});
