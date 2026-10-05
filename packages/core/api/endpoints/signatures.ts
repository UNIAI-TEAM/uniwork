import { z } from "zod";
import {
  SavedSignatureEnvelopeSchema,
  SavedSignatureListEnvelopeSchema,
  type SavedSignature,
} from "../../types/signature";
import { request } from "../http";
import { parseWithFallback } from "../schema";

// Saved signatures (UNI-925 B6): the caller's own reusable signature images,
// scoped to one organization. The PDF editor consumes these; bytes come back
// base64 in every list row so the picker draws a thumbnail without a second
// request.

const enc = encodeURIComponent;

const StatusResponse = z.object({ status: z.string() });

export interface SavedSignatureInput {
  /** Human label shown in the picker. */
  label: string;
  /** `image/png` or `image/jpeg`. */
  contentType: string;
  /** Image bytes base64-encoded, without the `data:` prefix. */
  image: string;
}

/** GET /api/v1/orgs/{orgId}/signatures — the caller's own signatures, newest
 *  first. A non-member sees 404; a malformed body degrades to []. */
export async function listSavedSignatures(orgId: string, signal?: AbortSignal): Promise<SavedSignature[]> {
  const raw = await request(`/api/v1/orgs/${enc(orgId)}/signatures`, { signal });
  return parseWithFallback<{ signatures: SavedSignature[] }>(raw, SavedSignatureListEnvelopeSchema, {
    signatures: [],
  }, {
    endpoint: "GET /api/v1/orgs/{orgId}/signatures",
  }).signatures;
}

/** POST /api/v1/orgs/{orgId}/signatures — 201 with the stored row; null when
 *  the answer is unusable, so a caller never reads a failed save as success. */
export async function createSavedSignature(
  orgId: string,
  input: SavedSignatureInput,
): Promise<SavedSignature | null> {
  const raw = await request(`/api/v1/orgs/${enc(orgId)}/signatures`, {
    method: "POST",
    body: { label: input.label, content_type: input.contentType, image: input.image },
  });
  return parseWithFallback<{ signature: SavedSignature } | null>(raw, SavedSignatureEnvelopeSchema, null, {
    endpoint: "POST /api/v1/orgs/{orgId}/signatures",
  })?.signature ?? null;
}

/** DELETE /api/v1/orgs/{orgId}/signatures/{signatureId} — returns whether the
 *  {status:"ok"} envelope was proven, so a malformed answer never reads as a
 *  completed delete. */
export async function deleteSavedSignature(orgId: string, signatureId: string): Promise<boolean> {
  const raw = await request(`/api/v1/orgs/${enc(orgId)}/signatures/${enc(signatureId)}`, { method: "DELETE" });
  return parseWithFallback<{ status: string }>(raw, StatusResponse, { status: "" }, {
    endpoint: "DELETE /api/v1/orgs/{orgId}/signatures/{signatureId}",
  }).status === "ok";
}
