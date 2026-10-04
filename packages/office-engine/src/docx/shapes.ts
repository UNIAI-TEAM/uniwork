// DOCX shape insert surface (B9): one self-contained OOXML shape paragraph the
// editor inserts as a docProtected node carrying `genXml`. The paragraph is
// ported shape-for-shape from the vendored builders, which the UniWork binding
// shim does not re-export:
//   buildLineParagraphXml    packages/docx-engine/src/generate.ts:1034
//   buildTextboxParagraphXml packages/docx-engine/src/generate.ts:2897
//   buildShapeParagraphXml   packages/docx-engine/src/generate.ts:3143
// The save plan already consumes editor-created fragments as { kind: "xml" }
// rows (renderer/editor/convert.ts:2007-2068, which also patches text, size and
// fill/outline back into the fragment), and the view bridge replays them through
// the existing insert_xml / replace_block_xml ops — so shapes need no new op and
// no save-path change. Collapse these ports to an import if the shim ever
// exports the builders.
import { DocxEngineError } from "./engine";

/** The basic gallery set of this task: rect/ellipse/line/arrow (upstream
 * LINE_KINDS:1025) plus the text box (buildTextboxParagraphXml). */
export const DOCX_SHAPE_KINDS = ["rect", "ellipse", "line", "arrow", "textBox"] as const;

export type DocxShapeKind = (typeof DOCX_SHAPE_KINDS)[number];

/** Insert-time display size in CSS px: Word's 5 cm × 3 cm default, and the
 * 12 px grab band straight lines land as (insertLineAt, ribbon-tabs.tsx:459). */
export const DOCX_SHAPE_DEFAULT_SIZES: Record<DocxShapeKind, { widthPx: number; heightPx: number }> = {
  rect: { widthPx: 189, heightPx: 113 },
  ellipse: { widthPx: 189, heightPx: 113 },
  line: { widthPx: 189, heightPx: 12 },
  arrow: { widthPx: 189, heightPx: 12 },
  textBox: { widthPx: 189, heightPx: 113 },
};

/** One shape to insert. Size and paint default per kind (genoffice's gallery
 * defaults: Office blue fill / darker outline, black stroke for lines). */
export interface DocxShapeSpec {
  kind: DocxShapeKind;
  widthPx?: number;
  heightPx?: number;
  /** wp:docPr id; the caller keeps it unique in the document (default 1). */
  shapeId?: number;
  /** solid fill hex without '#'; kind default when omitted. */
  fillHex?: string;
  /** outline hex without '#'; kind default when omitted. */
  borderHex?: string;
}

/** Structural mirror of the vendored TextboxDisplay subset the docProtected
 * node view renders and pmDocToSavePlan reads back (upstream types.ts:1622).
 * Kept structural because the binding shim exports no shape types; the literal
 * fields are exactly what genoffice's insert helpers set (ribbon-tabs.tsx:419,
 * :469, :336). Like those helpers the display carries no floating/offset fields,
 * so an inserted shape keeps its anchor slot live and only lands at the anchored
 * position after the first save+reopen (F4: genoffice parity, not a port gap). */
export interface DocxShapeDisplay {
  fill?: string;
  borderColor?: string;
  widthPx: number;
  heightPx: number;
  /** absent for text boxes (parse keeps prst only when ≠ rect, parse.ts:2413). */
  prst?: string;
  vAlign?: "center";
  textColor?: string;
  paras?: Array<{ runs: Array<{ text: string }>; align?: "center" }>;
  readOnly?: true;
  insetTopPx?: 0;
  insetRightPx?: 0;
  insetBottomPx?: 0;
  insetLeftPx?: 0;
}

const EMU_PER_PX = 9525;
const EMU_PER_PT = 12700;
const HEX_RE = /^[0-9a-fA-F]{6}$/;

/** Stroke-only kinds: prstGeom + arrow ends (upstream LINE_KINDS:1025). */
const LINE_PRST: Record<"line" | "arrow", { prst: string; tail?: boolean }> = {
  line: { prst: "line" },
  arrow: { prst: "straightConnector1", tail: true },
};

interface ResolvedShape {
  kind: DocxShapeKind;
  widthEmu: number;
  heightEmu: number;
  widthPx: number;
  heightPx: number;
  shapeId: number;
  fillHex: string | null;
  borderHex: string | null;
}

/** Validate the payload before any XML is built; callers branch on the
 * DocxEngineError code, never the message. */
