import type { EngineErrorClass, EngineErrorCode } from "./error-codes.ts";
import { ENGINE_ERROR_CODES } from "./error-codes.ts";

// Public error body carried inside an error envelope (§4.7). `retryable` is a
// table entry, not a client guess, and `fidelity_preserved` states the failure
// did not damage the current committed version.
export interface EngineErrorBody {
  code: EngineErrorCode;
  status: number;
  error_class: EngineErrorClass;
  kind: string;
  retryable: boolean;
  fidelity_preserved: true;
  [key: string]: unknown;
}

/** Boundary failure. Every failure the boundary raises is a code in
 * ENGINE_ERROR_CODES so a caller asserts on a code, never on a stack trace or
 * on message text. Extra fields ride in `fields` and land in toJSON verbatim -
 * they must already be public-safe (scanForLeaks guards the projection). */
export class EngineBoundaryError extends Error {
  readonly code: EngineErrorCode;
  readonly status: number;
  readonly error_class: EngineErrorClass;
  readonly kind: string;
  readonly retryable: boolean;
  readonly fields: Record<string, unknown>;

  constructor(code: EngineErrorCode, fields: Record<string, unknown> = {}) {
    super(code);
    const spec = ENGINE_ERROR_CODES[code];
    this.name = "EngineBoundaryError";
    this.code = code;
    this.status = spec.status;
    this.error_class = spec.error_class;
    this.kind = spec.kind;
    this.retryable = spec.retryable;
    this.fields = fields;
  }

  toJSON(): EngineErrorBody {
    return {
      code: this.code,
      status: this.status,
      error_class: this.error_class,
      kind: this.kind,
      retryable: this.retryable,
      fidelity_preserved: true,
      ...this.fields,
    };
  }
}

/** Wire validation failure. Distinct from EngineBoundaryError: the caller
 * handed the boundary a request or result that does not satisfy the schema,
 * which is a contract bug, not an engine outcome. Never retryable and carries
 * no boundary code. */
export class EngineContractViolation extends Error {
  readonly field_path: string;
  readonly rule: string;
  readonly detail: string | null;

  constructor(field_path: string, rule: string, detail?: string) {
    super(
      "wire violation at " + field_path + ": " + rule + (detail === undefined ? "" : " (" + detail + ")"),
    );
    this.name = "EngineContractViolation";
    this.field_path = field_path;
    this.rule = rule;
    this.detail = detail === undefined ? null : detail;
  }

  toJSON() {
    return { kind: "contract_violation" as const, field_path: this.field_path, rule: this.rule, detail: this.detail };
  }
}
