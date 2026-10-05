import type { PdfSignatureThumbnail, SavedSignature } from "./types";

/**
 * Builds the thumbnail source for one saved signature. The stored bytes are
 * base64 with no `data:` prefix, and the declared content type comes from the
 * row, so a row that lost either degrades to a glyph instead of a broken
 * `<img>` (the endpoint's schema defaults both to empty strings).
 */
export function savedSignatureThumbnail(signature: SavedSignature): PdfSignatureThumbnail {
  const image = signature.image.trim();
  const contentType = signature.content_type.trim();
  if (image === "" || contentType === "") return { dataUrl: "", missing: true };
  return { dataUrl: `data:${contentType};base64,${image}`, missing: false };
}
