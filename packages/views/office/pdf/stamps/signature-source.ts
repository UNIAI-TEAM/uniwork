import type { SavedSignature } from "@uniwork/core/types/signature";
import type { PdfStampSignatureSource } from "./types";

/**
 * Maps a saved-signature row onto the palette's placement source. The two
 * shapes differ only in `content_type` → `contentType`, and the mapping lives
 * here rather than at each host call site so the field name cannot drift
 * silently between the picker and the palette.
 */
export function toStampSignatureSource(signature: SavedSignature): PdfStampSignatureSource {
  return {
    id: signature.id,
    label: signature.label,
    contentType: signature.content_type,
    image: signature.image,
  };
}
