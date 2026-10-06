export const OFFICE_STATES = [
  "dirty",
  "ready",
  "saving",
  "saved",
  "error",
  "conflict",
  "blocked",
  "readonly",
  "incompatible",
] as const;
export type OfficeState = (typeof OFFICE_STATES)[number];

export type OfficeErrorClass =
  | "conflict"
  | "gone"
  | "quota"
  | "permission"
  | "missing"
  | "incompatible"
  | "session"
  | "grant"
  | "engine"
  | "storage"
  | "unknown";

export interface OfficeErrorDispatch {
  state: OfficeState;
  code: string;
  errorClass: OfficeErrorClass;
  correlationId: string | null;
  retryable: boolean;
  ambiguous: boolean;
  action: "retry" | "reconcile" | "login" | "resolve_conflict" | "keep_draft" | "read_only" | "stop";
  message: string;
}

interface ErrorRule {
  state: OfficeState;
  action: OfficeErrorDispatch["action"];
  retryable: boolean;
  ambiguous?: boolean;
}

const ERROR_RULES: Record<string, ErrorRule> = {
  revision_conflict: { state: "conflict", action: "resolve_conflict", retryable: false },
  document_version_conflict: { state: "conflict", action: "resolve_conflict", retryable: false },
  base_version_mismatch: { state: "conflict", action: "resolve_conflict", retryable: false },
  idempotency_in_flight: { state: "saving", action: "reconcile", retryable: true, ambiguous: true },
  in_flight: { state: "saving", action: "reconcile", retryable: true, ambiguous: true },
  idempotency_payload_mismatch: { state: "error", action: "stop", retryable: false },
  payload_fingerprint_mismatch: { state: "error", action: "stop", retryable: false },
  idempotency_key_reuse: { state: "error", action: "stop", retryable: false },
  document_upload_invalid: { state: "error", action: "reconcile", retryable: false },
  upload_missing: { state: "error", action: "reconcile", retryable: false },
  upload_checksum_mismatch: { state: "error", action: "reconcile", retryable: false },
  quota_exceeded: { state: "blocked", action: "keep_draft", retryable: false },
  upload_bounds: { state: "blocked", action: "keep_draft", retryable: false },
  file_too_large: { state: "blocked", action: "keep_draft", retryable: false },
  unauthorized: { state: "blocked", action: "login", retryable: false },
  token_expired: { state: "blocked", action: "login", retryable: false },
  forbidden: { state: "blocked", action: "keep_draft", retryable: false },
  not_found: { state: "blocked", action: "keep_draft", retryable: false },
  document_deleted: { state: "blocked", action: "keep_draft", retryable: false },
  engine_incompatible: { state: "incompatible", action: "read_only", retryable: false },
  contract_mismatch: { state: "incompatible", action: "read_only", retryable: false },
  protocol_mismatch: { state: "incompatible", action: "read_only", retryable: false },
  unsupported_operation: { state: "incompatible", action: "read_only", retryable: false },
  storage_unavailable: { state: "error", action: "retry", retryable: true },
  engine_timeout: { state: "error", action: "reconcile", retryable: true, ambiguous: true },
  engine_overloaded: { state: "error", action: "retry", retryable: true },
  engine_crashed: { state: "error", action: "retry", retryable: true },
  engine_result_invalid: { state: "error", action: "retry", retryable: true },
  engine_checksum_mismatch: { state: "error", action: "retry", retryable: true },
  draft_recovery_locked: { state: "blocked", action: "keep_draft", retryable: false },
  // The desktop Save As picker closed before any byte was written.
  save_as_cancelled: { state: "error", action: "stop", retryable: false },
  stale_generation: { state: "error", action: "keep_draft", retryable: false },
  // Desktop local-file answers (`desktop:file-*`). The state stays `error` so
  // SaveStatus shows the `office.save.reason.<code>` sentence, and none of these
  // is `stop`: a stop sets terminalGeneration and refuses the same bytes, which
  // would break the "try again" the copy promises. file_changed_on_disk is not a
  // `conflict` (that state is explicit-only and refuses Save As). The remaining
  // file_* codes (access_denied, invalid_path, handle_invalid, engine_unavailable,
  // failed) keep the default stop: the same request cannot succeed.
  file_locked: { state: "error", action: "retry", retryable: true },
  file_write_failed: { state: "error", action: "retry", retryable: true },
  file_replace_failed: { state: "error", action: "retry", retryable: true },
  file_save_in_progress: { state: "error", action: "retry", retryable: true },
  file_changed_on_disk: { state: "error", action: "keep_draft", retryable: false },
  file_not_found: { state: "error", action: "keep_draft", retryable: false },
  file_session_revoked: { state: "error", action: "keep_draft", retryable: false },
  // Pipeline guard codes the coordinator raises itself when the transport
  // answers outside the seam schemas. The commit step is ambiguous: the
  // server may have committed before its answer was lost or garbled.
  malformed_serialized_output: { state: "error", action: "retry", retryable: true },
  malformed_upload_receipt: { state: "error", action: "retry", retryable: true },
  malformed_commit_receipt: { state: "error", action: "reconcile", retryable: true, ambiguous: true },
};

