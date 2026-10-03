// The notes save path is proven end-to-end on the real vendored engine: a
// controller insert/edit/delete must reach word/footnotes.xml (or a newly
// created word/endnotes.xml) through the one serializeSnapshot path, the
// in-text reference must save as w:footnoteReference/w:endnoteReference, and
// an untouched notes part must stay byte-identical.
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { bindDocxEngine, createDocxAdapter } from "@uniwork/office-engine/docx";
import { parseDocx, saveDocx } from "@uniwork/office-upstream/docs-renderer-editor";
import { createDocxTiptapHandle } from "../use-docx-tiptap-handle";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const CT = "http://schemas.openxmlformats.org/package/2006/content-types";
const REL = "http://schemas.openxmlformats.org/package/2006/relationships";

const FOOTNOTES_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:footnotes xmlns:w="${W}">` +
  `<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
  `<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>` +
  `<w:footnote w:id="1"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> original note</w:t></w:r></w:p></w:footnote>` +
  `<w:footnote w:id="2"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> second note</w:t></w:r></w:p></w:footnote>` +
  `</w:footnotes>`;

async function fixture(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
      `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
      `<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/></Types>`,
  );
  zip.file("_rels/.rels", `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file(
    "word/_rels/document.xml.rels",
    `<Relationships xmlns="${REL}"><Relationship Id="rStyles" Type="${R}/styles" Target="styles.xml"/><Relationship Id="rFoot" Type="${R}/footnotes" Target="footnotes.xml"/></Relationships>`,
  );
  zip.file(
    "word/styles.xml",
    `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`,
  );
  zip.file("word/footnotes.xml", FOOTNOTES_XML);
  zip.file(
    "word/document.xml",
    `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
      `<w:p><w:r><w:t>before</w:t></w:r><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteReference w:id="1"/></w:r><w:r><w:t xml:space="preserve"> after</w:t></w:r></w:p>` +
      `<w:p><w:r><w:t>plain</w:t></w:r></w:p>` +
      `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>` +
      `</w:body></w:document>`,
  );
  return zip.generateAsync({ type: "uint8array" });
}

function openHandle(bytes: Uint8Array) {
  const adapter = createDocxAdapter({ engine: bindDocxEngine({ parseDocx, saveDocx }) });
  const handle = createDocxTiptapHandle({ adapter, documentId: "doc-notes", readBytes: async () => bytes });
  return handle.open().then(() => handle);
}

async function save(handle: Awaited<ReturnType<typeof openHandle>>): Promise<Uint8Array> {
  const snapshot = await handle.captureSnapshot();
  return (await handle.serializeSnapshot(snapshot)).bytes;
}

const partOf = async (bytes: Uint8Array, path: string): Promise<string> => {
  const zip = await JSZip.loadAsync(bytes);
  const file = zip.file(path);
  return file ? file.async("string") : "";
};

describe("DOCX notes save round trip", () => {
  it("seeds the pane from the parse and inserts a footnote into the saved part", async () => {
    const handle = await openHandle(await fixture());
    try {
      expect(handle.commands?.getState().docxNotes.footnotes.map((n) => n.id)).toEqual(["1", "2"]);
      const note = handle.commands?.insertDocxNote("footnote", "added note");
      expect(note).toMatchObject({ id: "3", text: "added note" });

      const saved = await save(handle);
      const footnotes = await partOf(saved, "word/footnotes.xml");
      expect(footnotes).toContain('w:id="3"');
      expect(footnotes).toContain("added note");
      // list order is part order: the new note comes after the original ones
      expect(footnotes.indexOf('w:id="3"')).toBeGreaterThan(footnotes.indexOf('w:id="2"'));
      const document = await partOf(saved, "word/document.xml");
      expect(document).toContain('w:footnoteReference w:id="3"');
    } finally {
      await handle.dispose();
    }
  });

  it("creates a new endnotes part with separators, rels and content type", async () => {
    const handle = await openHandle(await fixture());
    try {
      expect(handle.commands?.getState().docxNotes.endnotes).toEqual([]);
      expect(handle.commands?.insertDocxNote("endnote", "closing thought")).toMatchObject({ id: "1" });

      const saved = await save(handle);
      const endnotes = await partOf(saved, "word/endnotes.xml");
      expect(endnotes).toContain('w:endnote w:type="separator" w:id="-1"');
      expect(endnotes).toContain('w:endnote w:id="1"');
      expect(endnotes).toContain("closing thought");
      const document = await partOf(saved, "word/document.xml");
      expect(document).toContain('w:endnoteReference w:id="1"');
      const rels = await partOf(saved, "word/_rels/document.xml.rels");
      expect(rels).toContain("/endnotes");
      const types = await partOf(saved, "[Content_Types].xml");
      expect(types).toContain("/word/endnotes.xml");
    } finally {
      await handle.dispose();
    }
  });

  it("edits a note's text and deletes one with renumbering in the saved part", async () => {
    const handle = await openHandle(await fixture());
    try {
      expect(handle.commands?.setDocxNoteText("footnote", "2", "rewritten")).toBe(true);
      expect(handle.commands?.deleteDocxNote("footnote", "1")).toBe(true);

      const saved = await save(handle);
      const footnotes = await partOf(saved, "word/footnotes.xml");
      expect(footnotes).toContain("rewritten");
      expect(footnotes).not.toContain("second note");
      expect(footnotes).not.toContain("original note");
      expect(footnotes).not.toContain('w:id="1"');
      // note 2 is now first in part order — the saved part numbers it 1
      expect(footnotes.indexOf('w:id="2"')).toBeLessThan(footnotes.indexOf("rewritten"));
      const document = await partOf(saved, "word/document.xml");
      expect(document).not.toContain('w:footnoteReference w:id="1"');
    } finally {
      await handle.dispose();
    }
  });

  it("keeps an untouched notes part byte-identical across a body edit", async () => {
    const source = await fixture();
    const handle = await openHandle(source);
    try {
      // a body edit only: no note list changed, so no set_notes op may run
      handle.commands?.insertSymbol("X");
      const saved = await save(handle);
      const before = await JSZip.loadAsync(source);
      const after = await JSZip.loadAsync(saved);
      expect(await after.file("word/footnotes.xml")!.async("uint8array")).toEqual(
        await before.file("word/footnotes.xml")!.async("uint8array"),
      );
      // no endnotes option was sent, so no part may appear
      expect(after.file("word/endnotes.xml")).toBeNull();
      // the paragraph edit still re-emits the reference marker
      expect(await after.file("word/document.xml")!.async("string")).toContain('w:footnoteReference w:id="1"');
    } finally {
      await handle.dispose();
    }
  });
});
