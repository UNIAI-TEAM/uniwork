import { timingSafeEqual } from "node:crypto";
import type { PendingLoginAttempt } from "./attempt-store";

export type CallbackRejectReason =
  | "no_attempt"
  | "verifier_missing"
  | "expired"
  | "wrong_redirect"
  | "wrong_client"
  | "wrong_deployment"
  | "duplicate_query"
  | "unexpected_query"
  | "missing_code"
  | "missing_state"
  | "wrong_state"
  | "malformed_url";

export type CallbackValidation =
  | Readonly<{ ok: true; code: string; state: string; attemptId: string }>
  | Readonly<{ ok: false; reason: CallbackRejectReason }>;

export type CallbackValidationOptions = Readonly<{
  now?: number;
  expectedClientId?: string;
  expectedDeploymentId?: string;
  logger?: (event: Readonly<{ event: "auth_callback_rejected"; attemptId?: string; reason: CallbackRejectReason }>) => void;
}>;

function reject(reason: CallbackRejectReason, attemptId: string | undefined, logger?: CallbackValidationOptions["logger"]): CallbackValidation {
  logger?.({ event: "auth_callback_rejected", ...(attemptId ? { attemptId } : {}), reason });
  return { ok: false, reason };
}

function equalSecret(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Validate the custom-scheme callback before any exchange call. This function
 * never logs or returns the URL, code, verifier, or state on rejection. */
export function validateCallback(callbackUrl: string, attempt: PendingLoginAttempt | undefined, options: CallbackValidationOptions = {}): CallbackValidation {
  const attemptId = attempt?.attemptId;
  if (!attempt) return reject("no_attempt", attemptId, options.logger);
  if (!attempt.verifier) return reject("verifier_missing", attemptId, options.logger);
  const now = options.now ?? Date.now();
  if (attempt.expiresAt <= now) return reject("expired", attemptId, options.logger);
  if (options.expectedClientId !== undefined && attempt.clientId !== options.expectedClientId) return reject("wrong_client", attemptId, options.logger);
  if (options.expectedDeploymentId !== undefined && attempt.deploymentId !== options.expectedDeploymentId) return reject("wrong_deployment", attemptId, options.logger);
  if (typeof callbackUrl !== "string" || callbackUrl.length === 0) return reject("malformed_url", attemptId, options.logger);

  const queryStart = callbackUrl.indexOf("?");
  const fragmentStart = callbackUrl.indexOf("#");
  if (fragmentStart >= 0 || queryStart < 0 || fragmentStart >= 0 && fragmentStart < queryStart) return reject("wrong_redirect", attemptId, options.logger);
  const base = callbackUrl.slice(0, queryStart);
  if (base !== attempt.redirectUri) return reject("wrong_redirect", attemptId, options.logger);

  let params: URLSearchParams;
  try { params = new URLSearchParams(callbackUrl.slice(queryStart + 1)); } catch { return reject("malformed_url", attemptId, options.logger); }
  const seen = new Set<string>();
  for (const [key] of params) {
    if (seen.has(key)) return reject("duplicate_query", attemptId, options.logger);
    seen.add(key);
    if (key !== "code" && key !== "state") return reject("unexpected_query", attemptId, options.logger);
  }
  const code = params.get("code");
  if (!code) return reject("missing_code", attemptId, options.logger);
  const state = params.get("state");
  if (!state) return reject("missing_state", attemptId, options.logger);
  if (!equalSecret(state, attempt.state)) return reject("wrong_state", attemptId, options.logger);
  return { ok: true, code, state, attemptId: attempt.attemptId };
}

