/**
 * A tiny render-tree-to-SVG intermediate: `PptxRenderSlide` -> `SvgNode` -> React DOM or
 * a serialized data URL (thumbnails). Keeping one data description means the on-screen
 * canvas and the rail thumbnails can never drift: both go through `buildSlideSvg` and only
 * the final emitter differs.
 *
 * Attribute names are SVG's own (kebab-case, e.g. `stroke-width`), so the serializer is a
 * straight XML dump while `reactSvgProps` maps them onto React's camelCase props.
 */

export type SvgAttrValue = string | number | undefined;

export interface SvgNode {
  tag: string;
  attrs?: Record<string, SvgAttrValue>;
  /** Text content (SVG text nodes); children are not rendered when set. */
  text?: string;
  children?: SvgNode[];
}

/** Placement transform for one render-tree box: rotation and flip pivot on the box center
 *  (OOXML `a:xfrm` semantics), so the mapped local coordinate origin is the box top-left. */
export function boxTransform(box: { x: number; y: number; w: number; h: number; rotationDeg: number; flipH?: boolean; flipV?: boolean }): string {
  const parts = [`translate(${px(box.x + box.w / 2)} ${px(box.y + box.h / 2)})`];
  if (box.rotationDeg) parts.push(`rotate(${px(box.rotationDeg)})`);
  if (box.flipH || box.flipV) parts.push(`scale(${box.flipH ? -1 : 1} ${box.flipV ? -1 : 1})`);
  parts.push(`translate(${px(-box.w / 2)} ${px(-box.h / 2)})`);
  return parts.join(" ");
}

/** Element without text content. */
export function svgEl(
  tag: string,
  attrs?: Record<string, SvgAttrValue>,
  children?: Array<SvgNode | null | undefined>,
): SvgNode {
  const kept = children?.filter((child): child is SvgNode => child != null);
  return { tag, ...(attrs ? { attrs } : {}), ...(kept?.length ? { children: kept } : {}) };
}

/** Text-bearing element (`<text>`/`<tspan>`/`<title>`). */
export function svgText(tag: string, attrs: Record<string, SvgAttrValue> | undefined, text: string): SvgNode {
  return { tag, ...(attrs ? { attrs } : {}), text };
}

/** Compact number formatting: 3 decimals, no exponent, `-0` folded to `0`. */
export function px(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round(value * 1000) / 1000;
  return rounded === 0 ? 0 : rounded;
}

/** `[x0,y0,x1,y1,...]` -> a `points` attribute value. */
export function pointsAttr(points: readonly number[]): string {
  const out: string[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) out.push(`${px(points[i]!)} ${px(points[i + 1]!)}`);
  return out.join(" ");
}

function escapeXmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeXmlAttr(value: string): string {
  return escapeXmlText(value).replace(/"/g, "&quot;");
}

function serializeAttrs(attrs: Record<string, SvgAttrValue> | undefined): string {
  if (!attrs) return "";
  let out = "";
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === "") continue;
    out += ` ${name}="${escapeXmlAttr(String(value))}"`;
  }
  return out;
}

/** Serialize one element (and its subtree) to XML text. */
export function serializeSvgNode(node: SvgNode, indent = ""): string {
  const attrs = serializeAttrs(node.attrs);
  if (node.text != null && !node.children?.length) {
    return `${indent}<${node.tag}${attrs}>${escapeXmlText(node.text)}</${node.tag}>`;
  }
  if (!node.children?.length) return `${indent}<${node.tag}${attrs}/>`;
  const inner = node.children.map((child) => serializeSvgNode(child, `${indent}  `)).join("\n");
  return `${indent}<${node.tag}${attrs}>\n${inner}\n${indent}</${node.tag}>`;
}

export interface SlideMarkupOptions {
  /** Accessible name for the standalone document (thumbnails only; the DOM canvas renders its own). */
  title?: string;
}

/**
 * A standalone SVG document for `root`: the rail thumbnails load it through
 * `data:` and an `<img>`, so it needs its own namespace, size and (optionally) title.
 */
export function slideSvgMarkup(
  root: SvgNode,
  size: { widthPx: number; heightPx: number },
  options: SlideMarkupOptions = {},
): string {
  const attrs: Record<string, SvgAttrValue> = {
    xmlns: "http://www.w3.org/2000/svg",
    viewBox: `0 0 ${px(size.widthPx)} ${px(size.heightPx)}`,
    width: px(size.widthPx),
    height: px(size.heightPx),
  };
  if (options.title) attrs.role = "img";
  const body = options.title ? svgText("title", undefined, options.title) : null;
  return serializeSvgNode(svgEl("svg", attrs, [body, root]));
}

/** `data:` URL for a serialized SVG document (utf-8 percent-encoded, unicode-safe). */
export function svgDataUrl(markup: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
}

const ALREADY_CAMEL = new Set(["viewBox", "preserveAspectRatio", "patternUnits", "patternContentUnits", "gradientUnits", "gradientTransform", "clipPathUnits", "maskUnits", "refX", "refY", "markerWidth", "markerHeight"]);

/** SVG attribute name -> React prop name (`stroke-width` -> `strokeWidth`). */
export function reactSvgAttrName(name: string): string {
  if (name === "class") return "className";
  if (ALREADY_CAMEL.has(name) || !name.includes("-")) return name;
  const [head, ...rest] = name.split("-");
  return `${head}${rest.map((part) => (part ? part[0]!.toUpperCase() + part.slice(1) : "")).join("")}`;
}

/** React-safe attribute object for one element. */
export function reactSvgProps(attrs: Record<string, SvgAttrValue> | undefined): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  if (!attrs) return out;
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === "") continue;
    out[reactSvgAttrName(name)] = value;
  }
  return out;
}
