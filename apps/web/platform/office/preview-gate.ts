// apps/web/platform/office/preview-gate.ts — the final isolation gate for the
// HTML preview copy (G2-06, Advisor decision on g2-06:12).
//
// The engine builds the preview copy with a string scanner and a sweep
// (@uniwork/office-engine/html). Four review rounds showed that any string
// model of HTML parsing can disagree with the browser. This gate removes the
// disagreement: it parses the copy with the browser's own HTML parser
// (DOMParser, scripting disabled - the sandbox default), walks the real tree,
// drops every element that embeds or loads a browsing context (object,
// embed, iframe, frame, portal, ...), <base>, meta refresh, href animations
// and <noscript> (its body parses differently when the frame runs scripts),
// allows each URL attribute only on the elements that carry it and only with
// a value on the scoped asset proxy, serialises, and proves the result stable:
// re-parsing the serialisation must find nothing to drop and must serialise
// to the same bytes. A serialisation that re-parses differently is the
// mutation-XSS shape (namespace confusion around svg/math/style), so an
// unstable result fails closed - the frame gets an empty document instead.

/** Elements dropped whole: they embed or load another browsing context or
 * resource, reset URL resolution, or (noscript) parse differently when the
 * frame runs with scripts on than DOMParser does with scripting off. */
const DROPPED_ELEMENTS: ReadonlySet<string> = new Set([
  "object", "embed", "iframe", "frame", "frameset", "portal", "fencedframe", "applet", "base", "noscript",
]);
const SMIL_ELEMENTS: ReadonlySet<string> = new Set(["set", "animate", "animatemotion", "animatetransform", "discard"]);
const SVG_HREF_ELEMENTS = ["a", "image", "use", "feimage", "textpath", "mpath", "pattern", "lineargradient", "radialgradient", "filter"];

/** Allowlist of (attribute -> elements that may carry it). A URL attribute on
 * any other element is dropped even if its value would pass; attributes with
 * an empty list (form targets, ping, legacy loaders) are always dropped. */
const URL_ATTRIBUTE_ELEMENTS: ReadonlyMap<string, ReadonlySet<string>> = new Map(
  Object.entries({
    href: [...SVG_HREF_ELEMENTS, "area", "link"],
    "xlink:href": SVG_HREF_ELEMENTS,
    src: ["img", "source", "video", "audio", "track", "input", "script"],
    srcset: ["img", "source"],
    imagesrcset: ["link"],
    poster: ["video"],
    background: ["body", "table", "td", "th"],
    data: [],
    action: [],
    formaction: [],
    ping: [],
    codebase: [],
    lowsrc: [],
    dynsrc: [],
    longdesc: [],
    manifest: [],
    archive: [],
  }).map(([name, tags]) => [name, new Set(tags)]),
);
const SRCSET_ATTRIBUTES: ReadonlySet<string> = new Set(["srcset", "imagesrcset"]);
const SRCSET_DESCRIPTOR = /^\d+(?:\.\d+)?[wxh]$/i;

export interface GateOptions {
  /** The checked asset proxy origin (preview.ts checkAssetOrigin). */
  assetOrigin: string;
  /** The inert URL the engine uses for neutralised references. */
  blockedUrl: string;
}

export type GateResult =
  | { ok: true; html: string; removed: number }
  | { ok: false; reason: "unstable_serialisation" | "residual_after_reparse" };

function allowedUrl(value: string, options: GateOptions): boolean {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.startsWith("#") || trimmed === options.blockedUrl) return true;
  if (/^data:(?:image|font)\//i.test(trimmed) && !/[<>]/.test(trimmed)) return true;
  try {
    return new URL(trimmed).origin === options.assetOrigin;
  } catch {
    // Relative URLs resolve against about:srcdoc; the engine never emits them.
    return false;
  }
}

function allowedSrcset(value: string, options: GateOptions): boolean {
  return value
    .split(/[\s,]+/)
    .filter((token) => token !== "" && !SRCSET_DESCRIPTOR.test(token))
    .every((token) => allowedUrl(token, options));
}

function isRefresh(el: Element): boolean {
  const equiv = (el.getAttribute("http-equiv") ?? "").trim().toLowerCase();
  const content = el.getAttribute("content") ?? "";
  return equiv === "refresh" || /url\s*=/i.test(content);
}

/** Every element, including the inert trees inside <template>. */
function allElements(root: ParentNode): Element[] {
  const out: Element[] = [];
  for (const el of Array.from(root.querySelectorAll("*"))) {
    out.push(el);
    if (el instanceof HTMLTemplateElement) out.push(...allElements(el.content));
  }
  return out;
}

// (srcdoc needs no rule: only <iframe> honours it, and iframes are dropped.)
function badAttribute(tag: string, name: string, value: string, options: GateOptions): boolean {
  const tags = URL_ATTRIBUTE_ELEMENTS.get(name);
  if (tags === undefined) return false;
  if (!tags.has(tag)) return true;
  return SRCSET_ATTRIBUTES.has(name) ? !allowedSrcset(value, options) : !allowedUrl(value, options);
}

/** Walk the tree; with `fix`, drop offenders. Returns how many it found. */
function walk(doc: Document, options: GateOptions, fix: boolean): number {
  let found = 0;
  // A descendant of an element removed earlier is still visited; fixing it
  // too is harmless and keeps the count honest for the re-parse check.
  for (const el of allElements(doc)) {
    const tag = el.localName.toLowerCase();
    const smilHref = SMIL_ELEMENTS.has(tag) && /href/i.test(el.getAttribute("attributeName") ?? "");
    if (DROPPED_ELEMENTS.has(tag) || smilHref || (tag === "meta" && isRefresh(el))) {
      found++;
      if (fix) el.remove();
      continue;
    }
    for (const attr of Array.from(el.attributes)) {
      if (!badAttribute(tag, attr.name.toLowerCase(), attr.value, options)) continue;
      found++;
      if (fix) el.removeAttribute(attr.name);
    }
  }
  return found;
}

function serialise(doc: Document): string {
  const doctype = doc.doctype ? "<!DOCTYPE " + doc.doctype.name + ">" : "";
  return doctype + doc.documentElement.outerHTML;
}

export function gatePreviewCopy(copy: string, options: GateOptions): GateResult {
  const parser = new DOMParser();
  const doc = parser.parseFromString(copy, "text/html");
  const removed = walk(doc, options, true);
  const html = serialise(doc);
  const again = parser.parseFromString(html, "text/html");
  if (walk(again, options, false) !== 0) return { ok: false, reason: "residual_after_reparse" };
  if (serialise(again) !== html) return { ok: false, reason: "unstable_serialisation" };
  return { ok: true, html, removed };
}
