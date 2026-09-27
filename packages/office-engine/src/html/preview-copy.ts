import { resolveAssetReference, type AssetManifest } from "../assets/manifest";
import { mayRenderAsset, mayRenderInline } from "../assets/media";
import { decodeEntities, isAssetRole, rewriteHtmlUrls, scanHtmlSlots, slotUrls, type SlotUrl } from "./references";

// The PREVIEW COPY of an HTML document: what the isolated iframe renders. It
// is derived from the source on every render and never written back - the
// source a save serialises is untouched by anything here (rewrites, policy,
// theme). Upstream (genoffice 09485f88, buildPreviewDocument,
// apps/html/src/main/preview-document.ts:21) injects a <base> to its asset
// scheme; UniWork has no filesystem scheme, so each local reference is
// pointed at the scoped asset proxy instead, and everything the policy does
// not allow is neutralised in the copy.

/** Where a neutralised URL points: loads nothing, navigates nowhere. */
export const BLOCKED_URL = "about:blank#blocked";

export interface PreviewCopyOptions {
  text: string;
  manifest: AssetManifest;
  /** The scoped proxy URL for a manifest key, or null when not granted. */
  assetUrl(key: string): string | null;
  /** The preview capability lets the document's own scripts run. */
  scripts: boolean;
  /** Content-Security-Policy for the copy (the host builds it). */
  csp: string;
  /** Host theme for UA-rendered chrome (form controls, scrollbars). */
  color_scheme?: "light" | "dark";
  /** Host-owned markup placed right after the policy (the bridge bootstrap). */
  head_injection?: string;
}

function decide(options: PreviewCopyOptions, u: SlotUrl): string | undefined {
  const trimmed = u.url.trim();
  // A kept value must never carry markup: if the scanner misread its context,
  // "<...>" inside it could be live markup for the parser (see sweep below).
  if (/[<>]/.test(u.url)) return u.role === "navigation" || u.role === "base" ? "#" : u.role === "refresh" || u.role === "srcdoc" ? "" : BLOCKED_URL;
  switch (u.role) {
    case "navigation":
      return trimmed.startsWith("#") ? undefined : "#";
    case "base":
      return "#";
    case "refresh":
    case "srcdoc":
      return "";
    default:
      break;
  }
  if (!isAssetRole(u.role)) return BLOCKED_URL;
  const resolved = resolveAssetReference(options.manifest, u.url);
  if (resolved.status === "resolved") {
    if (!mayRenderAsset(resolved.entry.media_type, u.role, { scripts: options.scripts })) return BLOCKED_URL;
    const url = options.assetUrl(resolved.entry.key);
    if (url === null) return BLOCKED_URL;
    // Keep an SVG fragment ("#icon"); a query means nothing to the proxy.
    const hash = resolved.reference.suffix.indexOf("#");
    return url + (hash === -1 ? "" : resolved.reference.suffix.slice(hash));
  }
  if (resolved.status === "not_asset") {
    const ref = resolved.reference;
    if (ref.kind === "fragment" || ref.kind === "empty") return undefined;
    if (ref.kind === "inline" && mayRenderInline(ref.media_type, u.role)) return undefined;
  }
  // dangling, refused, external, disallowed inline.
  return BLOCKED_URL;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/** Offset after a leading doctype (and the comments/whitespace before it), or 0. */
function policyInsertionPoint(html: string): number {
  const m = /^(?:\s|<!--[\s\S]*?-->)*<!doctype[^>]*>/i.exec(html);
  return m ? m[0].length : 0;
}

// Attributes that can make a document load or navigate by themselves.
// attributename covers SVG <set>/<animate attributeName="href">, which can
// point a link anywhere without script; content covers meta refresh.
const SWEEP_RE =
  /(?<=^|[\s"'/])((?:xlink:)?href|src|srcset|poster|data|action|formaction|background|srcdoc|content|attributename)(\s*=\s*)("[^"]*(?:"|$)|'[^']*(?:'|$)|[^\s>]*)/gi;

/**
 * The isolation pass. The slot rewrite above follows a scanner that must
 * guess context (raw text vs markup inside svg/math, comments inside
 * elements it does not model); every guess it got wrong in review was a way
 * to keep a live link (FE reviews r1-r3). This pass guesses nothing: it finds
 * every URL-bearing attribute ANYWHERE in the copy - inside comments, raw
 * text or other attribute values included - and keeps a value only if the
 * slot rewrite itself produced or approved it. Over-matching only rewrites
 * text the parser never treats as an attribute.
 */
function sweep(html: string, approved: ReadonlySet<string>): string {
  return html.replace(SWEEP_RE, (whole, name: string, eq: string, raw: string) => {
    const quote = raw[0] === '"' || raw[0] === "'" ? raw[0] : "";
    const inner = quote ? raw.slice(1, raw.endsWith(quote) && raw.length > 1 ? -1 : undefined) : raw;
    const value = decodeEntities(inner);
    const lower = name.toLowerCase();
    let next: string | undefined;
    if (lower === "attributename") next = /href/i.test(value) ? "data-uw-blocked" : undefined;
    // Any value a refresh could act on: a leading number, or a url=.
    else if (lower === "content") next = /url\s*=/i.test(value) || /^\s*[\d.]/.test(value) ? "" : undefined;
    else if (lower === "srcdoc") next = value === "" ? undefined : "";
    else {
      const trimmed = value.trim();
      const kept = trimmed === "" || (/^#[^<>]*$/.test(trimmed) && !/[<>]/.test(value)) || approved.has(value);
      next = kept ? undefined : BLOCKED_URL;
    }
    if (next === undefined) return whole;
    return name + eq + '"' + next + '"';
  });
}

function neutralise(options: PreviewCopyOptions): string {
  const first = rewriteHtmlUrls(options.text, (u) => decide(options, u));
  const approved = new Set<string>();
  for (const slot of scanHtmlSlots(first)) {
    approved.add(slot.value);
    for (const u of slotUrls(slot)) approved.add(u.url);
  }
  for (const value of approved) if (/[<>]/.test(value)) approved.delete(value);
  return sweep(first, approved);
}

export function buildHtmlPreviewCopy(options: PreviewCopyOptions): string {
  const rewritten = neutralise(options);
  const head =
    '<meta http-equiv="Content-Security-Policy" content="' +
    escapeAttribute(options.csp) +
    '"><meta name="referrer" content="no-referrer">' +
    (options.color_scheme ? '<meta name="color-scheme" content="' + options.color_scheme + '">' : "") +
    (options.head_injection ?? "");
  const at = policyInsertionPoint(rewritten);
  return rewritten.slice(0, at) + head + rewritten.slice(at);
}
