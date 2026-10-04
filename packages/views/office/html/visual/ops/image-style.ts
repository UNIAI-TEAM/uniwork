import { parseStartTagAttributes, type HtmlAttribute } from "./match";

// Image presentation helpers for the visual editor. genoffice's image-style
// module (pinned 09485f88) turns a fit + alignment choice into the inline
// style an <img> carries; UniWork keeps that behaviour and none of its UI.
// Pure string work over the source so a caller can preview a value before it
// becomes a patch.

/** How an image fills its box. */
export type ImageFit = "contain" | "cover" | "fill" | "none" | "scale-down";
/** Horizontal placement of an image in its container. */
export type ImageAlign = "left" | "center" | "right";
export type ImageSizeUnit = "px" | "%";

export interface ImageStyle {
  width?: number;
  widthUnit?: ImageSizeUnit;
  height?: number;
  heightUnit?: ImageSizeUnit;
  fit?: ImageFit;
  align?: ImageAlign;
  /** Locks height to the width when only one dimension is given. */
  aspectLock?: boolean;
}

export interface ImageStyleInput extends ImageStyle {
  /** Natural ratio (width / height) used to fill the locked dimension. */
  aspectRatio?: number;
}

const FIT_VALUES: ReadonlySet<string> = new Set(["contain", "cover", "fill", "none", "scale-down"]);
const ALIGN_VALUES: ReadonlySet<string> = new Set(["left", "center", "right"]);

function dimension(value: number, unit: ImageSizeUnit): string {
  return unit === "%" ? value + "%" : value + "px";
}

/**
 * The CSS declarations an image style produces, in a stable order. Only the
 * declared fields appear, so merging with the existing style keeps the rest of
 * the author's CSS untouched (byte-identity outside the edited range).
 */
export function imageStyleDeclarations(input: ImageStyleInput): string[] {
  const out: string[] = [];
  if (typeof input.width === "number") out.push("width:" + dimension(input.width, input.widthUnit ?? "px"));
  if (typeof input.height === "number") out.push("height:" + dimension(input.height, input.heightUnit ?? "px"));
  if (input.aspectLock && typeof input.width === "number" && typeof input.aspectRatio === "number" && input.aspectRatio > 0) {
    out.push("height:" + dimension(Math.round(input.width / input.aspectRatio), input.widthUnit ?? "px"));
  }
  if (input.fit) out.push("object-fit:" + input.fit);
  if (input.align === "center") out.push("display:block", "margin-left:auto", "margin-right:auto");
  else if (input.align === "left") out.push("display:block", "margin-right:auto");
  else if (input.align === "right") out.push("display:block", "margin-left:auto");
  return out;
}

export function imageStyleValue(input: ImageStyleInput): string {
  return imageStyleDeclarations(input).join(";");
}

function splitDeclarations(css: string): string[] {
  return css
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

/**
 * Merge new declarations into an existing inline style, replacing only the
 * properties the new style sets and keeping the author's other declarations
 * (and their order) exactly. Declarations the caller wants gone are removed by
 * name. A property with an empty value is dropped.
 */
export function mergeImageStyle(existing: string, declarations: readonly string[], drop: readonly string[] = []): string {
  const dropped = new Set(drop.map((name) => name.trim().toLowerCase()));
  const incoming = new Map<string, string>();
  for (const declaration of declarations) {
    const at = declaration.indexOf(":");
    if (at === -1) continue;
    incoming.set(declaration.slice(0, at).trim().toLowerCase(), declaration);
  }
  const out: string[] = [];
  for (const part of splitDeclarations(existing)) {
    const at = part.indexOf(":");
    const name = at === -1 ? part.toLowerCase() : part.slice(0, at).trim().toLowerCase();
    if (dropped.has(name) || incoming.has(name)) continue;
    out.push(part);
  }
  for (const [name, declaration] of incoming) {
    if (dropped.has(name)) continue;
    out.push(declaration);
  }
  return out.join(";");
}

/** The current image style of an <img> start tag, decoded from its style attr. */
export function readImageStyle(startTag: string): ImageStyle {
  const attrs: HtmlAttribute[] = parseStartTagAttributes(startTag, [0, startTag.length]);
  const style = attrs.find((attr) => attr.name === "style")?.value ?? "";
  const style2: ImageStyle = {};
  // `margin-left:auto` / `margin-right:auto` are tracked independently because
  // `display:block;margin-left:auto` is this module's RIGHT-aligned form while
  // `margin-right:auto` alone is the LEFT-aligned form; both together centre.
  let marginLeftAuto = false;
  let marginRightAuto = false;
  for (const declaration of splitDeclarations(style)) {
    const at = declaration.indexOf(":");
    if (at === -1) continue;
    const name = declaration.slice(0, at).trim().toLowerCase();
    const value = declaration.slice(at + 1).trim();
    if (name === "width" || name === "height") {
      const parsed = /^(\d+(?:\.\d+)?)(px|%)?$/.exec(value);
      if (parsed) {
        const number = Number(parsed[1]);
        if (name === "width") {
          style2.width = number;
          style2.widthUnit = parsed[2] === "%" ? "%" : "px";
        } else {
          style2.height = number;
          style2.heightUnit = parsed[2] === "%" ? "%" : "px";
        }
      }
    } else if (name === "object-fit" && FIT_VALUES.has(value)) {
      style2.fit = value as ImageFit;
    } else if (name === "margin-left" && value === "auto") {
      marginLeftAuto = true;
    } else if (name === "margin-right" && value === "auto") {
      marginRightAuto = true;
    }
  }
  if (marginLeftAuto && marginRightAuto) style2.align = "center";
  else if (marginRightAuto) style2.align = "left";
  else if (marginLeftAuto) style2.align = "right";
  return style2;
}

export function isImageFit(value: string): value is ImageFit {
  return FIT_VALUES.has(value);
}

export function isImageAlign(value: string): value is ImageAlign {
  return ALIGN_VALUES.has(value);
}