function requireDocxShapeSpec(spec: DocxShapeSpec): ResolvedShape {
  if (!spec || typeof spec !== "object") {
    throw new DocxEngineError("bad_shape", "insert_shape needs a shape spec");
  }
  if (!(DOCX_SHAPE_KINDS as readonly string[]).includes(spec.kind)) {
    throw new DocxEngineError("bad_shape_kind", "shape kind " + String(spec.kind) + " is not in the basic set");
  }
  const defaults = DOCX_SHAPE_DEFAULT_SIZES[spec.kind];
  const widthPx = spec.widthPx ?? defaults.widthPx;
  const heightPx = spec.heightPx ?? defaults.heightPx;
  if (!Number.isFinite(widthPx) || !Number.isFinite(heightPx) || widthPx <= 0 || heightPx <= 0) {
    throw new DocxEngineError(
      "bad_shape_size",
      "shape needs positive widthPx/heightPx, got " + String(widthPx) + "x" + String(heightPx),
    );
  }
  const shapeId = spec.shapeId ?? 1;
  if (!Number.isInteger(shapeId) || shapeId <= 0) {
    throw new DocxEngineError("bad_shape_id", "shapeId must be a positive integer, got " + String(shapeId));
  }
  for (const [field, value] of [
    ["fillHex", spec.fillHex],
    ["borderHex", spec.borderHex],
  ] as const) {
    if (value !== undefined && (typeof value !== "string" || !HEX_RE.test(value))) {
      throw new DocxEngineError("bad_shape_color", field + " must be a 6-digit hex colour, got " + String(value));
    }
  }
  const line = spec.kind === "line" || spec.kind === "arrow";
  const textBox = spec.kind === "textBox";
  return {
    kind: spec.kind,
    widthPx: Math.round(widthPx),
    heightPx: Math.round(heightPx),
    widthEmu: Math.round(widthPx * EMU_PER_PX),
    heightEmu: Math.round(heightPx * EMU_PER_PX),
    shapeId,
    fillHex: spec.fillHex ?? (line ? null : textBox ? "FFFFFF" : "4472C4"),
    borderHex: spec.borderHex ?? (textBox ? "000000" : line ? "000000" : "2F5496"),
  };
}

/** The paragraph an inserted shape saves as. Port of buildShapeParagraphXml
 * (generate.ts:3143) for rect/ellipse, buildLineParagraphXml (:1034) for
 * line/arrow and buildTextboxParagraphXml (:2897) for the text box. */
