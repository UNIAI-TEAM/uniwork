/**
 * A3ui (UNI-927) - the Insert panel's pure model: shape gallery data, WordArt
 * presets, preview geometry, image-extension rules, default insert boxes and
 * connector validation. No React, no DOM, no editor - every helper here is a
 * pure function so the panel components stay presentational.
 *
 * Provenance (READ ONLY, never imported): the vendored gallery data lives in
 * `packages/office-upstream/upstream/packages/ui/src/{shape-gallery.tsx,
 * wordart-presets.ts}`. That module is NOT reachable from `packages/views`
 * (`@uniwork/office-upstream` exports only `./pptx-renderer`, `./xlsx-renderer`,
 * `./docs-renderer-editor`, `./browser/locale`, and its own shim file is not in
 * the export map), and the house rule forbids importing genoffice sources from
 * the view layer. So the preset list + silhouettes are mirrored here with the
 * same `prst` names, the same group order and the same 12 WordArt recipes - the
 * DOCX lane (ce9018b3) made the identical call for its gallery.
 *
 * Emitted edits are typed against the REAL registered engine kinds
 * (`PptxEdit` in packages/office-engine/src/pptx/model.ts), so the wire round
 * can forward them unchanged.
 */
import type { PptxEdit } from "@uniwork/office-engine/pptx";

// ── shapes ────────────────────────────────────────────────────────────────

export interface PptxInsertShape {
  /** OOXML preset geometry name; also the `add_element` kind. */
  prst: string;
  /** i18next key under office.pptx.insert. */
  labelKey: string;
}

export interface PptxInsertShapeGroup {
  id: string;
  labelKey: string;
  shapes: readonly PptxInsertShape[];
}

const s = (prst: string, labelKey: string): PptxInsertShape => ({ prst, labelKey });

