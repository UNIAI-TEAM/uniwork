// The save states and save-error shape the shared save-status chrome reads.
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
