import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import { bindDocxEngine, createDocxAdapter } from "@uniwork/office-engine/docx";
import { parseDocx, saveDocx } from "@uniwork/office-upstream/docs-renderer-editor";
import { createDocxTiptapHandle } from "./use-docx-tiptap-handle";
import { assertDocxPartsPreserved } from "./test-fixtures/docx-preservation";
import { revisionOf } from "./test-fixtures/docx-core-revision";

const w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const levels = [1, 2, 3, 4, 5, 6];
const style = (level: number) => `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/><w:pPr><w:outlineLvl w:val="${level - 1}"/></w:pPr></w:style>`;

// CORE-REPEAT-001 (T08): the host rebases the save source after a commit, so
// a second changed Save counts cp:revision from the committed bytes. The web
// host and desktop session cover the same rule end to end.
it("counts cp:revision from the committed Save once the save source is rebased", async () => {
  const handle = handleFor(await fixture(levels));
  try {
    await handle.open();
    handle.commands.setHeading(2);
    const first = await handle.serializeSnapshot(await handle.captureSnapshot());
    expect(await revisionOf(first.bytes)).toBe("8");
    // Without a commit acknowledgement the source stays put: a retry re-derives the same revision.
    expect(await revisionOf((await handle.serializeSnapshot(await handle.captureSnapshot())).bytes)).toBe("8");
    await handle.rebaseSaveSource({ checksumSha256: `sha256:${first.checksum.replace(/^sha256:/, "")}` });
    handle.commands.setHeading(1);
    const second = await handle.serializeSnapshot(await handle.captureSnapshot());
    expect(await revisionOf(second.bytes)).toBe("9");
    // An unknown checksum (another Save's receipt) changes nothing.
    await handle.rebaseSaveSource({ checksumSha256: "sha256:unknown" });
    expect(await revisionOf((await handle.serializeSnapshot(await handle.captureSnapshot())).bytes)).toBe("9");
  } finally {
    await handle.dispose();
  }
});

