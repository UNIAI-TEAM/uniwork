// DOCX shape model tests (B9): each basic shape (rect/ellipse/line/arrow/text
// box) builds a self-contained OOXML fragment plus the display the editor node
// carries, the fragments ride the existing insert_xml / replace_block_xml ops
// byte-verbatim through the fake engine, and malformed payloads are refused with
// typed codes before anything reaches the plan.
import { describe, expect, it } from "vitest";
import {
  DOCX_SHAPE_DEFAULT_SIZES,
  DOCX_SHAPE_KINDS,
  DocxSessionModel,
  buildDocxShape,
  createDocxAdapter,
  type DocxShapeKind,
} from "../src/docx";
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

const shapeDoc = () =>
  makeFakeDocxBytes({
    blocks: [
      { type: "paragraph", runs: [{ text: "before" }] },
      { type: "paragraph", runs: [{ text: "after" }] },
    ],
  });

const openShapeDoc = async () => {
  const adapter = createDocxAdapter({ engine: createFakeDocxEngine() });
  const out = await adapter.open({ bytes: shapeDoc(), format: "docx", document_id: "doc-shape" });
  if (out.outcome !== "opened") throw new Error("open failed: " + JSON.stringify(out));
  return { adapter, ref: out.document_model_ref, model: adapter.sessionOf(out.document_model_ref).model };
};

describe("buildDocxShape fragments", () => {
  it("exposes the basic gallery set with per-kind default sizes", () => {
    expect(DOCX_SHAPE_KINDS).toEqual(["rect", "ellipse", "line", "arrow", "textBox"]);
    expect(DOCX_SHAPE_DEFAULT_SIZES.line).toEqual({ widthPx: 189, heightPx: 12 });
    expect(DOCX_SHAPE_DEFAULT_SIZES.textBox).toEqual({ widthPx: 189, heightPx: 113 });
  });

  it("builds a rect paragraph: wps choice + VML fallback, extent in EMU, centered text seed", () => {
    const { xml, display } = buildDocxShape({ kind: "rect", widthPx: 100, heightPx: 50, shapeId: 424242 });
    expect(xml).toContain('<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"');
    expect(xml).toContain('<mc:Choice Requires="wps"><w:drawing><wp:anchor');
    expect(xml).toContain("<mc:Fallback><w:pict><v:rect");
    expect(xml).toContain('prst="rect"');
    expect(xml).toContain('<wp:extent cx="952500" cy="476250"/>');
    expect(xml).toContain('<a:ext cx="952500" cy="476250"/>');
    expect(xml).toContain('<wp:positionH relativeFrom="column"><wp:align>center</wp:align></wp:positionH>');
    expect(xml).toContain('<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>');
    expect(xml).toContain("<wp:wrapSquare wrapText=\"bothSides\"/>");
    expect(xml).toContain('<wp:docPr id="424242" name="rect 424242"/>');
    expect(xml).toContain('<w:jc w:val="center"/>');
    expect(xml).toContain('<wps:bodyPr anchor="ctr"/>');
    expect(display).toEqual({
      fill: "4472C4",
      borderColor: "2F5496",
      widthPx: 100,
      heightPx: 50,
      prst: "rect",
      vAlign: "center",
      textColor: "FFFFFF",
      paras: [{ runs: [{ text: "" }], align: "center" }],
    });
  });

  it("builds an ellipse with its own preset geometry", () => {
    const { xml, display } = buildDocxShape({ kind: "ellipse" });
    expect(xml).toContain('a:prstGeom prst="ellipse"');
    expect(xml).not.toContain('prst="rect"');
    expect(display.prst).toBe("ellipse");
  });

  it("builds stroke-only lines: no text body, no fill, 12 px grab band, no arrow for line", () => {
    const { xml, display } = buildDocxShape({ kind: "line" });
    expect(xml).toContain('<a:prstGeom prst="line">');
    expect(xml).toContain("<a:noFill/>");
    expect(xml).toContain('<a:ln w="12700"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln>');
    expect(xml).not.toContain("<a:tailEnd");
    expect(xml).not.toContain("<w:txbxContent");
    expect(xml).toContain('<v:line xmlns:v="urn:schemas-microsoft-com:vml" from="0,0" to="142pt,9pt" strokecolor="#000000"/>');
    expect(display).toEqual({
      borderColor: "000000",
      widthPx: 189,
      heightPx: 12,
      prst: "line",
      paras: [],
      readOnly: true,
      insetTopPx: 0,
      insetRightPx: 0,
      insetBottomPx: 0,
      insetLeftPx: 0,
    });
  });

  it("builds arrows as straightConnector1 with a triangle tail", () => {
    const { xml, display } = buildDocxShape({ kind: "arrow", borderHex: "C00000" });
    expect(xml).toContain('a:prstGeom prst="straightConnector1"');
    expect(xml).toContain('<a:tailEnd type="triangle"/>');
    expect(xml).toContain('<a:srgbClr val="C00000"/>');
    expect(display.prst).toBe("lineArrow");
  });

  it("builds a text box: txBox marker, white fill, seeded txbxContent, no prst in the display", () => {
    const { xml, display } = buildDocxShape({ kind: "textBox", widthPx: 120, heightPx: 60 });
    expect(xml).toContain('<wps:cNvSpPr txBox="1"/>');
    expect(xml).toContain('<a:prstGeom prst="rect">');
    expect(xml).toContain('<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>');
    expect(xml).toContain("<wps:txbx><w:txbxContent><w:p><w:r><w:t xml:space=\"preserve\"> </w:t></w:r></w:p></w:txbxContent></wps:txbx>");
    expect(xml).toContain('<wps:bodyPr/>');
    expect(xml).toContain('<v:textbox><w:txbxContent>');
    expect(display).toEqual({
      fill: "FFFFFF",
      borderColor: "000000",
      widthPx: 120,
      heightPx: 60,
      paras: [{ runs: [{ text: "" }] }],
    });
  });

  it("refuses malformed payloads with typed codes", () => {
    expect(errCode(() => buildDocxShape({ kind: "star" } as unknown as { kind: DocxShapeKind }))).toBe("bad_shape_kind");
    expect(errCode(() => buildDocxShape({ kind: "rect", widthPx: 0 }))).toBe("bad_shape_size");
    expect(errCode(() => buildDocxShape({ kind: "rect", heightPx: Number.NaN }))).toBe("bad_shape_size");
    expect(errCode(() => buildDocxShape({ kind: "rect", shapeId: 0 }))).toBe("bad_shape_id");
    expect(errCode(() => buildDocxShape({ kind: "rect", shapeId: 1.5 }))).toBe("bad_shape_id");
    expect(errCode(() => buildDocxShape({ kind: "rect", fillHex: "red" }))).toBe("bad_shape_color");
    expect(errCode(() => buildDocxShape({ kind: "rect", borderHex: "#2F5496" }))).toBe("bad_shape_color");
    expect(errCode(() => buildDocxShape(undefined as never))).toBe("bad_shape");
  });
});

