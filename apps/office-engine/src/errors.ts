// HTTP failure shapes. A boundary failure is always a code from the contract
// table (ENGINE_ERROR_CODES) inside the §4.7 error envelope; two failures sit
// outside that table on purpose: a request that does not carry the service
// credential is not an engine outcome (service_unauthenticated), and a request
// that breaks the wire schema is a caller bug (contract_violation).

import {
  EngineBoundaryError,
  EngineContractViolation,
  type EngineErrorCode,
  type EngineOperation,
} from "@uniwork/office-contracts";

export interface HttpFailure {
  status: number;
  body: Record<string, unknown>;
}

export function boundaryFailure(
  code: EngineErrorCode,
  fields: Record<string, unknown> = {},
  context: { requestId?: string; operation?: EngineOperation; jobId?: string } = {},
): HttpFailure {
  const error = new EngineBoundaryError(code, fields);
  return {
    status: error.status,
    body: {
      ...(context.requestId ? { request_id: context.requestId } : {}),
      ...(context.jobId ? { job_id: context.jobId } : {}),
      state: "failed",
      ...(context.operation ? { operation: context.operation } : {}),
      error: error.toJSON(),
    },
  };
}

export function unauthenticated(): HttpFailure {
  return { status: 401, body: { error: { code: "service_unauthenticated" } } };
}

function contractViolation(violation: EngineContractViolation): HttpFailure {
  return { status: 400, body: { error: { code: "contract_violation", ...violation.toJSON() } } };
}

export function notFoundRoute(): HttpFailure {
  return { status: 404, body: { error: { code: "route_not_found" } } };
}

/** Map anything a request handler throws to an HTTP failure. Unknown errors
 * are reported as engine_crashed without their message: a stack trace or a
 * host path must never cross the boundary. */
export function toFailure(error: unknown, context: { requestId?: string; operation?: EngineOperation } = {}): HttpFailure {
  if (error instanceof EngineContractViolation) return contractViolation(error);
  if (error instanceof EngineBoundaryError) return boundaryFailure(error.code, error.fields, context);
  return boundaryFailure("engine_crashed", { reason: "internal_error" }, context);
}
