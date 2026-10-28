import { z } from "zod";
import { UserSchema, type User } from "../../types/user";
import { parseWithFallback } from "../schema";

/**
 * The wire shapes of unified sign-in (ADR 0047, spec §3): what the server's
 * SDOs say, read the one way both platforms read them. Pure (zod only), so
 * the phone (apps/chat-mobile, ADR 0011) imports these exact schemas and
 * readers instead of keeping copies: the web's endpoints and the app's
 * factories parse every answer through this file.
 *
 * Lenient like every response schema (server enums are `z.string()`); the
 * exported types narrow them, so every switch over one carries a `default`.
 */

/** The providers a sign-in, a link or a step-up proof can name. */
export const SIGN_IN_PROVIDERS = ["google", "apple"] as const;
export type SignInProvider = (typeof SIGN_IN_PROVIDERS)[number];

export function isSignInProvider(value: unknown): value is SignInProvider {
  return value === "google" || value === "apple";
}

/**
 * The actions a step-up code is mailed for (POST /me/step-up/email-code):
 * a token bought with that code serves only the command of its action.
 */
export const STEP_UP_ACTIONS = [
  "set_password",
  "change_password",
  "link_google",
  "link_apple",
  "unlink_google",
  "unlink_apple",
  "enable_mfa",
  "delete_account",
  "transfer_ownership",
] as const;
export type StepUpAction = (typeof STEP_UP_ACTIONS)[number];

export function isStepUpAction(value: unknown): value is StepUpAction {
  return STEP_UP_ACTIONS.some((action) => action === value);
}

/**
 * The proofs a signed-in person can give (SignInMethodsSDO.proofs): `totp`
 * alone when the second factor is on; otherwise `password` when there is
 * one, `email_code` always, and on the app `apple` / `google` (a fresh token
 * of the linked identity).
 */
export const STEP_UP_PROOFS = ["totp", "password", "email_code", "apple", "google"] as const;
export type StepUpProof = (typeof STEP_UP_PROOFS)[number];

export function isStepUpProof(value: unknown): value is StepUpProof {
  return STEP_UP_PROOFS.some((proof) => proof === value);
}

/** The known proofs of a server list, each once, in the server's order; anything else is dropped. */
export function knownProofs(raw: unknown): StepUpProof[] {
  if (!Array.isArray(raw)) return [];
  const out: StepUpProof[] = [];
  for (const value of raw) if (isStepUpProof(value) && !out.includes(value)) out.push(value);
  return out;
}

// --- GET /auth/providers ---------------------------------------------------

/**
 * Which sign-ins this deployment offers (AuthProvidersSDO, ADR 0047 §10).
 * Flags are only ever added: `google` is the web's Google, `apple` keeps the
 * meaning the shipped iPhone app reads (Sign in with Apple native),
 * `apple_web` is Apple on the web, `google_native` the app's Google SDK. A
 * flag that drifted reads as off on its own, the others still count.
 */
export const AuthProvidersSchema = z.object({
  google: z.boolean().catch(false),
  apple: z.boolean().catch(false),
  apple_web: z.boolean().catch(false),
  google_native: z.boolean().catch(false),
});
export type AuthProviders = z.infer<typeof AuthProvidersSchema>;

export const NO_AUTH_PROVIDERS: AuthProviders = { google: false, apple: false, apple_web: false, google_native: false };

/** Every provider off when the answer is not an object at all. */
export function readAuthProviders(raw: unknown): AuthProviders {
  return parseWithFallback<AuthProviders>(raw, AuthProvidersSchema, NO_AUTH_PROVIDERS, {
    endpoint: "GET /api/v1/auth/providers",
  });
}

// --- The pending provider sign-in (spec §3.2) ------------------------------

/** What the choice screen shows of a provider sign-in that found no account to open. */
export const SignInIdentitySchema = z.object({
  provider: z.string(),
  email: z.string().optional().default(""),
  name: z.string().optional().default(""),
  private_relay: z.boolean().optional().default(false),
});
export interface SignInIdentity {
  provider: SignInProvider;
  /** The provider's address; Apple's relay when `private_relay`. */
  email: string;
  /** Empty when the provider gave none: creating the account then asks for a display name. */
  name: string;
  private_relay: boolean;
}