async function fixture(defined: number[], collision = "", missingPart = false, core = true) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>');
  zip.file("_rels/.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${r}/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file("word/_rels/document.xml.rels", `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rStyles" Type="${r}/styles" Target="styles.xml"/></Relationships>`);
  if (!missingPart) zip.file("word/styles.xml", `<w:styles xmlns:w="${w}"><w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>${defined.map(style).join("")}${collision}</w:styles>`);
  zip.file("word/document.xml", `<w:document xmlns:w="${w}"><w:body><w:p><w:r><w:t>Heading regression</w:t></w:r></w:p><w:p><w:r><w:t>Unchanged text</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`);
  zip.file("customXml/item1.xml", "<sentinel>preserve these bytes</sentinel>");
  if (core) zip.file("docProps/core.xml", '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>Regression fixture</dc:creator><cp:revision>7</cp:revision><dcterms:modified xsi:type="dcterms:W3CDTF">2020-01-02T03:04:05Z</dcterms:modified></cp:coreProperties>');
  return zip.generateAsync({ type: "uint8array" });
}

function handleFor(source: Uint8Array, writer = saveDocx, parser = parseDocx) {
  return createDocxTiptapHandle({ adapter: createDocxAdapter({ engine: bindDocxEngine({ parseDocx: parser, saveDocx: writer }) }), documentId: "heading-regression", readBytes: async () => source });
}

describe.each([{ name: "none", defined: [] }, { name: "Heading1/2", defined: [1, 2] }, { name: "all six", defined: levels }])("heading styles: $name", ({ defined }) => {
  it.each(levels)("round-trips heading %i through bytes and a fresh handle", async (level) => {
    const source = await fixture(defined), handle = handleFor(source);
    let fresh: ReturnType<typeof handleFor> | undefined;
    try {
      await handle.open();
      handle.commands!.setHeading(level);
      const saved = await handle.serializeSnapshot(await handle.captureSnapshot());
      expect((await parseDocx(saved.bytes)).blocks[0]).toMatchObject({ type: "heading", level });
      fresh = handleFor(saved.bytes); await fresh.open();
      expect(fresh.commands!.getState().headingLevel).toBe(level);
      await assertDocxPartsPreserved(source, saved.bytes, !defined.includes(level));
      const oldStyles = await (await JSZip.loadAsync(source)).file("word/styles.xml")!.async("string");
      const styles = await (await JSZip.loadAsync(saved.bytes)).file("word/styles.xml")!.async("string");
      if (defined.includes(level)) expect(styles).toBe(oldStyles);
      else {
        expect(styles).toContain(`<w:outlineLvl w:val="${level - 1}"/>`);
        expect(styles).toContain(oldStyles.replace("</w:styles>", ""));
        expect(styles.match(/<w:style /g)).toHaveLength(defined.length + 2);
      }
    } finally { await fresh?.dispose(); await handle.dispose(); }
  });
});

it("preserves a colliding style and recognises the uniquely named heading after reopen", async () => {
  const collision = '<w:style w:type="character" w:styleId="Heading3"><w:name w:val="Body character"/><w:rPr><w:i/></w:rPr></w:style>';
  const source = await fixture([], collision), handle = handleFor(source);
  try {
    await handle.open(); handle.commands!.setHeading(3);
    const first = await handle.serializeSnapshot(await handle.captureSnapshot());
    const parsed = await parseDocx(first.bytes);
    expect(parsed.blocks[0]).toMatchObject({ type: "heading", level: 3, styleId: "UniWorkHeading3_0" });
    const styles = await (await JSZip.loadAsync(first.bytes)).file("word/styles.xml")!.async("string");
    expect(styles).toContain(collision);
    await assertDocxPartsPreserved(source, first.bytes, true);
    const fresh = handleFor(first.bytes);
    try {
      await fresh.open(); expect(fresh.commands!.getState().headingLevel).toBe(3);
      const second = await fresh.serializeSnapshot(await fresh.captureSnapshot());
      expect(second.bytes).toEqual(first.bytes);
      expect(await (await JSZip.loadAsync(second.bytes)).file("word/styles.xml")!.async("string")).toBe(styles);
    } finally { await fresh.dispose(); }
  } finally { await handle.dispose(); }
});

it("adds no parse or serialization for a no-op or an already defined heading", async () => {
  const source = await fixture(levels), writer = vi.fn(saveDocx), parser = vi.fn(parseDocx), handle = handleFor(source, writer, parser);
  try {
    await handle.open(); parser.mockClear(); writer.mockClear();
    expect((await handle.serializeSnapshot(await handle.captureSnapshot())).bytes).toEqual(source);
    expect(writer).toHaveBeenCalledTimes(1); expect(parser).toHaveBeenCalledTimes(2);
    parser.mockClear(); writer.mockClear(); handle.commands!.setHeading(3);
    const saved = await handle.serializeSnapshot(await handle.captureSnapshot());
    expect((await parseDocx(saved.bytes)).blocks[0]).toMatchObject({ type: "heading", level: 3 });
    expect(writer).toHaveBeenCalledTimes(1); expect(parser).toHaveBeenCalledTimes(2);
  } finally { await handle.dispose(); }
});

it.each(["outlineOnly", "explicitStyle"])("keeps %s headings without adding styles", async (mode) => {
  const source = await fixture([1]), handle = handleFor(source);
  try {
    await handle.open(); handle.commands!.setHeading(3);
    const snapshot = await handle.captureSnapshot();
    if (mode === "outlineOnly") snapshot.value.doc.content![0]!.attrs!.outlineOnly = true;
    else snapshot.value.doc.content![0]!.attrs!.styleId = "Heading1";
    const saved = await handle.serializeSnapshot(snapshot);
    expect((await parseDocx(saved.bytes)).blocks[0]).toMatchObject(mode === "outlineOnly" ? { type: "heading", level: 3, outlineOnly: true } : { type: "heading", level: 1, styleId: "Heading1" });
    await assertDocxPartsPreserved(source, saved.bytes, false);
  } finally { await handle.dispose(); }
});

it("does not create a missing styles.xml part (recorded compatibility limit)", async () => {
  const source = await fixture([], "", true), handle = handleFor(source);
  try {
    await handle.open(); handle.commands!.setHeading(3);
    const saved = await handle.serializeSnapshot(await handle.captureSnapshot());
    expect((await JSZip.loadAsync(saved.bytes)).file("word/styles.xml")).toBeNull();
    await assertDocxPartsPreserved(source, saved.bytes, false);
  } finally { await handle.dispose(); }
});

it("does not add core.xml when the source has no core properties", async () => {
  const source = await fixture([], "", false, false), handle = handleFor(source);
  try {
    await handle.open(); handle.commands!.setHeading(3);
    const saved = await handle.serializeSnapshot(await handle.captureSnapshot());
    expect((await JSZip.loadAsync(saved.bytes)).file("docProps/core.xml")).toBeNull();
    expect((await parseDocx(saved.bytes)).blocks[0]).toMatchObject({ type: "heading", level: 3 });
    await assertDocxPartsPreserved(source, saved.bytes, true);
  } finally { await handle.dispose(); }
});
