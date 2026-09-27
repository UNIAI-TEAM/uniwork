import { resolveAssetReference, type AssetManifest } from "../assets/manifest";
import { mayRenderAsset, mayRenderInline } from "../assets/media";
import { isAssetRole, rewriteHtmlUrls, type SlotUrl } from "./references";

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

export function buildHtmlPreviewCopy(options: PreviewCopyOptions): string {
  const rewritten = rewriteHtmlUrls(options.text, (u) => decide(options, u));
  const head =
    '<meta http-equiv="Content-Security-Policy" content="' +
    escapeAttribute(options.csp) +
    '"><meta name="referrer" content="no-referrer">' +
    (options.color_scheme ? '<meta name="color-scheme" content="' + options.color_scheme + '">' : "") +
    (options.head_injection ?? "");
  const at = policyInsertionPoint(rewritten);
  return rewritten.slice(0, at) + head + rewritten.slice(at);
}
