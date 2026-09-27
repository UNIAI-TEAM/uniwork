// Media typing and the two asset policies, kept apart on purpose (plan G2-06):
//
//   * PRESERVATION: every byte a document references is kept in the manifest
//     and re-published on save - SVG, fonts, scripts, unknown binaries alike.
//     Nothing is dropped from the output because it would be unsafe to render.
//   * RENDER: whether the isolated preview may load an asset in a given slot.
//     This only ever decides what the PREVIEW COPY points at.
//
// Upstream (genoffice 09485f88) merges the two: PREVIEW_ASSET_EXTS in
// apps/html/src/main/asset-mime.ts:7 is both the serve allowlist and, by
// omission, the reason other neighbours never travel with the document.

const EXTENSION_TYPES: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
  svg: "image/svg+xml",
  css: "text/css",
  js: "text/javascript",
  mjs: "text/javascript",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
};

const UNKNOWN = "application/octet-stream";

function startsWith(head: Uint8Array, bytes: readonly number[], offset = 0): boolean {
  if (head.length < offset + bytes.length) return false;
  return bytes.every((b, i) => head[offset + i] === b);
}

/** Binary signature sniff for the raster formats a preview renders. */
function sniff(head: Uint8Array): string | null {
  if (startsWith(head, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(head, [0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (startsWith(head, [0x52, 0x49, 0x46, 0x46]) && startsWith(head, [0x57, 0x45, 0x42, 0x50], 8)) {
    return "image/webp";
  }
  return null;
}

/**
 * The media type recorded for an asset. A binary signature wins over the
 * extension (a ".png" that is really a JPEG is still an image), but a
 * signature never promotes bytes to a script or stylesheet type - those come
 * from the extension only, and anything unrecognised stays octet-stream.
 */
export function mediaTypeFor(key: string, bytes: Uint8Array): string {
  const sniffed = sniff(bytes.subarray(0, 16));
  if (sniffed) return sniffed;
  const ext = key.slice(key.lastIndexOf(".") + 1).toLowerCase();
  return EXTENSION_TYPES[ext] ?? UNKNOWN;
}

/** Where a reference sits in the document, which decides how it would load. */
export type AssetSlot = "image" | "style" | "font" | "script" | "media" | "frame" | "link";

export interface RenderPolicyOptions {
  /** The preview capability allows the document's own scripts to run. */
  scripts: boolean;
}

/**
 * RENDER policy. SVG is allowed only where browsers treat it as an image
 * (no script runs in an <img>); as a frame/object it is blocked. Unknown
 * bytes never render. Scripts render only when the capability asks.
 */
export function mayRenderAsset(mediaType: string, slot: AssetSlot, options: RenderPolicyOptions): boolean {
  const type = mediaType.toLowerCase();
  switch (slot) {
    case "image":
      return type.startsWith("image/");
    case "style":
      return type === "text/css";
    case "font":
      return type.startsWith("font/");
    case "media":
      return type.startsWith("video/") || type.startsWith("audio/");
    case "script":
      return options.scripts && type === "text/javascript";
    case "frame":
    case "link":
    default:
      return false;
  }
}

/** RENDER policy for data: URIs, which carry their own bytes in the text. */
export function mayRenderInline(mediaType: string, slot: AssetSlot): boolean {
  const type = mediaType.toLowerCase();
  if (slot === "image") return type.startsWith("image/");
  if (slot === "font") return type.startsWith("font/") || type === "application/font-woff";
  return false;
}
