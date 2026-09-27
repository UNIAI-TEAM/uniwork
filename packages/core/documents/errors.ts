import { ApiError, errorClassOf, errorCode, errorFields } from "../api/http";
import type { DocumentErrorClass } from "../types/document";

// Maps the stable wire codes of C-01 §14.5 onto the client-side classes the
// save machine and the UI branch on — a mirror of errorClassByCode in
// server/internal/handler/dto/sdo/error_class.go. Codes, not statuses, are
// the primary signal: two codes can share a status and mean different
// classes. The last two entries are absent from the server table today; they
// only fire when the server sent no error_class at all, which means the
// client still has to recover alone.
const CODE_TO_CLASS: Record<string, DocumentErrorClass> = {
  revision_conflict: "conflict",
  document_version_conflict: "conflict",
  idempotency_payload_mismatch: "conflict",
  idempotency_key_reuse: "conflict",
  idempotency_in_flight: "conflict",
  upload_already_committed: "conflict",
  copy_consent_required: "conflict",
  owner_requires_copy: "conflict",
  document_upload_invalid: "conflict",
  document_deleted: "gone",
  quota_exceeded: "quota",
  forbidden: "permission",
  member_deactivated: "permission",
  organization_suspended: "permission",
  not_meeting_host: "permission",
  ai_context_forbidden: "permission",
  ai_tool_not_allowed: "permission",
  platform_role_insufficient: "permission",
  not_found: "missing",
  engine_incompatible: "incompatible",
  unauthorized: "session",
  invalid_token: "session",
  invalid_code: "session",
  // Client-only fallbacks for plausible codes the server table omits.
  document_version_unchanged: "conflict",
  file_too_large: "quota",
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
 * Classify a failed documents call. The server's `error.error_class` stamp
 * (lane g1-05e) wins; an absent or unknown stamp falls back to the stable
 * code, then the status. Non-ApiError rejections (network down, abort,
 * transport timeout) are "unknown": the caller keeps the draft and retries
 * rather than escalating to a terminal state.
 */
export function classifyDocumentError(err: unknown): ClassifiedDocumentError {
  if (err instanceof ApiError) {
    // The server's declared class wins; an unknown or absent stamp falls
    // back to the stable code, then the status.
    const declared = errorClassOf(err);
    if (declared) {
      return { cls: declared, code: err.code || null, fields: err.fields };
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
