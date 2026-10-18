import { ApiError } from "../api/http";
import {
  startChunkedUpload,
  type ChunkedUploadOptions,
  type ChunkedUploadResult,
} from "../documents/chunked-upload";
import { createSafeId } from "../utils";
import { DocsProtocolError } from "./docs-frame-protocol";

// The save legs of docs-frame-api.ts: how one logical save keys itself, when a
// replayed upload earns exactly one retry, and how a chunked upload runs under
// the call's abort signal. Split out so docs-frame-api.ts stays under the
// 500-line module limit (UNI-1907, F1). No behaviour change.

/**
 * One Idempotency-Key per LOGICAL operation: the hash of what the operation
 * is (kind, scope, base revision, the bytes), so a retry after a lost answer
 * replays the first attempt instead of colliding with it as a stale save.
 * Two different edits never share a key, because their bytes or base differ.
 */
export async function operationKey(kind: string, scope: readonly string[], bytes?: ArrayBuffer): Promise<string> {
  const head = new TextEncoder().encode(JSON.stringify([kind, ...scope]));
  const body = new Uint8Array(bytes ?? new ArrayBuffer(0));
  const joined = new Uint8Array(head.length + 1 + body.length);
  joined.set(head);
  joined.set(body, head.length + 1);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", joined));
  return `frame-${kind}-${Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * The refusal a repeated save draws when its staged upload outlived the 24h
 * claim window: 409 document_upload_invalid with reason file_claim_expired
 * (server: documentFileError over files.CodeClaimExpired). Only this exact
 * refusal earns a fresh upload key — anything else propagates.
 */
export function isExpiredUploadClaim(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 409 &&
    error.code === "document_upload_invalid" &&
    error.fields?.["reason"] === "file_claim_expired"
  );
}

/**
 * One save leg = upload under `uploadKey`, then commit under the unchanged
 * commit key. An unchanged save reuses the same derived upload key for days;
 * once the staged file's claim window closed, the upload (or, for a chunked
 * save, the commit that resolves the replayed upload_id) answers
 * file_claim_expired. The FileService rule "an expired session is never
 * resurrected" stands, so the leg runs once more under a fresh upload key —
 * the commit key and fingerprint (document, base revision, checksum, engine)
 * do not depend on the upload id, so the commit replays the stored answer.
 * A second expired answer is an error, never a loop.
 */
export async function retryOnceWithFreshUploadKey<T>(uploadKey: string, leg: (uploadKey: string) => Promise<T>): Promise<T> {
  try {
    return await leg(uploadKey);
  } catch (error) {
    if (!isExpiredUploadClaim(error)) throw error;
    return leg(`${uploadKey}:${createSafeId()}`);
  }
}

export async function runChunkedUpload(opts: ChunkedUploadOptions, signal: AbortSignal): Promise<ChunkedUploadResult> {
  if (signal.aborted) {
    throw new DocsProtocolError({ code: "cancelled", message: "The operation was aborted." });
  }
  const upload = startChunkedUpload(opts);
  let canceling: Promise<void> | null = null;
  const onAbort = () => {
    canceling = upload.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    return await upload.result;
  } finally {
    signal.removeEventListener("abort", onAbort);
    if (canceling) await canceling;
  }
}
