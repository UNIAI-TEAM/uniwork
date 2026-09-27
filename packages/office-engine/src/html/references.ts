import type { AssetSlot } from "../assets/media";
import { createForeignContentTracker } from "./foreign-content";

// URL-bearing slots of an HTML source, found without building a DOM so the
// same code runs in a worker, Node and a desktop host. Upstream (genoffice
// 09485f88) scans only <img src> (extractDocumentImageSources,
// apps/html/src/main/asset-lifecycle.ts:851) because its preview reads every
// other neighbour straight from disk through html-asset://
// (apps/html/src/main/preview-protocol.ts:30). UniWork has no disk: a
// stylesheet, font or script the document needs must be found here, or it is
// neither carried by a save nor loadable in the preview.

/** What loading a URL in this slot would do. Non-asset roles are rewritten
 * in the preview copy only (navigation, <base>, meta refresh, srcdoc). */
export type SlotRole = AssetSlot | "navigation" | "base" | "refresh" | "srcdoc";

export interface HtmlSlot {
  /** Range of the raw value in the source (attribute value without quotes, or CSS text). */
  start: number;
  end: number;
  /** '"' / "'" / null for attribute values; "css" for a <style> body (no entity coding). */
  quote: '"' | "'" | null | "css";
  kind: "url" | "srcset" | "css";
  role: SlotRole;
  /** Decoded value. */
  value: string;
}

export interface SlotUrl {
  url: string;
  role: SlotRole;
  /** Range inside `slot.value`. */
  start: number;
  end: number;
  /** CSS only: the token is `url(...)` (true) or an @import string (false). */
  css_function?: boolean;
}

const ASSET_ROLES: ReadonlySet<SlotRole> = new Set<SlotRole>(["image", "style", "font", "script", "media", "frame"]);

export function isAssetRole(role: SlotRole): role is AssetSlot {
  return ASSET_ROLES.has(role);
}

const ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };

