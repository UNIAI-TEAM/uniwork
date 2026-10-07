// UNI-952 (D3-xlsx): charts, pictures and shapes in the print copy.
// Source: the visuals layer's getPrintableVisuals(sheetId?, metricsFor?)
// (L2, X02). The types below are structural copies of that shape so print
// does not import the visuals module. Print passes its own row/column sizes
// as `metricsFor`, so every box is measured in exactly the layout the copy
// prints (hidden rows/columns count 0).
// Each visual prints on every page whose body it overlaps, clipped to that
// page's body (the print area part of the page, never the repeated titles),
// back to front by zIndex. A picture's data: URL prints as is; a chart or
// shape SVG is made self-contained first (its token classes and currentColor
// resolved to computed colours inline, scripts and handlers dropped) and
// prints as a data: SVG; a visual with no image prints as a thin frame with
// its title.
import { escapeHtml, round } from "./print-styles";

/** Row/column sizes in px at 100% zoom (hidden = 0). */
interface XlsxPrintSheetMetrics {
  columnWidth(column: number): number;
  rowHeight(row: number): number;
}

/** One visual as the visuals layer lists it (EMU offsets: 9525 = 1px). */
interface XlsxPrintableVisual {
  readonly sheetId: string;
  readonly zIndex: number;
  readonly anchor: {
    readonly fromRow: number;
    readonly fromColumn: number;
    readonly fromRowOffset: number;
    readonly fromColumnOffset: number;
    readonly toRow: number;
    readonly toColumn: number;
    readonly toRowOffset: number;
    readonly toColumnOffset: number;
  };
  /** Sheet px at 100% from the top-left of A1, headers excluded. */
  readonly box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | null;
  readonly image: { readonly type: "svg"; readonly svg: string } | { readonly type: "dataUrl"; readonly dataUrl: string } | null;
  readonly title: string;
}

/** getPrintableVisuals as print calls it. */
export type XlsxPrintableVisuals = (
  sheetId?: string,
  metricsFor?: (sheetId: string) => XlsxPrintSheetMetrics | null,
) => readonly XlsxPrintableVisual[];

/** A visual placed over the sheet: position and size in points at 100%
 *  from the top-left of A1 (hidden rows/columns count 0). `src` is a data:
 *  image (anything else does not print); null prints a frame with `title`. */
export interface XlsxPrintPicture {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly zIndex: number;
  readonly src: string | null;
  readonly title: string;
}

const PT_PER_PX = 0.75;
const EMU_PER_PX = 9525;
const SVG_NS = "http://www.w3.org/2000/svg";

