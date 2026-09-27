import { ApiError, errorCode, errorFields } from "../api/http";
import {
  DOCUMENT_ERROR_CLASSES,
  type DocumentErrorClass,
} from "../types/document";

// Maps the stable wire codes of C-01 §14.5 onto the client-side classes the
// save machine and the UI branch on. Codes, not statuses, are the primary
// signal: two codes can share a status and mean different classes.
const CODE_TO_CLASS: Record<string, DocumentErrorClass> = {
  revision_conflict: "conflict",
  document_version_conflict: "conflict",
  document_version_unchanged: "conflict",
  idempotency_payload_mismatch: "conflict",
  idempotency_key_reuse: "conflict",
  idempotency_in_flight: "conflict",
  upload_already_committed: "conflict",
  copy_consent_required: "conflict",
  owner_requires_copy: "conflict",
  engine_incompatible: "incompatible",
  quota_exceeded: "quota",
  file_too_large: "quota",
  document_deleted: "gone",
  forbidden: "permission",
  member_deactivated: "permission",
  not_found: "missing",
  unauthorized: "session",
};

function statusToClass(status: number): DocumentErrorClass | null {
  switch (status) {
    case 401:
      return "session";
    case 403:
      return "permission";
    case 404:
      return "missing";
    case 409:
    case 422:
      return "conflict";
    case 410:
      return "gone";
    default:
      return null;
  }
}

export interface ClassifiedDocumentError {
  /** A declared class, or "unknown" for network failures, timeouts and
   *  anything the classifier cannot place. */
  cls: DocumentErrorClass | "unknown";
  code: string | null;
  fields: Record<string, unknown> | undefined;
}

/**
 * Classify a failed documents call. When the server starts sending
 * `error.error_class` on the envelope (lane g1-05e), that declared class wins;
 * until then the stable code — then the status — decides. Non-ApiError
 * rejections (network down, abort, transport timeout) are "unknown": the
 * caller keeps the draft and retries rather than escalating to a terminal
 * state.
 */
export function classifyDocumentError(err: unknown): ClassifiedDocumentError {
  if (err instanceof ApiError) {
    // g1-05e lands `errorClass` on ApiError; accept it when a known class.
    const declared = (err as ApiError & { errorClass?: unknown }).errorClass;
    if (typeof declared === "string" && (DOCUMENT_ERROR_CLASSES as readonly string[]).includes(declared)) {
      return { cls: declared as DocumentErrorClass, code: err.code || null, fields: err.fields };
    }
    const code = errorCode(err);
    if (code && CODE_TO_CLASS[code]) {
      return { cls: CODE_TO_CLASS[code], code, fields: errorFields(err) };
    }
    const byStatus = statusToClass(err.status);
    if (byStatus) return { cls: byStatus, code: code ?? null, fields: errorFields(err) };
    return { cls: "unknown", code: code ?? null, fields: errorFields(err) };
  }
  return { cls: "unknown", code: null, fields: undefined };
}

/** The conflict classes after which a save must stop and ask, never retry on
 *  a silently newer base (plan G1-05 save-state contract). */
export function isConflictClass(cls: DocumentErrorClass | "unknown"): boolean {
  return cls === "conflict";
}