function decodeEntities(raw: string): string {
  return raw.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

function encodeAttribute(value: string, quote: '"' | "'" | null): string {
  let out = "";
  for (const ch of value) {
    if (ch === "&") out += "&amp;";
    else if (ch === "<") out += "&lt;";
    else if (quote === '"' && ch === '"') out += "&quot;";
    else if (quote === "'" && ch === "'") out += "&#39;";
    else if (quote === null && /[\s"'`=>]/.test(ch)) out += "&#" + ch.codePointAt(0) + ";";
    else out += ch;
  }
  return out;
}

interface Attr {
  name: string;
  value: string;
  start: number;
  end: number;
  quote: '"' | "'" | null;
}

/** Parse one start tag's attributes from `from` (just after the tag name).
 * `self_closing` is true only when a separator "/" - not the tail of an
 * unquoted value such as `x=1/` - is the last thing before ">", which is
 * exactly when the HTML tokenizer sets the self-closing flag. */
function parseAttributes(html: string, from: number): { attrs: Attr[]; end: number; self_closing: boolean } {
  const attrs: Attr[] = [];
  let i = from;
  const n = html.length;
  let selfClosing = false;
  while (i < n) {
    let slash = false;
    while (i < n && /[\s/]/.test(html[i]!)) {
      slash = html[i] === "/";
      i++;
    }
    if (i >= n || html[i] === ">") {
      selfClosing = slash && i < n;
      break;
    }
    const nameStart = i;
    while (i < n && !/[\s=>/]/.test(html[i]!)) i++;
    const name = html.slice(nameStart, i).toLowerCase();
    while (i < n && /\s/.test(html[i]!)) i++;
    if (html[i] !== "=") {
      attrs.push({ name, value: "", start: i, end: i, quote: null });
      continue;
    }
    i++;
    while (i < n && /\s/.test(html[i]!)) i++;
    const q = html[i];
    if (q === '"' || q === "'") {
      const close = html.indexOf(q, i + 1);
      const end = close === -1 ? n : close;
      attrs.push({ name, value: html.slice(i + 1, end), start: i + 1, end, quote: q });
      i = end + 1;
    } else {
      const valueStart = i;
      while (i < n && !/[\s>]/.test(html[i]!)) i++;
      attrs.push({ name, value: html.slice(valueStart, i), start: valueStart, end: i, quote: null });
    }
  }
  return { attrs, end: Math.min(i + 1, n), self_closing: selfClosing };
}

const LINK_REL_ROLES: Readonly<Record<string, SlotRole>> = {
  stylesheet: "style",
  icon: "image",
  "apple-touch-icon": "image",
  "mask-icon": "image",
};

function linkRole(attrs: readonly Attr[]): SlotRole {
  const rel = (attrs.find((a) => a.name === "rel")?.value ?? "").toLowerCase().split(/\s+/);
  for (const token of rel) {
    const role = LINK_REL_ROLES[token];
    if (role) return role;
  }
  if (rel.some((t) => t === "preload" || t === "prefetch" || t === "modulepreload")) {
    const as = (attrs.find((a) => a.name === "as")?.value ?? "").toLowerCase();
    if (as === "style" || as === "font" || as === "script" || as === "image") return as;
    if (rel.includes("modulepreload")) return "script";
  }
  return "link";
}

/** Role of attribute `attr` on element `tag`, or null when it carries no URL. */
function attributeRole(tag: string, attr: string, attrs: readonly Attr[]): { role: SlotRole; kind: HtmlSlot["kind"] } | null {
  if (attr === "style") return { role: "image", kind: "css" };
  if (attr === "srcdoc" && tag === "iframe") return { role: "srcdoc", kind: "url" };
  if (attr === "srcset" && (tag === "img" || tag === "source")) return { role: "image", kind: "srcset" };
  if (attr === "background") return { role: "image", kind: "url" };
  if (attr === "formaction") return { role: "navigation", kind: "url" };
  switch (tag) {
    case "img":
      return attr === "src" ? { role: "image", kind: "url" } : null;
    case "input":
      return attr === "src" ? { role: "image", kind: "url" } : null;
    case "video":
      if (attr === "poster") return { role: "image", kind: "url" };
      return attr === "src" ? { role: "media", kind: "url" } : null;
    case "audio":
    case "source":
    case "track":
      return attr === "src" ? { role: "media", kind: "url" } : null;
    case "script":
      return attr === "src" ? { role: "script", kind: "url" } : null;
    case "link":
      return attr === "href" ? { role: linkRole(attrs), kind: "url" } : null;
    case "iframe":
    case "frame":
    case "embed":
      return attr === "src" ? { role: "frame", kind: "url" } : null;
    case "object":
      return attr === "data" ? { role: "frame", kind: "url" } : null;
    case "image":
    case "use":
    case "feimage":
      return attr === "href" || attr === "xlink:href" ? { role: "image", kind: "url" } : null;
    case "a":
    case "area":
      return attr === "href" || attr === "xlink:href" ? { role: "navigation", kind: "url" } : null;
    case "form":
      return attr === "action" ? { role: "navigation", kind: "url" } : null;
    case "base":
      return attr === "href" ? { role: "base", kind: "url" } : null;
    case "meta": {
      const refresh = attrs.some((a) => a.name === "http-equiv" && a.value.trim().toLowerCase() === "refresh");
      return refresh && attr === "content" ? { role: "refresh", kind: "url" } : null;
    }
    default:
      return null;
  }
}

const RAW_TEXT_TAGS: ReadonlySet<string> = new Set(["script", "style", "title", "textarea"]);

/** Every URL-bearing slot in document order. Comments, <script> bodies and
 * RCDATA (<title>, <textarea>) are skipped and <style> bodies are CSS slots -
 * in HTML content only; inside svg/math those elements are scanned as markup
 * (foreign-content.ts decides which, FE reviews r1-r3). */
export function scanHtmlSlots(html: string): HtmlSlot[] {
  const slots: HtmlSlot[] = [];
  const foreignContent = createForeignContentTracker();
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) break;
    if (html.startsWith("<!--", lt)) {
      const close = html.indexOf("-->", lt + 4);
      i = close === -1 ? html.length : close + 3;
      continue;
    }
    const endTag = /^<\/([a-zA-Z][a-zA-Z0-9:-]*)/.exec(html.slice(lt, lt + 64));
    if (endTag) {
      foreignContent.endTag(endTag[1]!.toLowerCase());
      const close = html.indexOf(">", lt + 2);
      i = close === -1 ? html.length : close + 1;
      continue;
    }
    const nameMatch = /^<([a-zA-Z][a-zA-Z0-9:-]*)/.exec(html.slice(lt, lt + 64));
    if (!nameMatch) {
      const close = html.indexOf(">", lt + 1);
      i = html[lt + 1] === "!" || html[lt + 1] === "?" || html[lt + 1] === "/" ? (close === -1 ? html.length : close + 1) : lt + 1;
      continue;
    }
    const tag = nameMatch[1]!.toLowerCase();
    const { attrs, end, self_closing: selfClosing } = parseAttributes(html, lt + nameMatch[0].length);
    for (const a of attrs) {
      const role = attributeRole(tag, a.name, attrs);
      if (role) slots.push({ start: a.start, end: a.end, quote: a.quote, kind: role.kind, role: role.role, value: decodeEntities(a.value) });
    }
    i = end;
    // Raw text only when THIS tag is parsed by HTML rules, i.e. the mode
    // before it: an svg <title>/<style> is inserted by foreign rules even
    // when it opens an integration point, and no breakout tag is raw text.
    const foreign = foreignContent.inForeign();
    foreignContent.startTag(tag, attrs, selfClosing);
    if (foreign || !RAW_TEXT_TAGS.has(tag)) continue;
    const closeRe = new RegExp("</" + tag + "\\s*>", "ig");
    closeRe.lastIndex = i;
    const close = closeRe.exec(html);
    const bodyEnd = close ? close.index : html.length;
    if (tag === "style" && bodyEnd > i) {
      slots.push({ start: i, end: bodyEnd, quote: "css", kind: "css", role: "image", value: html.slice(i, bodyEnd) });
    }
    i = close ? close.index + close[0].length : html.length;
  }
  return slots;
}

const CSS_TOKEN_RE =
  /url\(\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^)"'\s]*))\s*\)|@import\s+(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)')/gi;

function cssUrls(css: string): SlotUrl[] {
  const out: SlotUrl[] = [];
  for (const m of css.matchAll(CSS_TOKEN_RE)) {
    const start = m.index;
    const end = start + m[0].length;
    const isImport = m[0][0] === "@";
    const url = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? "").replace(/\\(.)/g, "$1");
    let role: SlotRole = "image";
    if (isImport) role = "style";
    else {
      const face = css.lastIndexOf("@font-face", start);
      if (face !== -1 && !css.slice(face, start).includes("}")) role = "font";
    }
    out.push({ url, role, start, end, css_function: !isImport });
  }
  return out;
}