/** The Insert gallery, grouped and ordered like the PowerPoint Shapes menu. */
export const PPTX_INSERT_SHAPE_GROUPS: readonly PptxInsertShapeGroup[] = [
  {
    id: "lines",
    labelKey: "office.pptx.insert.shapes.group.lines",
    shapes: [
      s("line", "office.pptx.insert.shapes.prst.line"),
      s("lineArrow", "office.pptx.insert.shapes.prst.lineArrow"),
      s("lineArrowDouble", "office.pptx.insert.shapes.prst.lineArrowDouble"),
      s("lineBent", "office.pptx.insert.shapes.prst.lineBent"),
      s("lineCurved", "office.pptx.insert.shapes.prst.lineCurved"),
    ],
  },
  {
    id: "rects",
    labelKey: "office.pptx.insert.shapes.group.rects",
    shapes: [
      s("rect", "office.pptx.insert.shapes.prst.rect"),
      s("roundRect", "office.pptx.insert.shapes.prst.roundRect"),
      s("snip1Rect", "office.pptx.insert.shapes.prst.snip1Rect"),
      s("snipRoundRect", "office.pptx.insert.shapes.prst.snipRoundRect"),
    ],
  },
  {
    id: "basic",
    labelKey: "office.pptx.insert.shapes.group.basic",
    shapes: [
      s("ellipse", "office.pptx.insert.shapes.prst.ellipse"),
      s("triangle", "office.pptx.insert.shapes.prst.triangle"),
      s("rtTriangle", "office.pptx.insert.shapes.prst.rtTriangle"),
      s("parallelogram", "office.pptx.insert.shapes.prst.parallelogram"),
      s("trapezoid", "office.pptx.insert.shapes.prst.trapezoid"),
      s("diamond", "office.pptx.insert.shapes.prst.diamond"),
      s("pentagon", "office.pptx.insert.shapes.prst.pentagon"),
      s("hexagon", "office.pptx.insert.shapes.prst.hexagon"),
      s("octagon", "office.pptx.insert.shapes.prst.octagon"),
      s("plus", "office.pptx.insert.shapes.prst.plus"),
      s("donut", "office.pptx.insert.shapes.prst.donut"),
      s("blockArc", "office.pptx.insert.shapes.prst.blockArc"),
      s("heart", "office.pptx.insert.shapes.prst.heart"),
      s("sun", "office.pptx.insert.shapes.prst.sun"),
      s("cloud", "office.pptx.insert.shapes.prst.cloud"),
      s("lightningBolt", "office.pptx.insert.shapes.prst.lightningBolt"),
    ],
  },
  {
    id: "arrows",
    labelKey: "office.pptx.insert.shapes.group.arrows",
    shapes: [
      s("rightArrow", "office.pptx.insert.shapes.prst.rightArrow"),
      s("leftArrow", "office.pptx.insert.shapes.prst.leftArrow"),
      s("upArrow", "office.pptx.insert.shapes.prst.upArrow"),
      s("downArrow", "office.pptx.insert.shapes.prst.downArrow"),
      s("leftRightArrow", "office.pptx.insert.shapes.prst.leftRightArrow"),
      s("upDownArrow", "office.pptx.insert.shapes.prst.upDownArrow"),
      s("chevron", "office.pptx.insert.shapes.prst.chevron"),
      s("homePlate", "office.pptx.insert.shapes.prst.homePlate"),
    ],
  },
  {
    id: "stars",
    labelKey: "office.pptx.insert.shapes.group.stars",
    shapes: [
      s("star4", "office.pptx.insert.shapes.prst.star4"),
      s("star5", "office.pptx.insert.shapes.prst.star5"),
      s("star6", "office.pptx.insert.shapes.prst.star6"),
      s("star8", "office.pptx.insert.shapes.prst.star8"),
      s("star12", "office.pptx.insert.shapes.prst.star12"),
      s("ribbon", "office.pptx.insert.shapes.prst.ribbon"),
    ],
  },
  {
    id: "flowchart",
    labelKey: "office.pptx.insert.shapes.group.flowchart",
    shapes: [
      s("flowChartProcess", "office.pptx.insert.shapes.prst.flowChartProcess"),
      s("flowChartDecision", "office.pptx.insert.shapes.prst.flowChartDecision"),
      s("flowChartTerminator", "office.pptx.insert.shapes.prst.flowChartTerminator"),
      s("flowChartDocument", "office.pptx.insert.shapes.prst.flowChartDocument"),
      s("flowChartConnector", "office.pptx.insert.shapes.prst.flowChartConnector"),
    ],
  },
  {
    id: "callouts",
    labelKey: "office.pptx.insert.shapes.group.callouts",
    shapes: [
      s("wedgeRectCallout", "office.pptx.insert.shapes.prst.wedgeRectCallout"),
      s("wedgeRoundRectCallout", "office.pptx.insert.shapes.prst.wedgeRoundRectCallout"),
      s("wedgeEllipseCallout", "office.pptx.insert.shapes.prst.wedgeEllipseCallout"),
      s("cloudCallout", "office.pptx.insert.shapes.prst.cloudCallout"),
    ],
  },
];

/** Line presets: a straight connector keeps a zero-height frame. */
export const PPTX_INSERT_LINE_PRSTS: readonly string[] = ["line", "lineArrow", "lineArrowDouble", "lineBent", "lineCurved"];

/** Flowchart nodes draw flat (they also disambiguate from diamond/ellipse). */
export const PPTX_INSERT_FLAT_PRSTS: readonly string[] = [
  "flowChartProcess",
  "flowChartDecision",
  "flowChartTerminator",
  "flowChartDocument",
  "flowChartConnector",
];

// ── WordArt ───────────────────────────────────────────────────────────────

export interface PptxInsertWordArtPreset {
  id: string;
  /** i18next key under office.pptx.insert. */
  nameKey: string;
  fill: string;
  outline?: { color: string; widthEmu: number };
  bold?: boolean;
  italic?: boolean;
}

