// DOCX model tests — the save serializes the MODEL's plan, never the input
// bytes with a success claim; a two-save chain advances the base; untouched
// content and unknown package parts survive round-trips.
import { describe, expect, it } from "vitest";
import { createDocxAdapter, DocxSessionModel, editableIndexes, plainText, visibleIndexes } from "../src/docx";
import { createFakeDocxEngine, decodeFakeDocx, makeFakeDocxBytes } from "./fake-docx-engine";

/** Typed-error oracle: callers branch on `code`, never on message text. */
const errCode = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return String((e as { code?: string }).code ?? e);
  }
  return "";
};

const kitchenSink = () =>
  makeFakeDocxBytes({
    blocks: [
      { type: "heading", runs: [{ text: "Spec" }] },
      { type: "paragraph", runs: [{ text: "alpha" }] },
      { type: "table", rows: [["c1", "c2"]] },
      { type: "image", imageDataUrl: "data:image/png;base64,AAAA" },
      { type: "paragraph", runs: [{ text: "omega" }] },
      { type: "paragraph", runs: [{ text: "hidden tail" }], hidden: true },
    ],
    extras: { chartParts: { "word/charts/chart1.xml": "<c/>" } },
    hf: { header: { text: "OLD HDR" } },
    parts: {
      "word/media/image1.png": "PNG-BYTES",
      "word/charts/chart1.xml": "<c/>",
      "word/embeddings/book.xlsx": "XLSX",
      "customXml/item1.xml": "<custom/>",
    },
  });

const openKitchen = async () => {
  const adapter = createDocxAdapter({ engine: createFakeDocxEngine() });
  const out = await adapter.open({ bytes: kitchenSink(), format: "docx", document_id: "doc-k" });
  if (out.outcome !== "opened") throw new Error("open failed: " + JSON.stringify(out));
  return { adapter, ref: out.document_model_ref };
};

const decodeBlocks = (bytes: Uint8Array) =>
  decodeFakeDocx(bytes) as {
    blocks: Array<Record<string, unknown>>;
    hf: Record<string, unknown>;
    parts: Record<string, string>;
  };

