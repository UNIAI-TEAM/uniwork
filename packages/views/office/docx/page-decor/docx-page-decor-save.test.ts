// B6 save-path test: page colour, watermark, theme and borders ride the
// snapshot into the real vendored saveDocx — colour/watermark/theme through
// SaveOptions, the border box through the section rewrite — and an untouched
// document stays byte-identical.
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { bindDocxEngine, createDocxAdapter, readPageDecor, type DocxParsed } from "@uniwork/office-engine/docx";
import { parseDocx, readSections, saveDocx } from "@uniwork/office-upstream/docs-renderer-editor";
import { createDocxTiptapHandle } from "../use-docx-tiptap-handle";

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
    documentId: "page-decor",
    readBytes: async () => source,
  });
}

/** The whole part-level footprint of a decoration save: the four ops create
 * the settings/theme/header parts the fixture lacks and rewrite the document,
 * its rels and the content types; every other part stays byte-identical. */
const DECOR_CREATED_PARTS = ["word/settings.xml", "word/theme/theme1.xml", "word/header1.xml"];
const DECOR_REWRITTEN_PARTS = ["[Content_Types].xml", "word/_rels/document.xml.rels", "word/document.xml"];

async function readPartBytes(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const zip = await JSZip.loadAsync(bytes);
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  return new Map(
    await Promise.all(
      entries.map(async (entry): Promise<[string, Uint8Array]> => [entry.name, await entry.async("uint8array")]),
    ),
  );
}

describe("page-decoration save path", () => {
  it("keeps an untouched document byte-identical and carries no ops", async () => {
    const source = await fixture();
    const handle = handleFor(source);
    try {
      await handle.open();
      const seeded = handle.commands.getState().docxPageDecor;
      expect(seeded).not.toBeNull();
      expect(seeded?.pageColor).toBeNull();
      const snapshot = await handle.captureSnapshot();
      expect(snapshot.value.pageDecor).toEqual([]);
      const saved = await handle.serializeSnapshot(snapshot);
      expect(saved.bytes).toEqual(source);
    } finally {
      await handle.dispose();
    }
  });

  it("writes colour, watermark, theme and an earlier section's border box", async () => {
    const source = await fixture();
    const handle = handleFor(source);
    try {
      await handle.open();
      expect(
        handle.commands.applyDocxPageDecor([
          { op: "set_page_color", color: "E8F1FB" },
          { op: "set_watermark", watermark: { text: "CONFIDENTIAL", opacity: 0.5, diagonal: true } },
          { op: "set_theme_fonts", fonts: { major: "Arial", minor: "Arial" } },
          { op: "set_theme_colors", colors: { accent1: "AABBCC" } },
          { op: "set_page_borders", sectionIndex: 0, borders: { style: "double", widthEighths: 8, colorHex: "44546A", spacePt: 16, offsetFrom: "page" } },
        ]),
      ).toBe(true);
      const snapshot = await handle.captureSnapshot();
      expect(snapshot.value.pageDecor).toHaveLength(5);
      const saved = await handle.serializeSnapshot(snapshot);
      const parsed = await parseDocx(saved.bytes);
      const decor = readPageDecor(parsed as unknown as DocxParsed);
      expect(decor.pageColor).toBe("E8F1FB");
      expect(decor.watermarkText).toBe("CONFIDENTIAL");
      expect(decor.themeFonts?.major).toBe("Arial");
      expect(decor.themeColors?.accent1).toBe("AABBCC");
      expect(decor.sections[0]!.borders).toEqual({ style: "double", widthEighths: 8, colorHex: "44546A", spacePt: 16, offsetFrom: "page" });
      expect(decor.sections[1]!.borders).toBeNull();
      // the independent section reader sees the same box
      const sections = readSections(parsed);
      const settings = sections[0]!.settings as unknown as { pageBorder?: boolean; pageBorderProps?: { offsetFrom?: string } };
      expect(settings.pageBorder).toBe(true);
      expect(settings.pageBorderProps?.offsetFrom).toBe("page");
      expect((sections[1]!.settings as unknown as { pageBorder?: boolean }).pageBorder).not.toBe(true);
      // a fresh handle re-reads the written state
      const fresh = handleFor(saved.bytes);
      try {
        await fresh.open();
        const reread = fresh.commands.getState().docxPageDecor;
        expect(reread?.pageColor).toBe("E8F1FB");
        expect(reread?.watermarkText).toBe("CONFIDENTIAL");
        expect(reread?.sections[0]!.borders?.style).toBe("double");
      } finally {
        await fresh.dispose();
      }
      // the pair of lists above is the complete footprint: a new part outside
      // them, a dropped part or a changed byte outside them fails
      const before = await readPartBytes(source);
      const after = await readPartBytes(saved.bytes);
      expect([...after.keys()].filter((name) => !before.has(name)).sort()).toEqual([...DECOR_CREATED_PARTS].sort());
      for (const [name, bytes] of before) {
        const next = after.get(name);
        expect(next, `part ${name} present`).toBeDefined();
        if (DECOR_REWRITTEN_PARTS.includes(name)) expect(next, `${name} rewritten`).not.toEqual(bytes);
        else expect(next, `${name} untouched`).toEqual(bytes);
      }
    } finally {
      await handle.dispose();
    }
  });

  it("drains the pending ops when a draft snapshot is restored", async () => {
    const source = await fixture();
    const handle = handleFor(source);
    try {
      await handle.open();
      const before = await handle.captureSnapshot();
      expect(before.value.pageDecor).toEqual([]);
      handle.commands.applyDocxPageDecor([
        { op: "set_page_color", color: "E8F1FB" },
        { op: "set_page_borders", sectionIndex: 1, borders: { style: "single" } },
      ]);
      expect((await handle.captureSnapshot()).value.pageDecor).toHaveLength(2);
      handle.restoreSnapshot(before);
      expect((await handle.captureSnapshot()).value.pageDecor).toEqual([]);
      const saved = await handle.serializeSnapshot(await handle.captureSnapshot());
      expect(saved.bytes).toEqual(source);
    } finally {
      await handle.dispose();
    }
  });
});
