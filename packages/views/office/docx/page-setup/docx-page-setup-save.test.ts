// B4 save-path test: page-setup edits ride the snapshot into the real vendored
// saveDocx — the final section through SaveOptions.trailingSectPr, an earlier
// section through its break paragraph — and an untouched document stays
// byte-identical.
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { bindDocxEngine, createDocxAdapter } from "@uniwork/office-engine/docx";
import { parseDocx, readSections, saveDocx } from "@uniwork/office-upstream/docs-renderer-editor";
import { createDocxTiptapHandle } from "../use-docx-tiptap-handle";
import { assertDocxPartsPreserved } from "../test-fixtures/docx-preservation";

const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

const SECT_PR = (opts: { landscape?: boolean } = {}) =>
  "<w:sectPr>" +
  (opts.landscape ? '<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>' : '<w:pgSz w:w="11906" w:h="16838"/>') +
  '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>' +
  "</w:sectPr>";

/** Two sections: a visible landscape break paragraph, then the trailing
 * portrait A4 sectPr. */
async function fixture(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
  );
  zip.file("_rels/.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${r}/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file("word/_rels/document.xml.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rStyles" Type="${r}/styles" Target="styles.xml"/></Relationships>`);
  zip.file("word/styles.xml", `<w:styles xmlns:w="${w}"><w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`);
  zip.file(
    "word/document.xml",
    `<w:document xmlns:w="${w}"><w:body>` +
      "<w:p><w:r><w:t>first</w:t></w:r></w:p>" +
      `<w:p><w:pPr>${SECT_PR({ landscape: true })}</w:pPr></w:p>` +
      "<w:p><w:r><w:t>second</w:t></w:r></w:p>" +
      SECT_PR() +
      "</w:body></w:document>",
  );
  return zip.generateAsync({ type: "uint8array" });
}

function handleFor(source: Uint8Array) {
  return createDocxTiptapHandle({
    adapter: createDocxAdapter({ engine: bindDocxEngine({ parseDocx, saveDocx }) }),
    documentId: "page-setup",
    readBytes: async () => source,
  });
}

describe("page-setup save path", () => {
  it("keeps an untouched document byte-identical and carries no edits", async () => {
    const source = await fixture();
    const handle = handleFor(source);
    try {
      await handle.open();
      const snapshot = await handle.captureSnapshot();
      expect(snapshot.value.pageSetup).toEqual([]);
      const saved = await handle.serializeSnapshot(snapshot);
      expect(saved.bytes).toEqual(source);
    } finally {
      await handle.dispose();
    }
  });

  it("writes an earlier section's margins into its break paragraph", async () => {
    const source = await fixture();
    const handle = handleFor(source);
    try {
      await handle.open();
      expect(handle.commands.setDocxSectionProperties(0, { marginTop: 720, marginLeft: 720, columns: 2, columnSpace: 425 })).toBe(true);
      const snapshot = await handle.captureSnapshot();
      expect(snapshot.value.pageSetup).toEqual([{ sectionIndex: 0, properties: { marginTop: 720, marginLeft: 720, columns: 2, columnSpace: 425 } }]);
      const saved = await handle.serializeSnapshot(snapshot);
      const sections = readSections(await parseDocx(saved.bytes));
      expect(sections).toHaveLength(2);
      expect(sections[0]!.settings.marginTop).toBe(720);
      expect(sections[0]!.settings.marginLeft).toBe(720);
      expect(sections[0]!.settings.columns).toBe(2);
      expect(sections[0]!.settings.colSpace).toBe(425);
      // untouched fields and the other section keep their values
      expect(sections[0]!.settings.orientation).toBe("landscape");
      expect(sections[0]!.settings.marginRight).toBe(1440);
      expect(sections[1]!.settings.pageWidth).toBe(11906);
      expect(sections[1]!.settings.marginTop).toBe(1440);
      await assertDocxPartsPreserved(source, saved.bytes, false);
    } finally {
      await handle.dispose();
    }
  });

  it("writes the final section through trailingSectPr and round-trips it", async () => {
    const source = await fixture();
    const handle = handleFor(source);
    try {
      await handle.open();
      expect(handle.commands.setDocxSectionProperties(1, { orientation: "landscape", marginTop: 567 })).toBe(true);
      const saved = await handle.serializeSnapshot(await handle.captureSnapshot());
      const sections = readSections(await parseDocx(saved.bytes));
      expect(sections[1]!.settings.orientation).toBe("landscape");
      expect(sections[1]!.settings.pageWidth).toBe(16838);
      expect(sections[1]!.settings.pageHeight).toBe(11906);
      expect(sections[1]!.settings.marginTop).toBe(567);
      // the earlier section is not disturbed
      expect(sections[0]!.settings.orientation).toBe("landscape");
      expect(sections[0]!.settings.pageWidth).toBe(16838);
      expect(sections[0]!.settings.marginTop).toBe(1440);
      // a reopen sees the written geometry
      const fresh = handleFor(saved.bytes);
      try {
        await fresh.open();
        expect(fresh.commands.getState().docxPageSetup?.sections[1]).toMatchObject({
          orientation: "landscape",
          marginTop: 567,
          pageWidth: 16838,
        });
      } finally {
        await fresh.dispose();
      }
    } finally {
      await handle.dispose();
    }
  });

  it("drains the pending edits when a draft snapshot is restored", async () => {
    const source = await fixture();
    const handle = handleFor(source);
    try {
      await handle.open();
      const before = await handle.captureSnapshot();
      handle.commands.setDocxSectionProperties(0, { marginTop: 720 });
      handle.restoreSnapshot(before);
      const snapshot = await handle.captureSnapshot();
      expect(snapshot.value.pageSetup).toEqual([]);
      const saved = await handle.serializeSnapshot(snapshot);
      expect(saved.bytes).toEqual(source);
    } finally {
      await handle.dispose();
    }
  });
});
