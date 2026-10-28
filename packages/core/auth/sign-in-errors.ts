import { knownProofs, isSignInProvider, type SignInProvider, type StepUpProof } from "../api/endpoints/sign-in-schemas";
import { maskedEmailOf } from "./sign-in-rules";

/**
 * Every answer of unified sign-in (ADR 0047) as a person reads it: one table
 * from the server's codes — the API's `error.code`, the `?error=` a provider
 * round trip lands /login with, the `?result=` a link from Settings comes
 * back with — to i18n keys and to what the screen does next. Both platforms
 * read their errors through it, so the same refusal says the same thing on
 * the web and on the phone. Pure: it reads a web ApiError or the app's
 * TransportError by their fields and never imports either.
 *
 * An unknown code never throws: it reads as the context's generic sentence.
 */

/** Where the failure happened; a code can mean different things in two places (invalid_credentials). */
export type SignInContext =
  /** A first factor: /auth/login, the app's password, Google and Apple doors. */
  | "sign_in"
  /** The second factor of a sign-in (/auth/mfa/verify, /auth/native/mfa). */
  | "second_factor"
  | "register"
  /** The choice screen's create and link (web or app ticket). */
  | "ticket"
  /** "Tôi được mời bằng email khác": the mailed code and its check. */
  | "claim"
  /** The proof dialog (POST /me/step-up, /me/step-up/email-code). */
  | "step_up"
  /** PUT /me/password. */
  | "password"
  /** Settings › Sign-in methods: link (web start, app native) and unlink. */
  | "methods";

/**
 * What the screen does with it: `field` speaks under the input the person
 * typed and puts focus back there; `wait` counts `retry` down; `step_up`
 * opens the proof dialog on `proofs`; `restart` goes back to sign-in (the
 * pending sign-in is gone); `move` asks to confirm moving the identity off
 * an empty account; `session` signs in again; `form` is a form-level alert.
 */
export type SignInFailureKind = "field" | "wait" | "step_up" | "restart" | "move" | "session" | "form";

/** A phrase to append to a `wait` sentence: `t(key, { count })`; count is absent for "later". */
export interface RetryPhrase {
  key: string;
  count?: number;
}

export interface SignInFailure {
  /** The server's code; "network" when the request never got an answer, "unknown" when nothing named one. */
  code: string;
  status: number | null;
  kind: SignInFailureKind;
  /** The i18n key of the sentence; interpolate `values`. */
  key: string;
  values: { masked?: string };
  /** Seconds the server asked to wait (429), from Retry-After or `fields.retry_after`. */
  retryAfterSeconds: number | null;
  retry: RetryPhrase | null;
  /** proof_required's `fields.proofs`, known proofs only; null for any other failure. */
  proofs: StepUpProof[] | null;
  /** The masked holder a taken or movable identity names (`a•••@icloud.com`). */
  maskedEmail: string | null;
}

const SOCIAL = "auth.social.errors";
const CONTINUE = "auth.continue.errors";
const METHODS = "settings.security.signInMethods";
const STEP_UP = "settings.security.stepUp.errors";

interface Row {
  key: string;
  kind: SignInFailureKind;
  /** The key when the failure carries no masked address. */
  keyUnmasked?: string;
}

const row = (key: string, kind: SignInFailureKind = "form", keyUnmasked?: string): Row => ({ key, kind, keyUnmasked });

const NETWORK = row(`${SOCIAL}.network`);
const SERVER = row(`${SOCIAL}.server`);
const SESSION_ENDED = row(`${SOCIAL}.session_ended`, "session");
const RATE_LIMITED = row(`${SOCIAL}.rate_limited`, "wait");
const PROVIDER_UNAVAILABLE = row(`${SOCIAL}.provider_unavailable`);
const CONFLICT = row(`${SOCIAL}.sign_in_conflict`);
const INVALID_CREDENTIALS = row(`${SOCIAL}.invalid_credentials`, "field");