/** Base64 rasters, or an SVG this module percent-encoded. */
const IMAGE_SRC = /^(?:data:image\/(?:png|jpeg|gif|webp|bmp);base64,[A-Za-z0-9+/]+={0,2}|data:image\/svg\+xml;charset=utf-8,[A-Za-z0-9%._~!*'()-]+)$/;

/** Cumulative sizes (index -> start) over a size function, memoised. */
export class XlsxPrintOffsets {
  private readonly starts: number[] = [0];
  constructor(private readonly size: (index: number) => number) {}

  /** The start of `index`: the sum of the sizes before it. */
  at(index: number): number {
    for (let next = this.starts.length; next <= index; next += 1) this.starts.push(this.starts[next - 1]! + this.size(next - 1));
    return this.starts[Math.max(0, index)]!;
  }
}

const PRESENTATION = ["fill", "stroke", "color", "stop-color", "opacity", "fill-opacity", "stroke-opacity", "stroke-width", "font-family", "font-size", "font-weight", "font-style"] as const;

/** A computed paint that points at a paint server (gradient, pattern): Chromium
 *  resolves `url(#g)` to an absolute `url("http://host/page#g")`, which cannot
 *  resolve inside the data: image, so only the fragment is kept. Null = drop. */
function paintReference(value: string): string | null {
  const id = /#([^"')\s]+)/.exec(value)?.[1];
  return id === undefined ? null : `url(#${id})`;
}

/** An authored inline style with every url() that is not a same-document
 *  fragment replaced by `none`, so nothing in it can load. */
function authoredStyle(style: string | null): string[] {
  if (style === null) return [];
  const safe = style.replace(/url\(\s*(['"]?)(?!#)[^)]*\1\s*\)/gi, "none").trim().replace(/;$/, "");
  return safe === "" ? [] : [safe];
}

/** The overlay SVG with every token class and currentColor resolved to the
 *  computed value inline (it is laid out inside the app's stylesheet for
 *  that), scripts, foreign content and event handlers dropped, as a data:
 *  URL. Null when it does not parse. */
function selfContainedSvg(svg: string, doc: Document): string | null {
  // The overlay renders its SVG inline in HTML, where no xmlns is needed; as
  // XML that markup would parse into null-namespace elements that never draw.
  const markup = /^\s*<svg\b(?![^>]*\sxmlns=)/.test(svg) ? svg.replace(/^\s*<svg\b/, `<svg xmlns="${SVG_NS}"`) : svg;
  const parsed = new DOMParser().parseFromString(markup, "image/svg+xml");
  const root = parsed.documentElement;
  if (root.namespaceURI !== SVG_NS || root.localName !== "svg" || parsed.querySelector("parsererror")) return null;
  for (const node of Array.from(root.querySelectorAll("script, foreignObject"))) node.remove();
  const host = doc.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = "position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none";
  const live = doc.importNode(root, true) as unknown as SVGSVGElement;
  host.appendChild(live);
  doc.body.appendChild(host);
  try {
    const view = doc.defaultView;
    for (const element of [live, ...Array.from(live.querySelectorAll("*"))]) {
      for (const attribute of Array.from(element.attributes)) {
        if (/^on/i.test(attribute.name) || (/href$/i.test(attribute.name) && !/^(?:#|data:image\/)/i.test(attribute.value))) element.removeAttribute(attribute.name);
      }
      const computed = view?.getComputedStyle(element);
      if (computed) {
        const color = computed.getPropertyValue("color");
        // Presentation attributes (fill="currentColor") resolve the same way.
        for (const attribute of Array.from(element.attributes)) {
          if (/currentcolor/i.test(attribute.value) && color !== "") element.setAttribute(attribute.name, attribute.value.replace(/currentcolor/gi, color));
        }
        // The authored style stays (display, transform, clip-path, ...); the
        // computed presentation values follow it and win, as in the cascade.
        const authored = authoredStyle(element.getAttribute("style"));
        const inline: string[] = [];
        for (const property of PRESENTATION) {
          const value = computed.getPropertyValue(property).trim();
          if (value === "") continue;
          const resolved = /^url\(/i.test(value) ? paintReference(value) : /^currentcolor$/i.test(value) ? color : value;
          if (resolved !== null) inline.push(`${property}:${resolved}`);
        }
        if (authored.length + inline.length > 0) element.setAttribute("style", [...authored, ...inline].join(";"));
      }
      element.removeAttribute("class");
    }
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(live))}`;
  } finally {
    host.remove();
  }
}

interface XlsxCollectVisualsInput {
  readonly source: XlsxPrintableVisuals;
  /** The ids the printed sheet goes by (grid id, file id). */
  readonly sheetIds: readonly string[];
  /** Print's own sizes, in points at 100% (hidden = 0). */
  readonly columnWidth: (column: number) => number;
  readonly rowHeight: (row: number) => number;
  readonly document?: Document | undefined;
}

/** The printed sheet's visuals in print's layout. A visual whose image cannot
 *  be made printable falls back to its frame. */
export function collectPrintPictures(input: XlsxCollectVisualsInput): XlsxPrintPicture[] {
  const metrics: XlsxPrintSheetMetrics = {
    columnWidth: (column) => input.columnWidth(column) / PT_PER_PX,
    rowHeight: (row) => input.rowHeight(row) / PT_PER_PX,
  };
  const columns = new XlsxPrintOffsets(input.columnWidth);
  const rows = new XlsxPrintOffsets(input.rowHeight);
  const doc = input.document ?? (typeof document === "undefined" ? undefined : document);
  const ids = new Set(input.sheetIds);
  const listed = input.source(input.sheetIds[0], (sheetId) => (ids.has(sheetId) ? metrics : null));
  const pictures: XlsxPrintPicture[] = [];
  for (const visual of listed) {
    if (!ids.has(visual.sheetId)) continue;
    const { anchor } = visual;
    // The box when the visuals layer measured one, else the anchor in print's sizes.
    const box = visual.box
      ? { x: visual.box.x * PT_PER_PX, y: visual.box.y * PT_PER_PX, width: visual.box.width * PT_PER_PX, height: visual.box.height * PT_PER_PX }
      : (() => {
        const x = columns.at(anchor.fromColumn) + (anchor.fromColumnOffset / EMU_PER_PX) * PT_PER_PX;
        const y = rows.at(anchor.fromRow) + (anchor.fromRowOffset / EMU_PER_PX) * PT_PER_PX;
        const right = columns.at(anchor.toColumn) + (anchor.toColumnOffset / EMU_PER_PX) * PT_PER_PX;
        const bottom = rows.at(anchor.toRow) + (anchor.toRowOffset / EMU_PER_PX) * PT_PER_PX;
        return { x, y, width: right - x, height: bottom - y };
      })();
    if (!(box.width > 0 && box.height > 0) || ![box.x, box.y, box.width, box.height].every(Number.isFinite)) continue;
    let src: string | null = null;
    if (visual.image?.type === "dataUrl") src = IMAGE_SRC.test(visual.image.dataUrl) ? visual.image.dataUrl : null;
    else if (visual.image?.type === "svg" && doc) src = selfContainedSvg(visual.image.svg, doc);
    pictures.push({ ...box, zIndex: Number.isFinite(visual.zIndex) ? visual.zIndex : 0, src, title: visual.title });
  }
  return pictures.sort((left, right) => left.zIndex - right.zIndex);
}

interface XlsxPageBody {
  /** Sheet offset (pt at 100%) of the page body's first column and row. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Where the body starts inside the printed table (headings, titles). */
  readonly left: number;
  readonly top: number;
}

/** The visuals overlapping one page body, clipped to it, as one positioned
 *  layer laid over the table (mirrored from the right on an RTL sheet). */
export function renderPagePictures(pictures: readonly XlsxPrintPicture[], body: XlsxPageBody, scale: number, rightToLeft: boolean): string {
  let html = "";
  for (const picture of pictures) {
    if (picture.x >= body.x + body.width || picture.x + picture.width <= body.x || picture.y >= body.y + body.height || picture.y + picture.height <= body.y) continue;
    const side = rightToLeft ? "right" : "left";
    const place = `${side}:${round((picture.x - body.x) * scale)}pt;top:${round((picture.y - body.y) * scale)}pt;width:${round(picture.width * scale)}pt;height:${round(picture.height * scale)}pt`;
    if (picture.src !== null && IMAGE_SRC.test(picture.src)) {
      html += `<img class="pic" alt="${escapeHtml(picture.title)}" src="${escapeHtml(picture.src)}" style="${place}">`;
    } else {
      html += `<div class="pic frame" style="${place}"><span>${escapeHtml(picture.title)}</span></div>`;
    }
  }
  if (html === "") return "";
  const side = rightToLeft ? "right" : "left";
  return `<div class="vis" style="${side}:${round(body.left * scale)}pt;top:${round(body.top * scale)}pt;width:${round(body.width * scale)}pt;height:${round(body.height * scale)}pt">${html}</div>`;
}

/** The stylesheet rules the visuals layer uses. */
export const VISUAL_RULES = [
  ".sheet{position:relative}",
  ".vis{position:absolute;overflow:hidden}",
  ".pic{position:absolute}",
  ".frame{border:0.75pt solid #808080;display:flex;align-items:center;justify-content:center;text-align:center;overflow:hidden;font-size:9pt;color:#404040;background:#ffffff}",
] as const;
