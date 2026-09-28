// Asset reference normalisation for text documents (Markdown, HTML). A text
// document authors its assets as relative references ("assets/my image.png",
// "../shared/logo.svg"); UniWork stores them in a per-document manifest keyed
// by a canonical POSIX path relative to the document package root. This module
// is the ONE place a raw reference becomes a key, so traversal, absolute host
// paths and foreign schemes are refused in one place for resolve, serialise,
// save-as and preview alike.
//
// Upstream (genoffice 09485f88) does the same job against a filesystem:
// decodeLocalSource / resolveSafeRelativeImagePath in
// apps/markdown/src/main/asset-lifecycle.ts:347 and :378. Here there is no
// filesystem: a key is only a name in the manifest, and resolving one never
// touches a host path.

export type RefusalReason =
  | "absolute_path"
  | "traversal"
  | "file_url"
  | "scheme"
  | "control_character"
  | "encoding";

export type AssetReference =
  /** A document-relative asset: `key` is canonical, `suffix` is the ?query/#fragment kept for rewriting. */
  | { kind: "local"; raw: string; key: string; suffix: string }
  /** data: URI - the bytes live in the text itself. */
  | { kind: "inline"; raw: string; media_type: string }
  /** http(s) or protocol-relative URL - never fetched by the engine. */
  | { kind: "external"; raw: string }
  /** "#section" - in-document anchor, not an asset. */
  | { kind: "fragment"; raw: string }
  | { kind: "empty"; raw: string }
  | { kind: "refused"; raw: string; reason: RefusalReason };

// eslint-disable-next-line no-control-regex -- the point is to find control characters
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const DRIVE_RE = /^[a-zA-Z]:/;
const SCHEME_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;

/** Directory part of a canonical document path ("notes/a.md" -> ["notes"]). */
function directorySegments(documentPath: string): string[] {
  const segments = documentPath.split("/").filter((s) => s.length > 0);
  segments.pop();
  return segments;
}

/** True when `documentPath` is itself a canonical relative POSIX path. */
export function isCanonicalDocumentPath(documentPath: string): boolean {
  const ref = normaliseAssetReference(documentPath, "x");
  return ref.kind === "local" && ref.key === documentPath && ref.suffix === "";
}

/**
 * Classify one authored reference relative to the document at `documentPath`
 * (a canonical package-relative path such as "document.md"). Never throws.
 */
export function normaliseAssetReference(raw: string, documentPath: string): AssetReference {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { kind: "empty", raw };
  if (trimmed.startsWith("#")) return { kind: "fragment", raw };
  if (trimmed.startsWith("//")) return { kind: "external", raw };
  // A drive letter also matches the scheme grammar ("c:"); test it first.
  // Leading "/" or "\\" and control characters are refused once, below, on the
  // DECODED path - decoding is the identity for them, so one check covers
  // both the raw and the percent-encoded spelling.
  if (DRIVE_RE.test(trimmed)) return { kind: "refused", raw, reason: "absolute_path" };
  const scheme = SCHEME_RE.exec(trimmed)?.[1]?.toLowerCase();
  if (scheme !== undefined) {
    if (scheme === "http" || scheme === "https") return { kind: "external", raw };
    if (scheme === "file") return { kind: "refused", raw, reason: "file_url" };
    if (scheme === "data") {
      const mediaType = /^data:([^;,]*)/i.exec(trimmed)?.[1]?.toLowerCase() || "text/plain";
      return { kind: "inline", raw, media_type: mediaType };
    }
    return { kind: "refused", raw, reason: "scheme" };
  }

  const cut = trimmed.search(/[?#]/);
  const pathPart = cut === -1 ? trimmed : trimmed.slice(0, cut);
  const suffix = cut === -1 ? "" : trimmed.slice(cut);
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathPart);
  } catch {
    return { kind: "refused", raw, reason: "encoding" };
  }
  // Percent-encoding must not smuggle a control character, a root or a drive.
  if (CONTROL_RE.test(decoded)) return { kind: "refused", raw, reason: "control_character" };
  if (decoded.startsWith("/") || decoded.startsWith("\\") || DRIVE_RE.test(decoded)) {
    return { kind: "refused", raw, reason: "absolute_path" };
  }

  const segments = directorySegments(documentPath);
  for (const part of decoded.replace(/\\/g, "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (segments.length === 0) return { kind: "refused", raw, reason: "traversal" };
      segments.pop();
      continue;
    }
    segments.push(part);
  }
  if (segments.length === 0) return { kind: "refused", raw, reason: "traversal" };
  return { kind: "local", raw, key: segments.join("/"), suffix };
}

/**
 * The reference to author for `key` from the document at `documentPath`:
 * relative, "/"-separated, with only the characters a URL path cannot carry
 * percent-encoded. Spaces stay spaces so Markdown can author them inside
 * angle brackets, the way upstream does.
 */
export function relativeReference(key: string, documentPath: string): string {
  const from = directorySegments(documentPath);
  const to = key.split("/");
  let common = 0;
  while (common < from.length && common < to.length - 1 && from[common] === to[common]) common++;
  const up = from.slice(common).map(() => "..");
  return [...up, ...to.slice(common)]
    .map((part) => (part === ".." ? part : part.replace(/[%?#]/g, (c) => encodeURIComponent(c))))
    .join("/");
}

/** Sanitise a user-supplied file name into one manifest-safe path segment. */
export function sanitizeAssetName(input: string): string {
  const base = input.replace(/\\/g, "/").split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  const rawExt = dot > 0 ? base.slice(dot) : "";
  const ext = /^\.[a-z0-9]{1,10}$/i.test(rawExt) ? rawExt.toLowerCase() : "";
  const stem = (dot > 0 ? base.slice(0, dot) : base)
    .replace(new RegExp(CONTROL_RE.source, "g"), "_")
    .replace(/[/\\:*?"<>|#%]+/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 140 - ext.length)
    .replace(/[. ]+$/g, "");
  return (stem || "asset") + ext;
}