const BASE: Readonly<Record<string, Row>> = {
  network: NETWORK,
  timeout: NETWORK,
  internal: SERVER,
  server_error: SERVER,
  invalid_credentials: INVALID_CREDENTIALS,
  second_factor_locked: row(`${SOCIAL}.second_factor_locked`, "wait"),
  rate_limited: RATE_LIMITED,
  provider_token_invalid: row(`${SOCIAL}.provider_token_invalid`),
  apple_token_invalid: row(`${SOCIAL}.provider_token_invalid`),
  google_not_configured: PROVIDER_UNAVAILABLE,
  apple_auth_unavailable: PROVIDER_UNAVAILABLE,
  apple_not_configured: PROVIDER_UNAVAILABLE,
  native_sign_in_unavailable: row(`${SOCIAL}.native_unavailable`),
  sign_in_email_unverified: row(`${SOCIAL}.sign_in_unverified`),
  sign_in_account_unverified: row(`${SOCIAL}.sign_in_account_unverified`),
  sign_in_account_conflict: CONFLICT,
  apple_account_conflict: CONFLICT,
  conflict: row(`${SOCIAL}.email_taken`, "field"),
  invalid_token: SESSION_ENDED,
  unauthorized: SESSION_ENDED,
  sign_in_ticket_missing: row(`${CONTINUE}.expired`, "restart"),
  sign_in_ticket_channel: row(`${CONTINUE}.channel`, "restart"),
  invalid_code: row(`${CONTINUE}.invalidCode`, "field"),
  sign_in_method_taken: row(`${METHODS}.errors.taken`, "form", `${METHODS}.errors.takenUnknown`),
  sign_in_method_movable: row(`${METHODS}.errors.movable`, "move", `${METHODS}.errors.movableUnknown`),
  sign_in_method_already_linked: row(`${METHODS}.errors.alreadyLinked`),
  sign_in_method_last: row(`${METHODS}.reasons.last`),
  sign_in_method_relay_email: row(`${METHODS}.reasons.relay`),
  email_unverified: row(`${METHODS}.errors.emailUnverified`),
  session_mismatch: row(`${METHODS}.errors.sessionMismatch`),
  proof_required: row(`${STEP_UP}.proofRequired`, "step_up"),
  password_incorrect: row(`${STEP_UP}.passwordIncorrect`, "field"),
  mfa_code_incorrect: row(`${STEP_UP}.totpIncorrect`, "field"),
  step_up_code_incorrect: row(`${STEP_UP}.emailCodeIncorrect`, "field"),
};

/** Where a code reads differently from BASE. */
const BY_CONTEXT: Readonly<Partial<Record<SignInContext, Readonly<Record<string, Row>>>>> = {
  second_factor: { invalid_credentials: row(`${SOCIAL}.second_factor_invalid`, "field") },
  register: { invalid_request: row(`${SOCIAL}.register_invalid`, "field") },
  ticket: { sign_in_account_conflict: row(`${CONTINUE}.conflict`) },
  claim: {
    invalid_request: row(`${CONTINUE}.invalidEmail`, "field"),
    rate_limited: row(`${CONTINUE}.tooManyCodes`, "wait"),
  },
  step_up: {
    provider_token_invalid: row(`${STEP_UP}.providerInvalid`),
    rate_limited: row(`${STEP_UP}.tooManyCodes`, "wait"),
    second_factor_locked: row(`${STEP_UP}.locked`, "wait"),
  },
  password: {
    invalid_request: row(`${METHODS}.password.tooShort`, "field"),
    password_incorrect: row(`${METHODS}.password.currentIncorrect`, "field"),
  },
  methods: {
    google_not_configured: row(`${METHODS}.errors.notConfigured`),
    apple_not_configured: row(`${METHODS}.errors.notConfigured`),
    apple_auth_unavailable: row(`${METHODS}.errors.notConfigured`),
    provider_token_invalid: row(`${STEP_UP}.providerInvalid`),
  },
};

const GENERIC: Readonly<Record<SignInContext, string>> = {
  sign_in: `${SOCIAL}.generic`,
  second_factor: `${SOCIAL}.generic`,
  register: `${SOCIAL}.generic`,
  ticket: `${CONTINUE}.generic`,
  claim: `${CONTINUE}.generic`,
  step_up: `${STEP_UP}.generic`,
  password: `${METHODS}.errors.generic`,
  methods: `${METHODS}.errors.generic`,
};

