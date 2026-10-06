// DOCX image model tests — insert_image carries the full drawing surface
// (wrap/anchor offset/z-order/rotation/flips/alt text), crop travels as byte
// replacement on replace_block_xml (the drawing XML survives), and payloads the
// vendored writer cannot embed are refused with typed codes.
import { describe, expect, it } from "vitest";
import { DOCX_IMAGE_WRAPS, DocxSessionModel, createDocxAdapter, type DocxNewImage } from "../src/docx";
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

const imageDoc = () =>
  makeFakeDocxBytes({
    blocks: [
      { type: "paragraph", runs: [{ text: "before" }] },
      { type: "image", imageDataUrl: "data:image/png;base64,AAAA" },
      { type: "paragraph", runs: [{ text: "after" }] },
    ],
    parts: { "word/media/image1.png": "PNG-BYTES" },
  });

const openImageDoc = async () => {
  const adapter = createDocxAdapter({ engine: createFakeDocxEngine() });
  const out = await adapter.open({ bytes: imageDoc(), format: "docx", document_id: "doc-img" });
  if (out.outcome !== "opened") throw new Error("open failed: " + JSON.stringify(out));
  return { adapter, ref: out.document_model_ref, model: adapter.sessionOf(out.document_model_ref).model };
};

const baseImage = (overrides: Partial<DocxNewImage> = {}): DocxNewImage => ({
  base64: "QUJDRA==",
  mime: "image/png",
  widthPx: 120,
  heightPx: 80,
  ...overrides,
});

describe("docx insert_image plumbing", () => {
  it("carries wrap, anchor offset, z-order, rotation, flips and alt text into the plan", async () => {
    const { model } = await openImageDoc();
    const image = baseImage({
      align: "center",
      altText: "Team photo",
      wrap: "square-right",
      posOffsetEmu: { x: 914400, y: 457200, relativeTo: "margin" },
      zOrder: 3,
      rotDeg: 90,
      flipH: true,
      flipV: false,
    });
    model.insertImage(1, image);
    const plan = model.savePlan().finalBlocks;
    expect(model.isDirty).toBe(true);
    expect(plan).toEqual([
      { kind: "original", docxIndex: 0 },
      { kind: "image", image },
      { kind: "original", docxIndex: 1 },
      { kind: "original", docxIndex: 2 },
    ]);
  });

  it("round-trips every typed wrap mode (and the inline default)", async () => {
    expect(DOCX_IMAGE_WRAPS).toHaveLength(9);
    for (const wrap of [...DOCX_IMAGE_WRAPS, undefined]) {
      const { model } = await openImageDoc();
      model.insertImage(0, baseImage({ wrap }));
      const blocks = model.savePlan().finalBlocks;
      const block = blocks[0];
      if (!block || block.kind !== "image") throw new Error("expected an image block, got " + String(block?.kind));
      expect(block.image.wrap).toBe(wrap);
    }
  });

  it("save writes a new media part and keeps the original image untouched", async () => {
    const { adapter, ref } = await openImageDoc();
    adapter.edit(ref, {
      op: "insert_image",
      index: 2,
      image: baseImage({ wrap: "front", posOffsetEmu: { x: 0, y: 0, relativeTo: "page" }, altText: "Cover" }),
    });
    const saved = await adapter.serialize({ document_model_ref: ref, format: "docx" });
    const pkg = decodeFakeDocx(saved.bytes);
    const parts = pkg.parts ?? {};
    const mediaKeys = Object.keys(parts).filter((p) => p.startsWith("word/media/"));
    expect(mediaKeys).toHaveLength(2); // original + inserted
    expect(parts["word/media/image1.png"]).toBe("PNG-BYTES");
    expect(pkg.blocks.some((b) => b.type === "image" && (b.image as { widthPx?: number })?.widthPx === 120)).toBe(true);
  });

  it("an untouched image document saves byte-identically", async () => {
    const { adapter, ref } = await openImageDoc();
    const saved = await adapter.serialize({ document_model_ref: ref, format: "docx" });
    expect(saved.bytes).toEqual(imageDoc());
  });

  it("refuses payloads the writer cannot embed — typed codes, no plan mutation", async () => {
    const { model } = await openImageDoc();
    expect(errCode(() => model.insertImage(0, baseImage({ base64: "" })))).toBe("bad_image");
    expect(errCode(() => model.insertImage(0, undefined as never))).toBe("bad_image");
    expect(errCode(() => model.insertImage(0, { ...baseImage(), mime: "image/webp" } as unknown as DocxNewImage))).toBe("bad_image_mime");
    expect(errCode(() => model.insertImage(0, baseImage({ widthPx: 0 })))).toBe("bad_image_size");
    expect(errCode(() => model.insertImage(0, baseImage({ heightPx: Number.NaN })))).toBe("bad_image_size");
    expect(errCode(() => model.insertImage(0, baseImage({ posOffsetEmu: { x: Number.NaN, y: 0 } })))).toBe("bad_image_position");
    expect(errCode(() => model.insertImage(99, baseImage()))).toBe("bad_index");
    expect(model.isDirty).toBe(false);
  });

  it("crop/replace-bytes on an original image rides replace_block_xml with replaceImage", async () => {
    const { model } = await openImageDoc();
    model.applyEdit({
      op: "replace_block_xml",
      docxIndex: 1,
      xml: "<w:p><w:r><w:drawing/></w:r></w:p>",
      replaceImage: { base64: "Q1JPUFBFRA==", mime: "image/jpeg" },
    });
    const block = model.savePlan().finalBlocks[1];
    expect(block).toEqual({
      kind: "xml",
      docxIndex: 1,
      xml: "<w:p><w:r><w:drawing/></w:r></w:p>",
      replaceImage: { base64: "Q1JPUFBFRA==", mime: "image/jpeg" },
    });
  });

  it("refuses a replaceImage payload the writer cannot embed", async () => {
    const { model } = await openImageDoc();
    expect(errCode(() => model.replaceBlockXml(1, "<w:p/>", { base64: "", mime: "image/png" }))).toBe("bad_image");
    expect(errCode(() => model.replaceBlockXml(1, "<w:p/>", { base64: "QUJD", mime: "image/webp" } as never))).toBe("bad_image_mime");
    expect(model.isDirty).toBe(false);
  });

  it("removing an image drops it from the plan (delete is an edit, not a hidden keep)", async () => {
    const { model } = await openImageDoc();
    model.removeBlock(1);
    const plan = model.savePlan().finalBlocks;
    expect(plan.map((b) => b.kind)).toEqual(["original", "original"]);
  });
});