/** 12 recipes mirroring the vendored gallery (12700 EMU = 1pt). */
export const PPTX_INSERT_WORDART_PRESETS: readonly PptxInsertWordArtPreset[] = [
  { id: "blue", nameKey: "office.pptx.insert.wordart.preset.blue", fill: "#4472C4", bold: true },
  { id: "gold", nameKey: "office.pptx.insert.wordart.preset.gold", fill: "#FFC000", bold: true },
  { id: "red", nameKey: "office.pptx.insert.wordart.preset.red", fill: "#C00000", bold: true },
  { id: "purple", nameKey: "office.pptx.insert.wordart.preset.purple", fill: "#7030A0", bold: true },
  { id: "green-italic", nameKey: "office.pptx.insert.wordart.preset.green-italic", fill: "#70AD47", bold: true, italic: true },
  { id: "white-orange", nameKey: "office.pptx.insert.wordart.preset.white-orange", fill: "#FFFFFF", outline: { color: "#ED7D31", widthEmu: 19050 }, bold: true },
  { id: "white-red", nameKey: "office.pptx.insert.wordart.preset.white-red", fill: "#FFFFFF", outline: { color: "#C00000", widthEmu: 19050 }, bold: true },
  { id: "gold-brown", nameKey: "office.pptx.insert.wordart.preset.gold-brown", fill: "#FFC000", outline: { color: "#7F5F00", widthEmu: 12700 }, bold: true },
  { id: "sky-navy", nameKey: "office.pptx.insert.wordart.preset.sky-navy", fill: "#00B0F0", outline: { color: "#1F4E79", widthEmu: 12700 }, bold: true },
  { id: "navy-white", nameKey: "office.pptx.insert.wordart.preset.navy-white", fill: "#1F3864", outline: { color: "#FFFFFF", widthEmu: 12700 }, bold: true },
  { id: "black-gold", nameKey: "office.pptx.insert.wordart.preset.black-gold", fill: "#0D0D0D", outline: { color: "#FFC000", widthEmu: 19050 }, bold: true },
  { id: "silver-dark", nameKey: "office.pptx.insert.wordart.preset.silver-dark", fill: "#D9D9D9", outline: { color: "#595959", widthEmu: 12700 }, bold: true },
];

/** Gallery preview stroke: EMU line width -> pt (the unit `add_element` takes). */
export function wordArtStrokePt(widthEmu: number): number {
  return Math.round((widthEmu / 12700) * 100) / 100;
}

/** EMU line width -> CSS px for the gallery swatch (12700 EMU = 1pt = 4/3 px). */
export function wordArtStrokePx(widthEmu: number): number {
  return Math.round((widthEmu / 12700) * (4 / 3) * 100) / 100;
}

/** The WordArt text element: a text box whose run carries the preset's colour. */
export function wordArtParagraphs(preset: PptxInsertWordArtPreset, text: string): Array<Record<string, unknown>> {
  const run: Record<string, unknown> = { text, color: preset.fill };
  if (preset.bold) run.bold = true;
  if (preset.italic) run.italic = true;
  return [{ runs: [run], align: "center" }];
}

// ── preview geometry ──────────────────────────────────────────────────────

const R = (value: number) => Math.round(value * 100) / 100;

function pointsPathD(points: readonly number[]): string {
  const parts: string[] = [];
  for (let i = 0; i < points.length; i += 2) {
    parts.push(`${i === 0 ? "M" : "L"} ${R(points[i] as number)} ${R(points[i + 1] as number)}`);
  }
  return `${parts.join(" ")} Z`;
}

function ellipsePathD(w: number, h: number): string {
  const rx = w / 2;
  const ry = h / 2;
  return `M 0 ${R(ry)} A ${R(rx)} ${R(ry)} 0 1 1 ${R(w)} ${R(ry)} A ${R(rx)} ${R(ry)} 0 1 1 0 ${R(ry)} Z`;
}

function roundRectPathD(w: number, h: number, r: number): string {
  return (
    `M ${R(r)} 0 L ${R(w - r)} 0 A ${R(r)} ${R(r)} 0 0 1 ${R(w)} ${R(r)} L ${R(w)} ${R(h - r)} ` +
    `A ${R(r)} ${R(r)} 0 0 1 ${R(w - r)} ${R(h)} L ${R(r)} ${R(h)} A ${R(r)} ${R(r)} 0 0 1 0 ${R(h - r)} ` +
    `L 0 ${R(r)} A ${R(r)} ${R(r)} 0 0 1 ${R(r)} 0 Z`
  );
}

function rectPathD(w: number, h: number): string {
  return `M 0 0 L ${R(w)} 0 L ${R(w)} ${R(h)} L 0 ${R(h)} Z`;
}

function starPathD(points: number, w: number, h: number): string {
  const cx = w / 2;
  const cy = h / 2;
  const outerX = w / 2;
  const outerY = h / 2;
  const inner = 0.382;
  const out: number[] = [];
  for (let i = 0; i < points * 2; i += 1) {
    const angle = (Math.PI * i) / points - Math.PI / 2;
    const rx = i % 2 === 0 ? outerX : outerX * inner;
    const ry = i % 2 === 0 ? outerY : outerY * inner;
    out.push(cx + rx * Math.cos(angle), cy + ry * Math.sin(angle));
  }
  return pointsPathD(out);
}