export type SignInTicketKind = "unmatched" | "link_required";

/** GET /auth/sign-in-ticket (SignInTicketSDO): the browser's pending sign-in. */
export const SignInTicketSchema = SignInIdentitySchema.extend({ kind: z.string() });
export interface SignInTicket extends SignInIdentity {
  /** unmatched: the three choices; link_required: the address has an account, sign in to it to link. */
  kind: SignInTicketKind;
}

/** null when the answer does not parse or names a provider this client cannot show. */
export function readSignInTicket(raw: unknown): SignInTicket | null {
  const parsed = parseWithFallback<SignInTicket | null>(raw, SignInTicketSchema, null, {
    endpoint: "GET /api/v1/auth/sign-in-ticket",
  });
  return parsed && isSignInProvider(parsed.provider) ? parsed : null;
}

// --- NativeSignInSDO (spec §3.6) -------------------------------------------

const NativeSignInEnvelopeSchema = z.object({
  status: z.string(),
  session: z.unknown().optional(),
  reclaimed: z.boolean().optional().default(false),
  link_skipped: z.string().optional().default(""),
  mfa_token: z.string().optional().default(""),
  ticket: z.string().optional().default(""),
  identity: SignInIdentitySchema.optional(),
});

/**
 * The one answer of every door of the app's sign-in screen, as a
 * discriminated result. `session` is the device session exactly as the
 * server sent it (DesktopSessionSDO): the host parses it with its own strict,
 * fail-closed session parser (apps/chat-mobile's parseSession, which also
 * holds the deployment), because tokens are the one answer that must never
 * be smoothed over. The ticket and the challenge stay in memory only.
 */
export type NativeSignInResult =
  | {
      status: "signed_in";
      session: Record<string, unknown>;
      /** The sign-in took the account back from whoever registered the address first: say so once. */
      reclaimed: boolean;
      /** The pending link the second factor carried could not be written; the code says why. */
      link_skipped: string | null;
    }
  | { status: "mfa_required"; mfa_token: string }
  | { status: "identity_unmatched" | "link_required"; ticket: string; identity: SignInIdentity };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read a NativeSignInSDO. null when it cannot be acted on: an unknown status,
 * or a status without the fields it needs (signed_in without a session,
 * mfa_required without a token, a ticket status without the ticket or the
 * identity). The doors open a session, so a null is the caller's failure,
 * never a half sign-in.
 */
export function readNativeSignIn(raw: unknown, endpoint: string): NativeSignInResult | null {
  const env = parseWithFallback<z.infer<typeof NativeSignInEnvelopeSchema> | null>(raw, NativeSignInEnvelopeSchema, null, {
    endpoint,
  });
  if (!env) return null;
  switch (env.status) {
    case "signed_in":
      return isRecord(env.session)
        ? { status: "signed_in", session: env.session, reclaimed: env.reclaimed, link_skipped: env.link_skipped || null }
        : null;
    case "mfa_required":
      return env.mfa_token ? { status: "mfa_required", mfa_token: env.mfa_token } : null;
    case "identity_unmatched":
    case "link_required":
      return env.ticket && env.identity && isSignInProvider(env.identity.provider)
        ? { status: env.status, ticket: env.ticket, identity: { ...env.identity, provider: env.identity.provider } }
        : null;
    default:
      return null;
  }
}

// --- SignInMethodsSDO (spec §3.7) ------------------------------------------

const Linked = z.boolean().optional().default(false);
const DateOrNull = z.string().nullable().optional().default(null);
const EmailOrNull = z.string().nullable().optional().default(null);

const PasswordRowSchema = z.object({ set: Linked, changed_at: DateOrNull });
const ProviderRowSchema = z.object({ linked: Linked, email: EmailOrNull, linked_at: DateOrNull });
const AppleRowSchema = ProviderRowSchema.extend({ private_relay: Linked });

const NO_PASSWORD = { set: false, changed_at: null };
const NOT_LINKED = { linked: false, email: null, linked_at: null };

/**
 * A missing row reads as not set / not linked; a row of the wrong type fails
 * the whole answer, so the screen says it could not load rather than offer
 * "Đặt mật khẩu" on an account that has one.
 */
