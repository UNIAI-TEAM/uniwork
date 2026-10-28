import { knownProofs, isSignInProvider, type SignInProvider, type StepUpProof } from "../api/endpoints/sign-in-schemas";
import { maskedEmailOf } from "./sign-in-rules";

/**
 * Every answer of unified sign-in (ADR 0047) as a person reads it: one table
 * from the server's codes — the API's `error.code`, the `?error=` a provider
 * round trip lands /login with, the `?result=` a link from Settings comes
 * back with — to i18n keys and to what the screen does next. Both platforms
 * read their errors through it, so the same refusal says the same thing on
 * the web and on the phone. Pure: it reads the web's ApiError, the app's
 * bearer ApiError (the server's envelope kept as `body`) and its auth
 * TransportError by their fields, and never imports any of them.
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
  /**
   * The key of a 429 whose body names no `retry_after`: the route's budget
   * refused (Retry-After only), not the service's mailed-code gate, which
   * always says how long (spec §3.7, §3.9). So a person who typed too many
   * passwords never reads "we sent several codes".
   */
  keyRouteBudget?: string;
}

const row = (key: string, kind: SignInFailureKind = "form", alt: { unmasked?: string; routeBudget?: string } = {}): Row => ({
  key,
  kind,
  keyUnmasked: alt.unmasked,
  keyRouteBudget: alt.routeBudget,
});

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
  // No `unauthorized`: a 401 under that name reads by its context (lookup),
  // since on a sign-in screen it is a wrong credential, not an ended session.
  sign_in_ticket_missing: row(`${CONTINUE}.expired`, "restart"),
  sign_in_ticket_channel: row(`${CONTINUE}.channel`, "restart"),
  invalid_code: row(`${CONTINUE}.invalidCode`, "field"),
  sign_in_method_taken: row(`${METHODS}.errors.taken`, "form", { unmasked: `${METHODS}.errors.takenUnknown` }),
  sign_in_method_movable: row(`${METHODS}.errors.movable`, "move", { unmasked: `${METHODS}.errors.movableUnknown` }),
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

/**
 * Every typed proof a signed-in command weighs (a step-up, the current
 * password of PUT /me/password, an owner's legacy password on a hand-over or
 * a deletion) counts toward the same lockout, so its 429 second_factor_locked
 * reaches accounts without a second factor too: it says "confirming is
 * paused", never "two-factor authentication".
 */
const PROOF_LOCKED = row(`${STEP_UP}.locked`, "wait");

/** Where a code reads differently from BASE. */
const BY_CONTEXT: Readonly<Partial<Record<SignInContext, Readonly<Record<string, Row>>>>> = {
  second_factor: { invalid_credentials: row(`${SOCIAL}.second_factor_invalid`, "field") },
  register: { invalid_request: row(`${SOCIAL}.register_invalid`, "field") },
  ticket: { sign_in_account_conflict: row(`${CONTINUE}.conflict`) },
  claim: {
    invalid_request: row(`${CONTINUE}.invalidEmail`, "field"),
    // The address's day of codes or wrong guesses is spent (or a code just left).
    rate_limited: row(`${CONTINUE}.tooManyCodes`, "wait", { routeBudget: RATE_LIMITED.key }),
  },
  step_up: {
    provider_token_invalid: row(`${STEP_UP}.providerInvalid`),
    // POST /me/step-up/email-code: one a minute, five a day. The step-up
    // budget (ten proofs a minute, every proof route) answers no retry_after.
    rate_limited: row(`${STEP_UP}.tooManyCodes`, "wait", { routeBudget: RATE_LIMITED.key }),
    second_factor_locked: PROOF_LOCKED,
  },
  password: {
    invalid_request: row(`${METHODS}.password.tooShort`, "field"),
    password_incorrect: row(`${METHODS}.password.currentIncorrect`, "field"),
    second_factor_locked: PROOF_LOCKED,
  },
  methods: {
    second_factor_locked: PROOF_LOCKED,
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

/**
 * The contexts where a 401 the tables do not name (unauthorized included)
 * means "your session ended" rather than "wrong credentials".
 */
const SIGNED_IN: ReadonlySet<SignInContext> = new Set(["step_up", "password", "methods"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * A phrase for a wait of `seconds`: seconds under a minute and a half,
 * minutes under an hour and a half, hours above (a day's codes spent waits
 * up to 24 hours); "later" when unknown.
 */
export function retryPhrase(seconds: number | null): RetryPhrase {
  if (seconds === null || !(seconds > 0)) return { key: "auth.social.retry.later" };
  if (seconds < 90) return { key: "auth.social.retry.seconds", count: Math.ceil(seconds) };
  if (seconds < 90 * 60) return { key: "auth.social.retry.minutes", count: Math.ceil(seconds / 60) };
  return { key: "auth.social.retry.hours", count: Math.ceil(seconds / 3600) };
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

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Read any failure of a sign-in call. `err` is whatever the transport threw:
 * - the web's ApiError: `code`, `status`, `fields`, `retryAfterSeconds`;
 * - the app's bearer ApiError (apps/chat-mobile/data/api.ts): `status`,
 *   `retryAfterSeconds` and the server's envelope as `body`, whose
 *   `error.code` and `error.fields` are read when there is no top-level code;
 * - the app's auth TransportError: `code`, `status`, `retryAfterMs`, and
 *   `fromServer` — false when the code was only inferred from the HTTP
 *   status, which then decides as for an unknown code (a 401 on a sign-in
 *   screen is a wrong credential, not an ended session);
 * - a fetch TypeError, or a status of 0 (no HTTP answer: offline, timed
 *   out): "network";
 * - anything else: "unknown", the context's generic sentence.
 */
export function readSignInFailure(err: unknown, context: SignInContext = "sign_in"): SignInFailure {
  const rec = isRecord(err) ? err : {};
  const envelope = isRecord(rec.body) && isRecord(rec.body.error) ? rec.body.error : {};
  const fields = isRecord(rec.fields) ? rec.fields : isRecord(envelope.fields) ? envelope.fields : {};
  const status = typeof rec.status === "number" && rec.status > 0 ? rec.status : null;
  let code = text(rec.code) || text(envelope.code);
  if (!code) code = err instanceof TypeError || rec.status === 0 ? "network" : "unknown";
  // A code the app's transport inferred from the status is no verdict of the server's.
  const verdict = rec.fromServer === false && status !== null ? "" : code;
  const msRetry = positive(rec.retryAfterMs);
  const retryAfterSeconds =
    positive(rec.retryAfterSeconds) ?? (msRetry === null ? null : Math.ceil(msRetry / 1000)) ?? positive(fields.retry_after);
  const maskedEmail = maskedEmailOf(fields.masked_email);
  const found = lookup(verdict, status, context);
  let key = found.key;
  if (maskedEmail === null && found.keyUnmasked) key = found.keyUnmasked;
  else if (positive(fields.retry_after) === null && found.keyRouteBudget) key = found.keyRouteBudget;
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