/** A block arrow along the given direction, occupying the whole box. */
function blockArrowPathD(dir: "right" | "left" | "up" | "down", w: number, h: number): string {
  const shaft = 0.4;
  switch (dir) {
    case "right": {
      const half = (h * shaft) / 2;
      const cy = h / 2;
      const headX = w * 0.6;
      return pointsPathD([0, cy - half, headX, cy - half, headX, 0, w, cy, headX, h, headX, cy + half, 0, cy + half]);
    }
    case "left": {
      const half = (h * shaft) / 2;
      const cy = h / 2;
      const headX = w * 0.4;
      return pointsPathD([w, cy - half, headX, cy - half, headX, 0, 0, cy, headX, h, headX, cy + half, w, cy + half]);
    }
    case "up": {
      const half = (w * shaft) / 2;
      const cx = w / 2;
      const headY = h * 0.4;
      return pointsPathD([cx - half, h, cx - half, headY, 0, headY, cx, 0, w, headY, cx + half, headY, cx + half, h]);
    }
    default: {
      const half = (w * shaft) / 2;
      const cx = w / 2;
      const headY = h * 0.6;
      return pointsPathD([cx - half, 0, cx - half, headY, 0, headY, cx, h, w, headY, cx + half, headY, cx + half, 0]);
    }
  }
}

/** A two-ended block arrow (left-right / up-down). */
function doubleArrowPathD(axis: "h" | "v", w: number, h: number): string {
  const half = (h * 0.34) / 2;
  const cy = h / 2;
  const cx = w / 2;
  if (axis === "h") {
    return pointsPathD([0, cy, w * 0.22, 0, w * 0.22, cy - half, w * 0.78, cy - half, w * 0.78, 0, w, cy, w * 0.78, h, w * 0.78, cy + half, w * 0.22, cy + half, w * 0.22, h]);
  }
  const halfW = (w * 0.34) / 2;
  return pointsPathD([cx, 0, w, h * 0.22, cx + halfW, h * 0.22, cx + halfW, h * 0.78, w, h * 0.78, cx, h, 0, h * 0.78, cx - halfW, h * 0.78, cx - halfW, h * 0.22, 0, h * 0.22]);
}

/** Open V arrowhead stroke at (x2,y2), pointing away from (x1,y1). */
function arrowHeadD(x1: number, y1: number, x2: number, y2: number, len: number): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const l = Math.hypot(dx, dy) || 1;
  const ux = dx / l;
  const uy = dy / l;
  const bx = x2 - ux * len;
  const by = y2 - uy * len;
  const wl = len * 0.6;
  return `M ${R(bx - uy * wl)} ${R(by + ux * wl)} L ${R(x2)} ${R(y2)} L ${R(bx + uy * wl)} ${R(by - ux * wl)}`;
}

const CLOUD_D =
  "M 0.24 1 A 0.2 0.2 0 0 1 0.12 0.62 A 0.24 0.24 0 0 1 0.38 0.3 A 0.22 0.22 0 0 1 0.72 0.22 " +
  "A 0.2 0.2 0 0 1 0.95 0.6 A 0.18 0.18 0 0 1 0.86 1 Z";