export const SignInMethodsSchema = z.object({
  password: PasswordRowSchema.optional().default(NO_PASSWORD),
  google: ProviderRowSchema.optional().default(NOT_LINKED),
  apple: AppleRowSchema.optional().default({ ...NOT_LINKED, private_relay: false }),
  account_email_is_relay: Linked,
  proofs: z.array(z.string()).optional().default([]),
});

export interface SignInProviderRow {
  linked: boolean;
  /** The provider's address at linking; null when not linked. */
  email: string | null;
  /** RFC 3339; null when not linked, or linked before the date was kept. */
  linked_at: string | null;
}

/** How an account signs in, and the proofs a sensitive command takes on the calling channel. */
export interface SignInMethods {
  password: { set: boolean; changed_at: string | null };
  google: SignInProviderRow;
  apple: SignInProviderRow & { private_relay: boolean };
  /** The account's own address is Apple's relay: Apple can never be unlinked. */
  account_email_is_relay: boolean;
  /** Known proofs only, in the server's order (knownProofs). */
  proofs: StepUpProof[];
}

export function readSignInMethods(raw: unknown, endpoint: string): SignInMethods | null {
  const parsed = parseWithFallback<z.infer<typeof SignInMethodsSchema> | null>(raw, SignInMethodsSchema, null, { endpoint });
  return parsed ? { ...parsed, proofs: knownProofs(parsed.proofs) } : null;
}

/**
 * A command that changed how the account signs in (SignInMethodsChangeSDO).
 * Each half parses on its own: `user` is null when it does not parse, and
 * the caller then reads /me again, never a fallback user (spec §3.7);
 * `methods` is null when the list does not, and the caller refetches it.
 */
export interface SignInMethodsChange {
  user: User | null;
  methods: SignInMethods | null;
}

const ChangeEnvelopeSchema = z.object({ user: z.unknown(), sign_in_methods: z.unknown() });

export function readSignInMethodsChange(raw: unknown, endpoint: string): SignInMethodsChange {
  const env = parseWithFallback<z.infer<typeof ChangeEnvelopeSchema> | null>(raw, ChangeEnvelopeSchema, null, { endpoint });
  if (!env) return { user: null, methods: null };
  return {
    user: parseWithFallback<User | null>(env.user, UserSchema, null, { endpoint: `${endpoint} › user` }),
    methods: readSignInMethods(env.sign_in_methods, `${endpoint} › sign_in_methods`),
  };
}

// --- StepUpSDO, AuthorizationURLSDO, StatusSDO -----------------------------

export const StepUpGrantSchema = z.object({
  step_up_token: z.string().min(1),
  expires_at: z.string().optional().default(""),
  method: z.string().optional().default(""),
});

/** POST /me/step-up: a ten-minute token bound to the calling session. */
export interface StepUpGrant {
  step_up_token: string;
  /** RFC 3339 on the server's clock; auth/step-up.ts turns it into a local deadline. */
  expires_at: string;
  method: StepUpProof;
}

/** null when no usable token came back: the step-up did not happen as far as the caller can tell. */
export function readStepUpGrant(raw: unknown): StepUpGrant | null {
  return parseWithFallback<StepUpGrant | null>(raw, StepUpGrantSchema, null, { endpoint: "POST /api/v1/me/step-up" });
}

const AuthorizationUrlSchema = z.object({
  authorization_url: z.string().refine((url) => /^https?:\/\/[^/\s]+/i.test(url), "absolute http(s) URL"),
});

/** POST /me/sign-in-methods/{provider}/link: where the browser goes, or null when the answer names nowhere usable. */
export function readAuthorizationUrl(raw: unknown, endpoint: string): string | null {
  return parseWithFallback<{ authorization_url: string } | null>(raw, AuthorizationUrlSchema, null, { endpoint })
    ?.authorization_url ?? null;
}

const StatusSchema = z.object({ status: z.string() });

/** A `{status: "sent"}` answer (a mailed code); anything else, a drifted body included, reads as not sent. */
export function readSent(raw: unknown, endpoint: string): boolean {
  return parseWithFallback<{ status: string }>(raw, StatusSchema, { status: "" }, { endpoint }).status === "sent";
}