describe("docx shape insert plumbing", () => {
  it("round-trips every basic shape fragment byte-verbatim through the fake engine", async () => {
    for (const kind of DOCX_SHAPE_KINDS) {
      const { adapter, ref } = await openShapeDoc();
      const { xml } = buildDocxShape({ kind, shapeId: 500001 });
      adapter.edit(ref, { op: "insert_xml", index: 1, xml });
      const saved = await adapter.serialize({ document_model_ref: ref, format: "docx" });
      const pkg = decodeFakeDocx(saved.bytes);
      const blocks = pkg.blocks as Array<Record<string, unknown>>;
      expect(blocks).toHaveLength(3);
      expect(blocks[0]).toMatchObject({ type: "paragraph", runs: [{ text: "before" }] });
      expect(blocks[2]).toMatchObject({ type: "paragraph", runs: [{ text: "after" }] });
      expect(blocks[1]).toEqual({ type: "xml-fragment", xml });
    }
  });

  it("models the insert as an unanchored xml row and keeps other blocks original", async () => {
    const { model, ref, adapter } = await openShapeDoc();
    const { xml } = buildDocxShape({ kind: "ellipse", widthPx: 200, heightPx: 80 });
    adapter.edit(ref, { op: "insert_xml", index: 2, xml });
    expect(model.isDirty).toBe(true);
    expect(model.savePlan().finalBlocks).toEqual([
      { kind: "original", docxIndex: 0 },
      { kind: "original", docxIndex: 1 },
      { kind: "xml", xml },
    ]);
  });

  it("edits an existing shape's paragraph through the anchored xml row", async () => {
    const { adapter, ref, model } = await openShapeDoc();
    const { xml } = buildDocxShape({ kind: "rect" });
    adapter.edit(ref, { op: "replace_block_xml", docxIndex: 1, xml });
    expect(model.savePlan().finalBlocks).toEqual([
      { kind: "original", docxIndex: 0 },
      { kind: "xml", xml, docxIndex: 1 },
    ]);
  });

  it("an untouched document saves byte-identically", async () => {
    const { adapter, ref } = await openShapeDoc();
    const saved = await adapter.serialize({ document_model_ref: ref, format: "docx" });
    expect(saved.bytes).toEqual(shapeDoc());
  });

  it("refuses empty fragments and out-of-range positions with typed codes", async () => {
    const { model } = await openShapeDoc();
    expect(errCode(() => model.insertXml(0, ""))).toBe("empty_xml");
    expect(errCode(() => model.insertXml(9, "<w:p/>"))).toBe("bad_index");
    expect(model.isDirty).toBe(false);
  });
});
