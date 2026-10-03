// B5 save-path test: the pending numbering edits ride the snapshot into the
// real vendored saveDocx — new definitions and restart nums are appended to
// word/numbering.xml (creating the part from the blank template when missing)
// while an untouched document stays byte-identical.
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { bindDocxEngine, createDocxAdapter, type DocxNumberingDef } from "@uniwork/office-engine/docx";
import { parseDocx, saveDocx } from "@uniwork/office-upstream/docs-renderer-editor";
import { assertDocxPartsPreserved } from "../test-fixtures/docx-preservation";
import { createDocxTiptapHandle } from "../use-docx-tiptap-handle";

const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const ct = "http://schemas.openxmlformats.org/package/2006/content-types";

const NUMBERING_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  `<w:numbering xmlns:w="${w}">` +
  '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="&#61623;"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>' +
  '<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>' +
  '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
  '<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>' +
  "</w:numbering>";

const LIST_PARA = (numId: string) =>
  `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr></w:pPr><w:r><w:t>item</w:t></w:r></w:p>`;

const PLAIN_PARA = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

/** The fixture's first block decides the default caret: a list item (level /
 * restart tests) or a plain paragraph (toggle / preset tests). */
async function fixture(options: { listFirst?: boolean; withNumbering?: boolean } = {}): Promise<Uint8Array> {
  const withNumbering = options.withNumbering !== false;
  const body = options.listFirst ? [LIST_PARA("2"), LIST_PARA("2"), PLAIN_PARA("outro")] : [PLAIN_PARA("intro"), LIST_PARA("2"), LIST_PARA("2")];
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<Types xmlns="${ct}"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>${withNumbering ? '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' : ""}</Types>`,
  );
  zip.file("_rels/.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${r}/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file(
    "word/_rels/document.xml.rels",
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rStyles" Type="${r}/styles" Target="styles.xml"/>${withNumbering ? `<Relationship Id="rNum" Type="${r}/numbering" Target="numbering.xml"/>` : ""}</Relationships>`,
  );
  zip.file("word/styles.xml", `<w:styles xmlns:w="${w}"><w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`);
  if (withNumbering) zip.file("word/numbering.xml", NUMBERING_XML);
  zip.file(
    "word/document.xml",
    `<w:document xmlns:w="${w}"><w:body>${body.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`,
  );
  return zip.generateAsync({ type: "uint8array" });
}

function handleFor(source: Uint8Array) {
  return createDocxTiptapHandle({
    adapter: createDocxAdapter({ engine: bindDocxEngine({ parseDocx, saveDocx }) }),
    documentId: "lists",
    readBytes: async () => source,
  });
}

async function partOf(bytes: Uint8Array, name: string): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const file = zip.file(name);
  if (!file) throw new Error("missing part " + name);
  return file.async("string");
}

/** The renderer's parsed handle types the numbering map loosely; the seam's
 * DocxNumberingDef shape is what the engine bound above produces. */
async function numberingDefsOf(bytes: Uint8Array): Promise<Map<string, DocxNumberingDef>> {
  const parsed = await parseDocx(bytes);
  const numbering = (parsed as { numbering?: unknown }).numbering;
  return numbering instanceof Map ? (numbering as Map<string, DocxNumberingDef>) : new Map();
}

interface SavedListItem {
  list: { kind: string; numId: string; ilvl: number };
}

async function listBlocks(bytes: Uint8Array): Promise<SavedListItem[]> {
  const parsed = await parseDocx(bytes);
  return parsed.blocks
    .filter((block) => block.type === "listItem")
    .map((block) => ({ list: (block as unknown as SavedListItem).list }));
}