function shapeParagraphXml(shape: ResolvedShape): string {
  const { widthEmu, heightEmu, shapeId: id } = shape;
  const mcNs =
    'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ' +
    'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"';
  const anchorOpen =
    `<wp:anchor xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ` +
    `distT="0" distB="0" distL="114300" distR="114300" simplePos="0" ` +
    `relativeHeight="251658240" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">` +
    `<wp:simplePos x="0" y="0"/>` +
    `<wp:positionH relativeFrom="column"><wp:align>center</wp:align></wp:positionH>` +
    `<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="${widthEmu}" cy="${heightEmu}"/>` +
    `<wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `<wp:wrapSquare wrapText="bothSides"/>`;
  const graphicOf = (wsp: string, name: string): string =>
    `<wp:docPr id="${id}" name="${name}"/>` +
    `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
    `<a:graphicData xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
    `uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">${wsp}</a:graphicData>` +
    `</a:graphic>`;
  const alternateContent = (anchor: string, vml: string): string =>
    `<mc:AlternateContent ${mcNs}>` +
    `<mc:Choice Requires="wps"><w:drawing>${anchor}</w:drawing></mc:Choice>` +
    `<mc:Fallback><w:pict>${vml}</w:pict></mc:Fallback>` +
    `</mc:AlternateContent>`;

  if (shape.kind === "line" || shape.kind === "arrow") {
    const def = LINE_PRST[shape.kind];
    const colorHex = shape.borderHex ?? "000000";
    const ln =
      `<a:ln w="12700"><a:solidFill><a:srgbClr val="${colorHex}"/></a:solidFill>` +
      (def.tail ? '<a:tailEnd type="triangle"/>' : "") +
      `</a:ln>`;
    const spPr =
      `<wps:spPr>` +
      `<a:xfrm><a:off x="0" y="0"/><a:ext cx="${widthEmu}" cy="${heightEmu}"/></a:xfrm>` +
      `<a:prstGeom prst="${def.prst}"><a:avLst/></a:prstGeom>` +
      `<a:noFill/>` +
      ln +
      `</wps:spPr>`;
    const wsp =
      `<wps:wsp xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">` +
      `<wps:cNvSpPr/>` +
      spPr +
      `<wps:bodyPr/>` +
      `</wps:wsp>`;
    const vmlLine =
      `<v:line xmlns:v="urn:schemas-microsoft-com:vml" ` +
      `from="0,0" to="${Math.round(widthEmu / EMU_PER_PT)}pt,${Math.round(heightEmu / EMU_PER_PT)}pt" ` +
      `strokecolor="#${colorHex}"/>`;
    return `<w:p><w:r>${alternateContent(anchorOpen + graphicOf(wsp, `${def.prst} ${id}`) + "</wp:anchor>", vmlLine)}</w:r></w:p>`;
  }

  const fill = shape.fillHex ?? "";
  const borderHex = shape.borderHex ?? "";
  const spPr =
    `<wps:spPr>` +
    `<a:xfrm><a:off x="0" y="0"/><a:ext cx="${widthEmu}" cy="${heightEmu}"/></a:xfrm>` +
    `<a:prstGeom prst="${shape.kind === "textBox" ? "rect" : shape.kind}"><a:avLst/></a:prstGeom>` +
    (fill ? `<a:solidFill><a:srgbClr val="${fill}"/></a:solidFill>` : `<a:noFill/>`) +
    (borderHex
      ? `<a:ln><a:solidFill><a:srgbClr val="${borderHex}"/></a:solidFill></a:ln>`
      : `<a:ln><a:noFill/></a:ln>`) +
    `</wps:spPr>`;

  if (shape.kind === "textBox") {
    const seeded = `<w:p><w:r><w:t xml:space="preserve"> </w:t></w:r></w:p>`;
    const wsp =
      `<wps:wsp xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">` +
      `<wps:cNvSpPr txBox="1"/>` +
      spPr +
      `<wps:txbx><w:txbxContent>${seeded}</w:txbxContent></wps:txbx>` +
      `<wps:bodyPr/>` +
      `</wps:wsp>`;
    const vmlRect =
      `<v:rect xmlns:v="urn:schemas-microsoft-com:vml" style="position:absolute;width:${widthEmu / EMU_PER_PT}pt;height:${heightEmu / EMU_PER_PT}pt" filled="t" stroked="t">` +
      `<v:textbox><w:txbxContent>${seeded}</w:txbxContent></v:textbox>` +
      `</v:rect>`;
    return `<w:p><w:r>${alternateContent(anchorOpen + graphicOf(wsp, `TextBox ${id}`) + "</wp:anchor>", vmlRect)}</w:r></w:p>`;
  }

  // Word centers autoshape text both ways; the style block's a:fontRef is what
  // gives the light text on the accent fill (generate.ts:3166-3184).
  const seededPara = `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t xml:space="preserve"> </w:t></w:r></w:p>`;
  const style =
    `<wps:style>` +
    `<a:lnRef idx="2"><a:schemeClr val="accent1"/></a:lnRef>` +
    `<a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef>` +
    `<a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef>` +
    `<a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef>` +
    `</wps:style>`;
  const wsp =
    `<wps:wsp xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">` +
    `<wps:cNvSpPr/>` +
    spPr +
    style +
    `<wps:txbx><w:txbxContent>${seededPara}</w:txbxContent></wps:txbx>` +
    `<wps:bodyPr anchor="ctr"/>` +
    `</wps:wsp>`;
  const vmlRect =
    `<v:rect xmlns:v="urn:schemas-microsoft-com:vml" style="position:absolute;width:${widthEmu / EMU_PER_PT}pt;height:${heightEmu / EMU_PER_PT}pt" filled="t" stroked="t">` +
    `<v:textbox style="v-text-anchor:middle"><w:txbxContent>${seededPara}</w:txbxContent></v:textbox>` +
    `</v:rect>`;
  return `<w:p><w:r>${alternateContent(anchorOpen + graphicOf(wsp, `${shape.kind} ${id}`) + "</wp:anchor>", vmlRect)}</w:r></w:p>`;
}

/** The live display of an inserted shape: what the docProtected node view
 * renders and pmDocToSavePlan reads back. Mirrors what the parse yields after a
 * save/reopen for the same XML. */
function shapeDisplay(shape: ResolvedShape): DocxShapeDisplay {
  if (shape.kind === "line" || shape.kind === "arrow") {
    return {
      borderColor: shape.borderHex ?? "000000",
      widthPx: shape.widthPx,
      heightPx: shape.heightPx,
      // the parse names a tail-ended straightConnector1 "lineArrow"
      // (parse-drawing-geometry.ts:54-57); the XML map keeps the raw prst
      prst: shape.kind === "arrow" ? "lineArrow" : "line",
      paras: [],
      readOnly: true,
      insetTopPx: 0,
      insetRightPx: 0,
      insetBottomPx: 0,
      insetLeftPx: 0,
    };
  }
  if (shape.kind === "textBox") {
    return {
      fill: shape.fillHex ?? undefined,
      borderColor: shape.borderHex ?? undefined,
      widthPx: shape.widthPx,
      heightPx: shape.heightPx,
      paras: [{ runs: [{ text: "" }] }],
    };
  }
  return {
    fill: shape.fillHex ?? undefined,
    borderColor: shape.borderHex ?? undefined,
    widthPx: shape.widthPx,
    heightPx: shape.heightPx,
    prst: shape.kind,
    vAlign: "center",
    textColor: "FFFFFF",
    paras: [{ runs: [{ text: "" }], align: "center" }],
  };
}

/** Validate one insert payload and build the OOXML fragment plus the display
 * the editor node carries. Throws typed refusals before anything is written. */
export function buildDocxShape(spec: DocxShapeSpec): { xml: string; display: DocxShapeDisplay } {
  const shape = requireDocxShapeSpec(spec);
  return { xml: shapeParagraphXml(shape), display: shapeDisplay(shape) };
}
