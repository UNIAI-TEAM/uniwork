import { PublicDocumentEnvelopeSchema, type PublicDocument } from "../../types/document";
import { request, requestBlob } from "../http";
import { parseWithFallback } from "../schema";

// Anonymous public-link endpoints (C-01 §5.3 + §14.2; UNI-679, G1-05b). These
// are the only document routes that need no session: the token in the path is
// the credential, and every refusal (unknown, revoked, expired, switch off,
// organization flag off) is the same 404. A page view resolves null on a
// malformed body; the byte routes are blob fetches for a preview/download.

const enc = encodeURIComponent;

/** GET /api/v1/public/documents/{token} — the sanitized page view or the
 *  file's download descriptor. Null means the link cannot be read. */
export async function getPublicDocument(
  token: string,
  signal?: AbortSignal,
): Promise<PublicDocument | null> {
  const raw = await request(`/api/v1/public/documents/${enc(token)}`, { signal });
  return parseWithFallback<{ document: PublicDocument } | null>(raw, PublicDocumentEnvelopeSchema, null, {
    endpoint: "GET /api/v1/public/documents/{token}",
  })?.document ?? null;
}

/** The public download path (no bearer needed) for links, previews and
 *  native elements that cannot attach headers. */
export function publicDocumentDownloadPath(token: string): string {
  return `/api/v1/public/documents/${enc(token)}/download`;
}

/** The public asset path of one page asset behind a link. */
export function publicDocumentAssetPath(token: string, assetId: string): string {
  return `/api/v1/public/documents/${enc(token)}/assets/${enc(assetId)}`;
}

/** GET the bytes of a publicly shared file document. */
export async function downloadPublicDocument(token: string, signal?: AbortSignal): Promise<Blob> {
  return requestBlob(publicDocumentDownloadPath(token), { signal });
}

/** GET the bytes of one asset of a publicly shared page. */
export async function downloadPublicDocumentAsset(
  token: string,
  assetId: string,
  signal?: AbortSignal,
): Promise<Blob> {
  return requestBlob(publicDocumentAssetPath(token, assetId), { signal });
}