describe("DOCX list save path", () => {
  it("keeps an untouched document byte-identical and captures no numbering edits", async () => {
    const source = await fixture();
    const handle = handleFor(source);
    try {
      await handle.open();
      const snapshot = await handle.captureSnapshot();
      expect(snapshot.value.numbering).toEqual({ newDefs: [], restartNums: [] });
      const saved = await handle.serializeSnapshot(snapshot);
      expect(saved.bytes).toEqual(source);
    } finally {
      await handle.dispose();
    }
  });

  it("writes a new definition and its numPr when a paragraph becomes a bullet list", async () => {
    const source = await fixture();
    const handle = handleFor(source);
    try {
      await handle.open();
      handle.commands.toggleList("ordered");
      const saved = await handle.serializeSnapshot(await handle.captureSnapshot());
      // the part gained a w:num over the document's own decimal abstractNum
      const numbering = await partOf(saved.bytes, "word/numbering.xml");
      expect(numbering).toContain('<w:num w:numId="3"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>');
      expect((await numberingDefsOf(saved.bytes)).get("3")).toMatchObject({ abstractNumId: "1", startOverrides: { 0: 1 } });
      // the body paragraph now carries that numId; the document's own items stay on numId 2
      expect((await listBlocks(saved.bytes))[0]).toEqual({ list: { kind: "ordered", numId: "3", ilvl: 0 } });
    } finally {
      await handle.dispose();
    }
  });

  it("appends a nine-level definition for a multilevel gallery preset", async () => {
    const source = await fixture();
    const handle = handleFor(source);
    try {
      await handle.open();
      handle.commands.applyDocxListPreset("multilevel-decimal");
      const saved = await handle.serializeSnapshot(await handle.captureSnapshot());
      const numbering = await partOf(saved.bytes, "word/numbering.xml");
      // the blank template occupies 0/1; the new abstractNum is 2 with the chain
      expect(numbering).toContain('<w:abstractNum w:abstractNumId="2">');
      expect(numbering).toContain('<w:lvl w:ilvl="8"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1.%2.%3.%4.%5.%6.%7.%8.%9."/>');
      expect(numbering).toContain('<w:num w:numId="3"><w:abstractNumId w:val="2"/></w:num>');
      const defs = await numberingDefsOf(saved.bytes);
      expect(Object.keys(defs.get("3")?.levels ?? {})).toHaveLength(9);
      expect((await listBlocks(saved.bytes))[0]).toEqual({ list: { kind: "ordered", numId: "3", ilvl: 0 } });
    } finally {
      await handle.dispose();
    }
  });

  it("creates word/numbering.xml from the blank template when the package has none", async () => {
    const source = await fixture({ withNumbering: false });
    const handle = handleFor(source);
    try {
      await handle.open();
      handle.commands.toggleList("bullet");
      const saved = await handle.serializeSnapshot(await handle.captureSnapshot());
      const numbering = await partOf(saved.bytes, "word/numbering.xml");
      expect(numbering).toContain('<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>');
      expect(numbering).toContain('<w:num w:numId="3"><w:abstractNumId w:val="2"/></w:num>');
      expect((await listBlocks(saved.bytes))[0]).toEqual({ list: { kind: "bullet", numId: "3", ilvl: 0 } });
      expect((await partOf(saved.bytes, "[Content_Types].xml")).includes('PartName="/word/numbering.xml"')).toBe(true);
    } finally {
      await handle.dispose();
    }
  });

  it("restarts numbering with a start override and moves the list's items to it", async () => {
    const source = await fixture({ listFirst: true });
    const handle = handleFor(source);
    try {
      await handle.open();
      expect(handle.commands.restartDocxListNumbering()).toBe(true);
      const saved = await handle.serializeSnapshot(await handle.captureSnapshot());
      const numbering = await partOf(saved.bytes, "word/numbering.xml");
      expect(numbering).toContain('<w:num w:numId="3"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>');
      const items = await listBlocks(saved.bytes);
      expect(items.map((block) => block.list.numId)).toEqual(["3", "3"]);
    } finally {
      await handle.dispose();
    }
  });

  it("writes levels 0-8 into numPr and leaves the numbering part untouched", async () => {
    const source = await fixture({ listFirst: true });
    const handle = handleFor(source);
    try {
      await handle.open();
      expect(handle.commands.setDocxListLevel(8)).toBe(true);
      const saved = await handle.serializeSnapshot(await handle.captureSnapshot());
      const items = await listBlocks(saved.bytes);
      // only the caret's own item moved; the level rides the body's numPr
      expect(items.map((block) => block.list.ilvl)).toEqual([8, 0]);
      await assertDocxPartsPreserved(source, saved.bytes, false);
    } finally {
      await handle.dispose();
    }
  });

  it("drains the pending numbering edits when a draft snapshot is restored", async () => {
    const source = await fixture();
    const handle = handleFor(source);
    try {
      await handle.open();
      const before = await handle.captureSnapshot();
      handle.commands.applyDocxListPreset("multilevel-decimal");
      handle.restoreSnapshot(before);
      const snapshot = await handle.captureSnapshot();
      expect(snapshot.value.numbering).toEqual({ newDefs: [], restartNums: [] });
      const saved = await handle.serializeSnapshot(snapshot);
      expect(saved.bytes).toEqual(source);
    } finally {
      await handle.dispose();
    }
  });

  it("restarts a list created this session and saves cleanly", async () => {
    const source = await fixture({ withNumbering: false });
    const handle = handleFor(source);
    try {
      await handle.open();
      handle.commands.toggleList("ordered");
      expect(handle.commands.restartDocxListNumbering()).toBe(true);
      const saved = await handle.serializeSnapshot(await handle.captureSnapshot());
      const numbering = await partOf(saved.bytes, "word/numbering.xml");
      // The restart allocated a fresh definition instead of pointing at the
      // first pending def's synthetic abstractNumId, so the save succeeds.
      expect(numbering).not.toContain("pending-");
      expect(numbering).toContain('<w:num w:numId="4">');
      const items = await listBlocks(saved.bytes);
      expect(items[0]).toEqual({ list: { kind: "ordered", numId: "4", ilvl: 0 } });
    } finally {
      await handle.dispose();
    }
  });
});
