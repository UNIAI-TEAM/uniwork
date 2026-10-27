import type { Document } from "@uniwork/core/types/document";

/**
 * Whether a file document opens in the image viewer, from its stored MIME type
 * (never the filename: a renamed file still reports what the sniffed bytes
 * were). SVG is an image here and is only ever drawn as a plain `<img>`, so its
 * scripts never run. Video is out of scope (UNI-2166, decision B).
 */
export function isImageDocument(doc: Document): boolean {
  return doc.kind === "file" && (doc.file?.mime_type.toLowerCase().startsWith("image/") ?? false);
}
