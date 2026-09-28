/**
 * The `asset://` scheme a page embeds with (C-01 §3.7; UNI-680).
 *
 * A page JSON keeps the asset reference and nothing else. Resolution to a URL
 * happens at render time (see document-image-view.tsx), so a presigned URL or
 * a blob URL can never end up inside the document body.
 */

export const DOCUMENT_ASSET_PREFIX = "asset://";

/** The asset id behind an `asset://{id}` src, or null for anything else. */
export function assetIdFromSrc(src: string): string | null {
  return src.startsWith(DOCUMENT_ASSET_PREFIX)
    ? src.slice(DOCUMENT_ASSET_PREFIX.length)
    : null;
}

/** The persisted form of an asset reference: the id, never a URL. */
export function assetSrc(assetId: string): string {
  return `${DOCUMENT_ASSET_PREFIX}${assetId}`;
}