/** Preset -> SVG path in a local `w x h` box. Unknown presets fall back to a rect. */
export function shapePreviewPath(prst: string, w: number, h: number): string {
  if (prst === "line" || prst === "lineArrow" || prst === "lineArrowDouble") {
    const parts = [`M 0 ${R(h)} L ${R(w)} 0`];
    const len = Math.min(w, h) * 0.35;
    if (prst !== "line") parts.push(arrowHeadD(0, h, w, 0, len));
    if (prst === "lineArrowDouble") parts.push(arrowHeadD(w, 0, 0, h, len));
    return parts.join(" ");
  }
  if (prst === "lineBent") return `M 0 ${R(h)} L ${R(w / 2)} ${R(h)} L ${R(w / 2)} 0 L ${R(w)} 0`;
  if (prst === "lineCurved") return `M 0 ${R(h)} C ${R(w * 0.6)} ${R(h)} ${R(w * 0.4)} 0 ${R(w)} 0`;
  switch (prst) {
    case "rect":
    case "flowChartProcess":
      return rectPathD(w, h);
    case "roundRect":
    case "flowChartTerminator":
      return roundRectPathD(w, h, Math.min(w, h) * 0.16667);
    case "snip1Rect":
      return pointsPathD([w * 0.3, 0, w, 0, w, h, 0, h, 0, h * 0.3]);
    case "snipRoundRect":
      return pointsPathD([w * 0.3, 0, w * 0.85, 0, w, h * 0.15, w, h, 0, h, 0, h * 0.3]);
    case "ellipse":
    case "flowChartConnector":
      return ellipsePathD(w, h);
    case "triangle":
      return pointsPathD([w / 2, 0, w, h, 0, h]);
    case "rtTriangle":
      return pointsPathD([0, 0, 0, h, w, h]);
    case "parallelogram":
      return pointsPathD([w * 0.25, 0, w, 0, w * 0.75, h, 0, h]);
    case "trapezoid":
      return pointsPathD([w * 0.2, 0, w * 0.8, 0, w, h, 0, h]);
    case "diamond":
    case "flowChartDecision":
      return pointsPathD([w / 2, 0, w, h / 2, w / 2, h, 0, h / 2]);
    case "pentagon":
    case "homePlate":
      return pointsPathD([w / 2, 0, w, h * 0.38, w * 0.81, h, w * 0.19, h, 0, h * 0.38]);
    case "hexagon":
      return pointsPathD([w * 0.25, 0, w * 0.75, 0, w, h / 2, w * 0.75, h, w * 0.25, h, 0, h / 2]);
    case "octagon":
      return pointsPathD([w * 0.29, 0, w * 0.71, 0, w, h * 0.29, w, h * 0.71, w * 0.71, h, w * 0.29, h, 0, h * 0.71, 0, h * 0.29]);
    case "plus":
      return pointsPathD([w * 0.33, 0, w * 0.67, 0, w * 0.67, h * 0.33, w, h * 0.33, w, h * 0.67, w * 0.67, h * 0.67, w * 0.67, h, w * 0.33, h, w * 0.33, h * 0.67, 0, h * 0.67, 0, h * 0.33, w * 0.33, h * 0.33]);
    case "donut":
      return `${ellipsePathD(w, h)} M ${R(w * 0.25)} ${R(h / 2)} A ${R(w * 0.25)} ${R(h * 0.25)} 0 1 0 ${R(w * 0.75)} ${R(h / 2)} A ${R(w * 0.25)} ${R(h * 0.25)} 0 1 0 ${R(w * 0.25)} ${R(h / 2)} Z`;
    case "blockArc":
      return `M 0 ${R(h)} A ${R(w)} ${R(h)} 0 0 1 ${R(w)} 0 L ${R(w * 0.62)} ${R(h * 0.38)} A ${R(w * 0.38)} ${R(h * 0.38)} 0 0 0 ${R(w * 0.38)} ${R(h * 0.62)} Z`;
    case "heart":
      return `M ${R(w / 2)} ${R(h)} C 0 ${R(h * 0.55)} ${R(w * 0.1)} 0 ${R(w / 2)} ${R(h * 0.26)} C ${R(w * 0.9)} 0 ${R(w)} ${R(h * 0.55)} ${R(w / 2)} ${R(h)} Z`;
    case "sun":
      return `${starPathD(12, w, h)}`;
    case "cloud":
    case "cloudCallout": {
      const out: string[] = [];
      const tokens = CLOUD_D.split(" ");
      for (let i = 0; i < tokens.length; i += 1) {
        const token = tokens[i] as string;
        if (token === "M" || token === "A") {
          out.push(token, String(R(Number(tokens[i + 1]) * w)), String(R(Number(tokens[i + 2]) * h)));
          i += 2;
        } else if (token === "L" || token === "Z") {
          if (token === "L") {
            out.push(token, String(R(Number(tokens[i + 1]) * w)), String(R(Number(tokens[i + 2]) * h)));
            i += 2;
          } else {
            out.push(token);
          }
        } else {
          out.push(token);
        }
      }
      return out.join(" ");
    }
    case "lightningBolt":
      return pointsPathD([w * 0.45, 0, w, 0, w * 0.62, h * 0.45, w * 0.95, h * 0.45, w * 0.3, h, w * 0.45, h * 0.55, w * 0.05, h * 0.55]);
    case "rightArrow":
      return blockArrowPathD("right", w, h);
    case "leftArrow":
      return blockArrowPathD("left", w, h);
    case "upArrow":
      return blockArrowPathD("up", w, h);
    case "downArrow":
      return blockArrowPathD("down", w, h);
    case "leftRightArrow":
      return doubleArrowPathD("h", w, h);
    case "upDownArrow":
      return doubleArrowPathD("v", w, h);
    case "chevron":
      return pointsPathD([0, 0, w * 0.65, 0, w, h / 2, w * 0.65, h, 0, h, w * 0.35, h / 2]);
    case "ribbon":
      return pointsPathD([w * 0.2, 0, w, 0, w * 0.8, h * 0.5, w, h, w * 0.2, h, 0, h * 0.5]);
    case "star4":
      return starPathD(4, w, h);
    case "star5":
      return starPathD(5, w, h);
    case "star6":
      return starPathD(6, w, h);
    case "star8":
      return starPathD(8, w, h);
    case "star12":
      return starPathD(12, w, h);
    case "flowChartDocument":
      return `M 0 0 L ${R(w)} 0 L ${R(w)} ${R(h * 0.72)} C ${R(w * 0.72)} ${R(h * 1.1)} ${R(w * 0.28)} ${R(h * 0.34)} 0 ${R(h * 0.72)} Z`;
    case "wedgeRectCallout":
      return `${rectPathD(w, h * 0.76)} M ${R(w * 0.18)} ${R(h * 0.76)} L ${R(w * 0.12)} ${R(h)} L ${R(w * 0.4)} ${R(h * 0.76)} Z`;
    case "wedgeRoundRectCallout":
      return `${roundRectPathD(w, h * 0.76, Math.min(w, h) * 0.16)} M ${R(w * 0.18)} ${R(h * 0.76)} L ${R(w * 0.12)} ${R(h)} L ${R(w * 0.4)} ${R(h * 0.76)} Z`;
    case "wedgeEllipseCallout":
      return `${ellipsePathD(w, h * 0.76)} M ${R(w * 0.18)} ${R(h * 0.76)} L ${R(w * 0.12)} ${R(h)} L ${R(w * 0.4)} ${R(h * 0.76)} Z`;
    default:
      return rectPathD(w, h);
  }
}