function srcsetUrls(value: string): SlotUrl[] {
  const out: SlotUrl[] = [];
  for (const m of value.matchAll(/(^|,)\s*([^\s,]+)/g)) {
    const start = m.index + m[0].length - m[2]!.length;
    out.push({ url: m[2]!, role: "image", start, end: start + m[2]!.length });
  }
  return out;
}

/** The URLs a slot carries, with positions inside `slot.value`. */
export function slotUrls(slot: HtmlSlot): SlotUrl[] {
  if (slot.kind === "css") return cssUrls(slot.value);
  if (slot.kind === "srcset") return srcsetUrls(slot.value);
  return [{ url: slot.value, role: slot.role, start: 0, end: slot.value.length }];
}

/** Asset references (the manifest-relevant URLs) in document order. */
export function extractHtmlAssetReferences(html: string): string[] {
  return scanHtmlSlots(html).flatMap((slot) => slotUrls(slot).filter((u) => isAssetRole(u.role)).map((u) => u.url));
}

// Not written inline before a string: scripts/office/check-boundaries.mjs
// scans source text and would read the at-rule as an import specifier.
const CSS_IMPORT = "@import";

function cssString(url: string): string {
  return '"' + url.replace(/["\\\n\r]/g, (c) => "\\" + (c === "\n" ? "a " : c === "\r" ? "d " : c)) + '"';
}

/**
 * Rewrite URLs slot by slot. `decide` returns the replacement for one URL or
 * undefined to keep it. A slot with no replacement keeps its exact source
 * bytes; a changed slot is re-encoded for its quoting context.
 */
export function rewriteHtmlUrls(html: string, decide: (url: SlotUrl, slot: HtmlSlot) => string | undefined): string {
  let out = "";
  let cursor = 0;
  for (const slot of scanHtmlSlots(html)) {
    let value = slot.value;
    let changed = false;
    for (const u of slotUrls(slot).reverse()) {
      const next = decide(u, slot);
      if (next === undefined || next === u.url) continue;
      const token = slot.kind !== "css" ? next : u.css_function ? "url(" + cssString(next) + ")" : CSS_IMPORT + " " + cssString(next);
      value = value.slice(0, u.start) + token + value.slice(u.end);
      changed = true;
    }
    if (!changed) continue;
    out += html.slice(cursor, slot.start) + (slot.quote === "css" ? value : encodeAttribute(value, slot.quote));
    cursor = slot.end;
  }
  return cursor === 0 ? html : out + html.slice(cursor);
}

/** Save-as rewrite: replace exact asset references by the rebase plan. */
export function rewriteHtmlAssetReferences(html: string, rewrites: ReadonlyMap<string, string>): string {
  if (rewrites.size === 0) return html;
  return rewriteHtmlUrls(html, (u) => (isAssetRole(u.role) ? rewrites.get(u.url) : undefined));
}
