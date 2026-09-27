// apps/web/platform/office/preview-gate.ts — the final isolation gate for the
// HTML preview copy (G2-06, Advisor decision on g2-06:12).
//
// The engine builds the preview copy with a string scanner and a sweep
// (@uniwork/office-engine/html). Four review rounds showed that any string
// model of HTML parsing can disagree with the browser. This gate removes the
// disagreement: it parses the copy with the browser's own HTML parser
// (DOMParser, scripting disabled - the sandbox default), walks the real tree,
// drops every attribute or element that would load or navigate anywhere but
// the scoped asset proxy, serialises, and then proves the result is stable:
// re-parsing the serialisation must find nothing to drop and must serialise
// to the same bytes. A serialisation that re-parses differently is the
// mutation-XSS shape (namespace confusion around svg/math/style), so an
// unstable result fails closed - the frame gets an empty document instead.

/** Attributes whose value is fetched or navigated to. */
const URL_ATTRIBUTES: ReadonlySet<string> = new Set([
  "href", "xlink:href", "src", "srcset", "imagesrcset", "poster", "data", "action", "formaction",
  "background", "ping", "codebase", "lowsrc", "dynsrc", "longdesc", "manifest", "archive",
]);
const SRCSET_ATTRIBUTES: ReadonlySet<string> = new Set(["srcset", "imagesrcset"]);
const SMIL_ELEMENTS: ReadonlySet<string> = new Set(["set", "animate", "animatemotion", "animatetransform", "discard"]);
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

/** Walk the tree; with `fix`, drop offenders. Returns how many it found. */
function walk(doc: Document, options: GateOptions, fix: boolean): number {
  let found = 0;
  // A descendant of an element removed earlier is still visited; fixing it
  // too is harmless and keeps the count honest for the re-parse check.
  for (const el of allElements(doc)) {
    const tag = el.localName.toLowerCase();
    const smilHref = SMIL_ELEMENTS.has(tag) && /href/i.test(el.getAttribute("attributeName") ?? "");
    if (tag === "base" || smilHref || (tag === "meta" && isRefresh(el))) {
      found++;
      if (fix) el.remove();
      continue;
    }
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      let bad = false;
      if (name === "srcdoc") bad = attr.value !== "";
      else if (SRCSET_ATTRIBUTES.has(name)) bad = !allowedSrcset(attr.value, options);
      else if (URL_ATTRIBUTES.has(name)) bad = !allowedUrl(attr.value, options);
      if (!bad) continue;
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