/** Preview box for a preset: flowchart nodes are flat. */
export function shapePreviewBox(prst: string, size: number): { w: number; h: number } {
  return PPTX_INSERT_FLAT_PRSTS.includes(prst) ? { w: size, h: size * 0.62 } : { w: size, h: size };
}

// ── images ────────────────────────────────────────────────────────────────

/** Extensions the vendored `addPicture`/`replacePicture` accept. */
export const PPTX_IMAGE_EXTS: readonly string[] = ["png", "jpg", "jpeg", "gif", "bmp", "webp", "tif", "tiff"];

/** `accept` attribute for the picture picker. */
export const PPTX_IMAGE_ACCEPT = "image/png,image/jpeg,image/gif,image/bmp,image/webp,image/tiff";

/** File name -> lowercase extension without the dot, or null when absent/unsupported. */
export function imageExtFromName(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot < 0 || dot === name.length - 1) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  return PPTX_IMAGE_EXTS.includes(ext) ? ext : null;
}

// ── default insert boxes (px on a 960-wide slide) ─────────────────────────

export interface PptxInsertBox {
  xPx: number;
  yPx: number;
  wPx: number;
  hPx: number;
}

export const PPTX_INSERT_TEXT_BOX_KIND = "textbox";

/** Default frame for a newly inserted element of `kind`. */
export function defaultInsertBox(kind: string): PptxInsertBox {
  if (PPTX_INSERT_LINE_PRSTS.includes(kind)) return { xPx: 100, yPx: 220, wPx: 240, hPx: 0 };
  if (kind === PPTX_INSERT_TEXT_BOX_KIND) return { xPx: 100, yPx: 100, wPx: 360, hPx: 90 };
  return { xPx: 100, yPx: 80, wPx: 220, hPx: 150 };
}