/** The contexts a 401 without a code means "your session ended" rather than "wrong credentials". */
const SIGNED_IN: ReadonlySet<SignInContext> = new Set(["step_up", "password", "methods"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/** A phrase for a wait of `seconds`: seconds under a minute and a half, minutes above; "later" when unknown. */
export function retryPhrase(seconds: number | null): RetryPhrase {
  if (seconds === null || !(seconds > 0)) return { key: "auth.social.retry.later" };
  if (seconds < 90) return { key: "auth.social.retry.seconds", count: Math.ceil(seconds) };
  return { key: "auth.social.retry.minutes", count: Math.ceil(seconds / 60) };
}

/** Whole seconds left until `deadlineMs`, never below zero: a countdown's tick. */
export function secondsUntil(deadlineMs: number, now: number): number {
  return Math.max(0, Math.ceil((deadlineMs - now) / 1000));
}

function lookup(code: string, status: number | null, context: SignInContext): Row {
  const known = BY_CONTEXT[context]?.[code] ?? BASE[code];
  if (known) return known;
  if (status === 429) return RATE_LIMITED;
  if (status !== null && status >= 500) return SERVER;
  if (status === 401) return SIGNED_IN.has(context) ? SESSION_ENDED : INVALID_CREDENTIALS;
  return row(GENERIC[context]);
}

/**
 * Read any failure of a sign-in call. `err` is whatever the transport threw:
 * the web's ApiError (code, status, fields, retryAfterSeconds), the app's
 * TransportError (code, status, retryAfterMs), a fetch TypeError (no answer:
 * "network"), or anything else ("unknown", the generic sentence).
 */
export function readSignInFailure(err: unknown, context: SignInContext = "sign_in"): SignInFailure {
  const rec = isRecord(err) ? err : {};
  const fields = isRecord(rec.fields) ? rec.fields : {};
  const status = typeof rec.status === "number" ? rec.status : null;
  let code = typeof rec.code === "string" && rec.code ? rec.code : "";
  if (!code) code = err instanceof TypeError ? "network" : "unknown";
  const msRetry = positive(rec.retryAfterMs);
  const retryAfterSeconds =
    positive(rec.retryAfterSeconds) ?? (msRetry === null ? null : Math.ceil(msRetry / 1000)) ?? positive(fields.retry_after);
  const maskedEmail = maskedEmailOf(fields.masked_email);
  const found = lookup(code, status, context);
  const key = maskedEmail === null && found.keyUnmasked ? found.keyUnmasked : found.key;
  return {
    code,
    status,
    kind: found.kind,
    key,
    values: maskedEmail === null ? {} : { masked: maskedEmail },
    retryAfterSeconds,
    retry: found.kind === "wait" ? retryPhrase(retryAfterSeconds) : null,
    proofs: code === "proof_required" ? knownProofs(fields.proofs) : null,
    maskedEmail,
  };
}

/**
 * The `?error=` a provider round trip sends /login with (spec §3.4). A code
 * this client does not know is ignored (spec §4.2: the page shows nothing
 * rather than a sentence about something else), so the answer is null.
 */
export const LOGIN_REDIRECT_ERRORS = [
  "google_denied",
  "google_failed",
  "google_unverified",
  "apple_denied",
  "apple_failed",
  "sign_in_conflict",
  "sign_in_unverified",
  "sign_in_account_unverified",
  "sign_in_failed",
] as const;
export type LoginRedirectError = (typeof LOGIN_REDIRECT_ERRORS)[number];

export function loginRedirectErrorKey(code: string | null | undefined): string | null {
  return LOGIN_REDIRECT_ERRORS.some((known) => known === code) ? `${SOCIAL}.${code}` : null;
}

/** POST /auth/mfa/verify's `link_skipped`: signed in, but the pending provider was not linked. */
export function linkSkippedKey(code: string | null | undefined, provider?: SignInProvider | null): string | null {
  if (!code) return null;
  return provider ? "auth.social.linkSkipped.withProvider" : "auth.social.linkSkipped.generic";
}

/** The `?result=` a link from Settings comes back with (spec §3.4); anything unknown reads as failed. */
export const LINK_RESULTS = ["linked", "denied", "failed", "taken", "movable", "already_linked", "session_mismatch"] as const;
export type LinkResult = (typeof LINK_RESULTS)[number];

/** The query parameters a link from Settings adds; the page drops them once it has read them. */
export const LINK_RESULT_PARAMS = ["sign_in_method", "result", "masked_email"] as const;

export interface LinkResultNotice {
  provider: SignInProvider;
  result: LinkResult;
  /** linked: a success toast; movable: open the move confirmation; the rest: an error toast. */
  tone: "success" | "confirm" | "error";
  key: string;
  values: { masked?: string };
  maskedEmail: string | null;
}

const RESULT_KEYS: Readonly<Record<LinkResult, string>> = {
  linked: `${METHODS}.results.linked`,
  denied: `${METHODS}.results.denied`,
  failed: `${METHODS}.results.failed`,
  taken: `${METHODS}.results.taken`,
  movable: `${METHODS}.results.movable`,
  already_linked: `${METHODS}.results.already_linked`,
  session_mismatch: `${METHODS}.results.session_mismatch`,
};

/** Read `?sign_in_method=&result=&masked_email=`; null when the page did not come back from a link. */
export function readLinkResult(params: { get(name: string): string | null }): LinkResultNotice | null {
  const provider = params.get("sign_in_method");
  const raw = params.get("result");
  if (!isSignInProvider(provider) || raw === null) return null;
  const result: LinkResult = LINK_RESULTS.find((known) => known === raw) ?? "failed";
  const maskedEmail = maskedEmailOf(params.get("masked_email"));
  const unmasked = (result === "taken" || result === "movable") && maskedEmail === null;
  return {
    provider,
    result,
    tone: result === "linked" ? "success" : result === "movable" ? "confirm" : "error",
    key: unmasked ? `${RESULT_KEYS[result]}Unknown` : RESULT_KEYS[result],
    values: maskedEmail === null ? {} : { masked: maskedEmail },
    maskedEmail,
  };
}
