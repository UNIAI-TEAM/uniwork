// What the doors of the app's own sign-in screen (ADR 0049 §8, spec §3.6) refuse with, as the auth transport
// (transport.ts) keeps it: the server's codes it takes as verdicts, and the few fields of a refusal a screen reads
// (core's auth/sign-in-errors.ts reads them by name). Nothing else of a refusal's body is kept.

/** The doors' own codes; the transport keeps each as the server's verdict (`fromServer`), never inferred by status. */
export const SIGN_IN_VERDICTS = [
  "invalid_credentials",
  "second_factor_locked",
  "provider_token_invalid",
  "native_sign_in_unavailable",
  "google_not_configured",
  "apple_auth_unavailable",
  "conflict",
  "invalid_code",
  "sign_in_ticket_missing",
  "sign_in_ticket_channel",
  "sign_in_account_conflict",
  "sign_in_email_unverified",
  "sign_in_account_unverified",
  "sign_in_method_taken",
  "sign_in_method_already_linked",
  "cross_site_request",
  "unsupported_media_type",
] as const;

export type SignInVerdict =
  | (typeof SIGN_IN_VERDICTS)[number]
  /** never the server's: the second step or the ticket the app held for one is gone (expired, or the app restarted) */
  | "sign_in_expired";

/** The parts of a refusal's `error.fields` a sign-in screen reads, each checked for its type. None is a secret. */
export interface TransportErrorFields {
  /** sign_in_method_taken / _movable: who holds the identity, masked by the server (a•••@icloud.com) */
  readonly masked_email?: string;
  /** proof_required: the proofs the server takes */
  readonly proofs?: readonly string[];
  /** second_factor_locked, a code asked again too soon: whole seconds to wait */
  readonly retry_after?: number;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const positiveSeconds = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;

/** The envelope's `error.fields`, kept only where TransportErrorFields names the key and the type matches. */
export function fieldsOf(raw: unknown): TransportErrorFields {
  if (!isObject(raw)) return {};
  const proofs = Array.isArray(raw.proofs) ? raw.proofs.filter((p): p is string => typeof p === "string") : undefined;
  const retryAfter = positiveSeconds(raw.retry_after);
  return {
    ...(typeof raw.masked_email === "string" && raw.masked_email ? { masked_email: raw.masked_email } : {}),
    ...(proofs ? { proofs } : {}),
    ...(retryAfter ? { retry_after: retryAfter } : {}),
  };
}