const CLASS_TO_STATE: Record<OfficeErrorClass, OfficeState> = {
  conflict: "conflict",
  gone: "blocked",
  quota: "blocked",
  permission: "blocked",
  missing: "blocked",
  incompatible: "incompatible",
  session: "blocked",
  grant: "blocked",
  engine: "error",
  storage: "error",
  unknown: "error",
};

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readError(error: unknown): { code: string | null; errorClass: string | null; status: number | null; retryable: boolean; correlationId: string | null } {
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    return {
      code: stringValue(record.code) ?? stringValue(record.error_code),
      errorClass: stringValue(record.errorClass ?? record.error_class),
      status: typeof record.status === "number" ? record.status : null,
      retryable: record.retryable === true,
      correlationId: stringValue(record.correlationId ?? record.correlation_id),
    };
  }
  return { code: null, errorClass: null, status: null, retryable: false, correlationId: null };
}

function normalizeClass(value: string | null): OfficeErrorClass {
  if (value && value in CLASS_TO_STATE) return value as OfficeErrorClass;
  return "unknown";
}

export function dispatchOfficeError(error: unknown): OfficeErrorDispatch {
  const parsed = readError(error);
  const cancellation = (error instanceof Error || (typeof DOMException !== "undefined" && error instanceof DOMException)) &&
    error.name === "AbortError";
  const code = parsed.code ?? (cancellation ? "request_aborted" : "office_unknown_error");
  const status = parsed.status;
  // A bodiless 401 defaults its code to "internal" (api/http.ts); the status is
  // the only reliable signal left, and the doc maps it to the auth baseline.
  const rule = ERROR_RULES[code] ?? (status === 401 ? ERROR_RULES.unauthorized : undefined);
  const errorClass = normalizeClass(parsed.errorClass);
  const inferred = rule?.state ?? CLASS_TO_STATE[errorClass];
  const ambiguous = rule?.ambiguous ?? (code === "request_aborted" || code === "network_error" || status === 408 || status === 504);
  return {
    state: inferred,
    code,
    errorClass,
    correlationId: parsed.correlationId,
    retryable: rule?.retryable ?? parsed.retryable,
    ambiguous,
    action: rule?.action ?? (ambiguous ? "reconcile" : "stop"),
    message: "Office save could not be confirmed",
  };
}

/** True when the failure is an answer that nothing was written: a server or
 *  engine refusal the error table knows, or a conflict/blocked/incompatible
 *  outcome. Anything else thrown by a commit step (a receipt or checksum the
 *  host could not match, an unconfirmed write, a failed rebase) may follow a
 *  write that landed. */
export function isOfficeRefusal(dispatch: OfficeErrorDispatch): boolean {
  if (dispatch.ambiguous) return false;
  if (dispatch.state === "conflict" || dispatch.state === "blocked" || dispatch.state === "incompatible" || dispatch.state === "readonly") return true;
  return Object.hasOwn(ERROR_RULES, dispatch.code);
}

export function isOfficeState(value: string): value is OfficeState {
  return (OFFICE_STATES as readonly string[]).includes(value);
}