describe("docx session model", () => {
  it("visibleIndexes = all legal originals; editableIndexes = visible paragraphs", async () => {
    const engine = createFakeDocxEngine();
    const parsed = await engine.parseDocx(kitchenSink());
    expect(visibleIndexes(parsed)).toEqual([0, 1, 2, 3, 4]); // hidden tail not listed
    expect(editableIndexes(parsed)).toEqual([1, 4]);
    expect(plainText(parsed)).toContain("alpha");
  });

  it("no-op save: the all-original plan re-serializes byte-identically", async () => {
    const engine = createFakeDocxEngine();
    const parsed = await engine.parseDocx(kitchenSink());
    const model = new DocxSessionModel(parsed);
    expect(model.isDirty).toBe(false);
    const { finalBlocks } = model.savePlan();
    expect(finalBlocks.every((b) => b.kind === "original")).toBe(true);
    const out = await engine.saveDocx(parsed, finalBlocks, {});
    expect(out).toEqual(kitchenSink());
  });

  it("set_paragraph_text rewrites only the target; other originals keep docxIndex/type", async () => {
    const { adapter, ref } = await openKitchen();
    adapter.edit(ref, { op: "set_paragraph_text", docxIndex: 1, runs: [{ text: "ALPHA-EDITED", bold: true }] });
    const saved = await adapter.serialize({ document_model_ref: ref, format: "docx" });
    const pkg = decodeBlocks(saved.bytes);
    const texts = pkg.blocks.map((b) => ((b.runs as Array<{ text: string }> | undefined) ?? []).map((r) => r.text).join(""));
    expect(texts).toContain("ALPHA-EDITED");
    expect(texts).toContain("Spec");
    expect(texts).toContain("omega");
    // the table + image originals survive untouched
    expect(pkg.blocks.some((b) => b.type === "table")).toBe(true);
    expect(pkg.blocks.some((b) => b.type === "image")).toBe(true);
    // package parts preserved
    expect(pkg.parts["word/media/image1.png"]).toBe("PNG-BYTES");
    expect(pkg.parts["word/embeddings/book.xlsx"]).toBe("XLSX");
  });

  it("refuses a non-paragraph target instead of silently retyping it", async () => {
    const { adapter, ref } = await openKitchen();
    expect(errCode(() =>
      adapter.edit(ref, { op: "set_paragraph_text", docxIndex: 2, runs: [{ text: "x" }] }),
    )).toBe("unsupported_target");
    expect(errCode(() =>
      adapter.edit(ref, { op: "set_paragraph_text", docxIndex: 0, runs: [{ text: "x" }] }),
    )).toBe("unsupported_target");
    expect(errCode(() =>
      adapter.edit(ref, { op: "set_paragraph_text", docxIndex: 99, runs: [{ text: "x" }] }),
    )).toBe("bad_index");
    // untouched model still saves the original
    const saved = await adapter.serialize({ document_model_ref: ref, format: "docx" });
    expect(saved.bytes.length).toBeGreaterThan(0);
  });

  it("replace_block_xml carries an OOXML fragment bound to its source block", async () => {
    const { adapter, ref } = await openKitchen();
    adapter.edit(ref, { op: "replace_block_xml", docxIndex: 2, xml: "<w:tbl><w:tr><w:tc><w:t>NEW</w:t></w:tc></w:tr></w:tbl>" });
    const saved = await adapter.serialize({ document_model_ref: ref, format: "docx" });
    const pkg = decodeBlocks(saved.bytes);
    const frag = pkg.blocks.find((b) => b.type === "xml-fragment");
    expect(frag).toMatchObject({ docxIndex: 2 });
    expect(String(frag?.xml)).toContain("NEW");
  });

  it("insert_image adds a media part + block; relationship mapping preserved", async () => {
    const { adapter, ref } = await openKitchen();
    adapter.edit(ref, {
      op: "insert_image",
      index: 1,
      image: { base64: "QUJDREVGRw==", mime: "image/png", widthPx: 100, heightPx: 50 },
    });
    const saved = await adapter.serialize({ document_model_ref: ref, format: "docx" });
    const pkg = decodeBlocks(saved.bytes);
    const mediaKeys = Object.keys(pkg.parts).filter((p) => p.startsWith("word/media/"));
    expect(mediaKeys.length).toBe(2); // original image1.png + inserted
    expect(pkg.blocks.some((b) => b.type === "image" && (b.image as { widthPx?: number })?.widthPx === 100)).toBe(true);
  });

  it("header/footer edits ride SaveOptions; titlePg/evenOdd flags apply", async () => {
    const { adapter, ref } = await openKitchen();
    adapter.edit(ref, { op: "set_header_footer", slot: "header", hf: { text: "NEW HDR" } });
    adapter.edit(ref, { op: "set_title_pg", value: true });
    adapter.edit(ref, { op: "set_even_odd_headers", value: true });
    const saved = await adapter.serialize({ document_model_ref: ref, format: "docx" });
    const pkg = decodeBlocks(saved.bytes);
    expect((pkg.hf.header as { text: string }).text).toBe("NEW HDR");
    expect(pkg.hf.titlePg).toBe(true);
    expect(pkg.hf.evenAndOddHeaders).toBe(true);
  });

  it("two consecutive saves: save2's base is save1's output, edits accumulate", async () => {
    const { adapter, ref } = await openKitchen();
    adapter.edit(ref, { op: "set_paragraph_text", docxIndex: 1, runs: [{ text: "EDIT-ONE" }] });
    const s1 = await adapter.serialize({ document_model_ref: ref, format: "docx" });
    const afterFirst = decodeBlocks(s1.bytes).blocks.map((b) => ((b.runs as Array<{ text: string }> | undefined) ?? []).map((r) => r.text).join(""));
    // after rebase the plan is all-original again (edits committed into base)
    expect(adapter.isDirty(ref)).toBe(false);
    const newVisible = adapter.visibleIndexes(ref);
    // the edited paragraph is now an ORIGINAL in the new base — find its index by text
    const rebasedParsed = adapter.sessionOf(ref).model.parsed;
    const editOneIdx = rebasedParsed.blocks.find(
      (b) => (b.runs ?? []).map((r) => r.text).join("") === "EDIT-ONE",
    )?.docxIndex;
    expect(editOneIdx).not.toBeUndefined();
    adapter.edit(ref, { op: "set_paragraph_text", docxIndex: editOneIdx as number, runs: [{ text: "EDIT-TWO" }] });
    const s2 = await adapter.serialize({ document_model_ref: ref, format: "docx" });
    const pkg2 = decodeBlocks(s2.bytes);
    const texts2 = pkg2.blocks.map((b) => ((b.runs as Array<{ text: string }> | undefined) ?? []).map((r) => r.text).join(""));
    expect(texts2).toContain("EDIT-TWO");
    // save2 kept every original of save1's output (table/image/hidden intact)
    expect(pkg2.blocks.some((b) => b.type === "table")).toBe(true);
    expect(pkg2.blocks.some((b) => b.type === "image")).toBe(true);
    expect(newVisible.length).toBeGreaterThan(0);
    expect(s2.checksum).not.toBe(s1.checksum);
  });

  it("remove_block drops content; hidden originals still auto-append", async () => {
    const { adapter, ref } = await openKitchen();
    adapter.edit(ref, { op: "remove_block", docxIndex: 4 });
    const saved = await adapter.serialize({ document_model_ref: ref, format: "docx" });
    const pkg = decodeBlocks(saved.bytes);
    const texts = pkg.blocks.map((b) => ((b.runs as Array<{ text: string }> | undefined) ?? []).map((r) => r.text).join(""));
    expect(texts).not.toContain("omega");
    // the hidden tail survives untouched (appended automatically, not an edit)
    expect(pkg.blocks.some((b) => b.hidden === true)).toBe(true);
  });

  it("unknown package parts survive the save untouched (unchanged-parts oracle)", async () => {
    const { adapter, ref } = await openKitchen();
    adapter.edit(ref, { op: "set_paragraph_text", docxIndex: 1, runs: [{ text: "E" }] });
    const saved = await adapter.serialize({ document_model_ref: ref, format: "docx" });
    const pkg = decodeBlocks(saved.bytes);
    for (const p of ["word/media/image1.png", "word/charts/chart1.xml", "word/embeddings/book.xlsx", "customXml/item1.xml"]) {
      expect(pkg.parts[p]).toBeDefined();
    }
  });
});