/** WordArt reads wider than a plain shape, so it gets its own frame. */
export const PPTX_INSERT_WORDART_BOX: PptxInsertBox = { xPx: 100, yPx: 90, wPx: 460, hPx: 120 };

/** Default frame for an inserted picture. */
export const PPTX_INSERT_PICTURE_BOX: PptxInsertBox = { xPx: 100, yPx: 80, wPx: 320, hPx: 200 };

// ── connectors + grouping ─────────────────────────────────────────────────

export const PPTX_CONNECTOR_KINDS = ["straight", "elbow", "curved"] as const;
export type PptxConnectorKind = (typeof PPTX_CONNECTOR_KINDS)[number];

export const PPTX_CONNECTOR_ARROWS = ["none", "end", "both"] as const;
export type PptxConnectorArrow = (typeof PPTX_CONNECTOR_ARROWS)[number];

/** One element the connector/group pickers can target (top-level ids only). */
export interface PptxInsertElementRef {
  id: string;
  type: string;
  label?: string;
}

/** Element types the vendored connector/group ops accept as endpoints. */
export const PPTX_CONNECTABLE_TYPES: readonly string[] = ["text", "shape", "picture"];

/** What the panel asks the (A4e-owned) addConnector channel to do. */
export interface PptxInsertConnectorRequest {
  slideIndex: number;
  from: string;
  to: string;
  kind: PptxConnectorKind;
  arrow: PptxConnectorArrow;
}

export type PptxInsertConnectorValidation =
  | { ok: true }
  | { ok: false; reasonKey: string };

/** Pure pre-flight for the connector picker, so the button never sends a
 * request the vendored `addConnector` would refuse (from === to, missing
 * endpoints, a non-connectable type). */
export function validateConnectorRequest(
  request: PptxInsertConnectorRequest,
  elements: readonly PptxInsertElementRef[],
): PptxInsertConnectorValidation {
  const connectable = elements.filter((element) => PPTX_CONNECTABLE_TYPES.includes(element.type));
  const from = connectable.find((element) => element.id === request.from);
  const to = connectable.find((element) => element.id === request.to);
  if (!from || !to) return { ok: false, reasonKey: "office.pptx.insert.connector.empty" };
  if (request.from === request.to) return { ok: false, reasonKey: "office.pptx.insert.connector.pick_both" };
  if (!PPTX_CONNECTOR_KINDS.includes(request.kind)) return { ok: false, reasonKey: "office.pptx.insert.connector.pick_both" };
  if (!PPTX_CONNECTOR_ARROWS.includes(request.arrow)) return { ok: false, reasonKey: "office.pptx.insert.connector.pick_both" };
  return { ok: true };
}

/** Elements that can be grouped: the vendored GROUPABLE set. */
export function groupableSelection(
  selectedIds: readonly string[],
  elements: readonly PptxInsertElementRef[],
): string[] {
  const groupable = new Set(elements.filter((element) => PPTX_CONNECTABLE_TYPES.includes(element.type)).map((element) => element.id));
  return selectedIds.filter((id) => groupable.has(id));
}

// ── emitted edits + commands ──────────────────────────────────────────────

/**
 * The edits this panel emits. Every member is `Extract`ed from the real
 * `PptxEdit` union, so a wire-round forward can hand them to the editor's edit
 * channel unchanged and a drift in the engine union breaks this file loudly.
 */
export type PptxInsertEdit =
  | Extract<PptxEdit, { op: "add_element" }>
  | Extract<PptxEdit, { op: "add_image" }>
  | Extract<PptxEdit, { op: "replace_picture" }>;

/** Command ids the wire round maps onto toolbar commands. */
export const PPTX_INSERT_COMMAND_IDS = [
  "insert-shape",
  "insert-text-box",
  "insert-image",
  "replace-picture",
  "insert-wordart",
  "insert-connector",
  "group-elements",
] as const;
export type PptxInsertCommandId = (typeof PPTX_INSERT_COMMAND_IDS)[number];

/** Shapes/text box/WordArt all ride the registered `add_element` kind. */
export function addElementEdit(slideIndex: number, kind: string, box: PptxInsertBox, extra?: Partial<Extract<PptxEdit, { op: "add_element" }>>): Extract<PptxEdit, { op: "add_element" }> {
  return { op: "add_element", slideIndex, kind, ...box, ...extra };
}