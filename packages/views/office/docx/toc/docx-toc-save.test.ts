// B7 (UNI-924) save-path test: the inserted TOC/caption nodes ride the normal
// editor -> save plan path into the REAL vendored saveDocx. The TOC becomes a
// dirty TOC field (begin/separate/end fldChars + TOCn entries) Word rebuilds on
// open; the caption becomes a SEQ field whose cached number continues the
// document's own captions. Every other part stays byte-identical.
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { bindDocxEngine, createDocxAdapter } from "@uniwork/office-engine/docx";
import { parseDocx, saveDocx } from "@uniwork/office-upstream/docs-renderer-editor";
import { assertDocxPartsPreserved } from "../test-fixtures/docx-preservation";
import { createDocxTiptapHandle } from "../use-docx-tiptap-handle";

const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const ct = "http://schemas.openxmlformats.org/package/2006/content-types";

const PLAIN_PARA = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

const HEADING_PARA = (text: string, level: number, bookmark?: string) =>
  `<w:p><w:pPr><w:pStyle w:val="Heading${level}"/></w:pPr>` +
  (bookmark ? `<w:bookmarkStart w:id="7" w:name="${bookmark}"/><w:bookmarkEnd w:id="7"/>` : "") +
  `<w:r><w:t>${text}</w:t></w:r></w:p>`;

const CAPTION_PARA = (label: string, number: number, text: string) =>
  `<w:p><w:r><w:t xml:space="preserve">${label} </w:t></w:r>` +
  '<w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r>' +
  `<w:r><w:instrText xml:space="preserve"> SEQ ${label} \\* ARABIC </w:instrText></w:r>` +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
  `<w:r><w:t>${number}</w:t></w:r>` +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
  `<w:r><w:t xml:space="preserve"> ${text}</w:t></w:r></w:p>`;

async function fixture(options: { withCaption?: boolean } = {}): Promise<Uint8Array> {
  const body = [
    HEADING_PARA("Introduction", 1, "_Toc100"),
    HEADING_PARA("Details", 2),
    ...(options.withCaption ? [CAPTION_PARA("Figure", 1, "Existing chart")] : []),
    "<w:p/>",
  ];
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<Types xmlns="${ct}"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${r}/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file(
    "word/_rels/document.xml.rels",
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rStyles" Type="${r}/styles" Target="styles.xml"/></Relationships>`,
  );
  zip.file(
    "word/styles.xml",
    `<w:styles xmlns:w="${w}">` +
      '<w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style>' +
      "</w:styles>",
  );
  zip.file(
    "word/document.xml",
    `<w:document xmlns:w="${w}"><w:body>${body.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`,
  );
  return zip.generateAsync({ type: "uint8array" });
}

function handleFor(source: Uint8Array) {
  return createDocxTiptapHandle({
    adapter: createDocxAdapter({ engine: bindDocxEngine({ parseDocx, saveDocx }) }),
    documentId: "toc",
    readBytes: async () => source,
  });
}

async function partOf(bytes: Uint8Array, name: string): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const file = zip.file(name);
  if (!file) throw new Error("missing part " + name);
  return file.async("string");
}

describe("DOCX TOC save path", () => {
  it("keeps an untouched document byte-identical", async () => {
    const source = await fixture();
    const handle = handleFor(source);
    try {
      await handle.open();
      const snapshot = await handle.captureSnapshot();
      const saved = await handle.serializeSnapshot(snapshot);
      expect(saved.bytes).toEqual(source);
    } finally {
      await handle.dispose();
    }
  });

  it("writes the TOC field with its entries and stays otherwise byte-identical", async () => {
    const source = await fixture();
    const handle = handleFor(source);
    try {
      await handle.open();
      expect(handle.commands.insertDocxToc({ maxLevel: 3, pageNumbers: true, hyperlinks: true })).toEqual({
        outcome: "inserted",
        entries: 2,
      });
      const saved = await handle.serializeSnapshot(await handle.captureSnapshot());
      const document = await partOf(saved.bytes, "word/document.xml");
      expect(document).toContain(' TOC \\o "1-3" \\h \\z \\u ');
      expect(document).toContain('w:fldCharType="begin" w:dirty="true"');
      expect(document.match(/fldCharType="begin"/g)).toHaveLength(1);
      expect(document.match(/fldCharType="end"/g)).toHaveLength(1);
      expect(document).toContain('<w:pStyle w:val="TOC1"/>');
      expect(document).toContain('<w:pStyle w:val="TOC2"/>');
      expect(document).toContain('<w:tab w:val="right" w:leader="dot" w:pos="9350"/>');
      expect(document).toContain('<w:hyperlink w:anchor="_Toc100">');
      expect(document).toContain("Introduction");
      expect(document).toContain("Details");
      // the original heading paragraphs survive beside the field
      expect(document).toContain('<w:pStyle w:val="Heading1"/>');
      await assertDocxPartsPreserved(source, saved.bytes, false);
    } finally {
      await handle.dispose();
    }
  });

  it("reloads the saved TOC as tocLine entries", async () => {
    const source = await fixture();
    const handle = handleFor(source);
    try {
      await handle.open();
      handle.commands.insertDocxToc({ maxLevel: 2, pageNumbers: true, hyperlinks: true });
      const saved = await handle.serializeSnapshot(await handle.captureSnapshot());
      const parsed = await parseDocx(saved.bytes);
      interface TocLineBlock {
        fieldDisplay?: { kind?: string; left?: string };
      }
      const lines = parsed.blocks
        .map((block) => (block as unknown as TocLineBlock).fieldDisplay)
        .filter((field): field is { kind: string; left?: string } => field?.kind === "tocLine");
      expect(lines).toHaveLength(2);
      expect(lines.map((line) => line.left)).toEqual(["Introduction", "Details"]);
    } finally {
      await handle.dispose();
    }
  });

  it("updates the TOC in place and keeps a single field pair", async () => {
    const source = await fixture();
    const handle = handleFor(source);
    try {
      await handle.open();
      handle.commands.insertDocxToc({ maxLevel: 3, pageNumbers: true, hyperlinks: true });
      expect(handle.commands.updateDocxToc({ maxLevel: 1, pageNumbers: true, hyperlinks: true })).toEqual({
        outcome: "updated",
        entries: 1,
      });
      const saved = await handle.serializeSnapshot(await handle.captureSnapshot());
      const document = await partOf(saved.bytes, "word/document.xml");
      expect(document).toContain('\\o "1-1"');
      expect(document).not.toContain('<w:pStyle w:val="TOC2"/>');
      expect(document.match(/fldCharType="begin"/g)).toHaveLength(1);
      expect(document.match(/fldCharType="end"/g)).toHaveLength(1);
    } finally {
      await handle.dispose();
    }
  });
});

describe("DOCX caption save path", () => {
  it("writes a SEQ field whose number continues the document's captions", async () => {
    const source = await fixture({ withCaption: true });
    const handle = handleFor(source);
    try {
      await handle.open();
      expect(handle.commands.insertDocxCaption("Figure", "Second chart")).toBe(true);
      const saved = await handle.serializeSnapshot(await handle.captureSnapshot());
      const document = await partOf(saved.bytes, "word/document.xml");
      expect(document).toContain(" SEQ Figure \\* ARABIC ");
      expect(document).toContain('<w:t>2</w:t>');
      expect(document).toContain("Second chart");
      expect(document.match(/SEQ Figure/g)).toHaveLength(2);
      await assertDocxPartsPreserved(source, saved.bytes, false);
    } finally {
      await handle.dispose();
    }
  });

  it("writes a citation as plain bracketed text", async () => {
    const source = await fixture();
    const handle = handleFor(source);
    try {
      await handle.open();
      expect(handle.commands.insertDocxCitation("Nguyễn", "2024")).toBe(true);
      const saved = await handle.serializeSnapshot(await handle.captureSnapshot());
      const document = await partOf(saved.bytes, "word/document.xml");
      expect(document).toContain("(Nguyễn, 2024)");
      expect(document).not.toContain("CITATION");
    } finally {
      await handle.dispose();
    }
  });
});
