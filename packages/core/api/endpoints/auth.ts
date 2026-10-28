import { z } from "zod";
import {
  MFAChallengeSchema,
  SessionResponseSchema,
  UserSchema,
  UserSessionSchema,
  type MFAChallenge,
  type SessionResponse,
  type User,
  type UserSession,
} from "../../types/user";
import { request } from "../http";
import { parseWithFallback } from "../schema";
import { setAccessToken } from "../session";
import { readAuthProviders, type AuthProviders, type SignInProvider } from "./sign-in-schemas";

export { refreshSession } from "../http";

const DesktopStartSchema = z.object({
  authorization_url: z.string(),
  attempt_expires_at: z.string(),
});
export type DesktopStart = z.infer<typeof DesktopStartSchema>;

const DesktopConsentSchema = z.object({
  status: z.string().optional(),
  attempt_id: z.string(),
  account_id: z.string(),
  account_name: z.string().optional(),
  account_email: z.string().email().or(z.literal("")).optional(),
  client_id: z.string(),
  deployment_id: z.string(),
  redirect_uri: z.string(),
  device_label: z.string(),
  platform: z.string(),
  build: z.string(),
  csrf_token: z.string(),
});
export type DesktopConsent = z.infer<typeof DesktopConsentSchema>;

const DesktopConsentResultSchema = z.object({
  status: z.string(),
  callback_url: z.string().optional(),
});
export type DesktopConsentResult = z.infer<typeof DesktopConsentResultSchema>;

/**
 * Starts a PKCE attempt; the server returns an opaque browser authorization
 * URL. `provider` is the app's Google or Apple button (spec §3.5): the URL
 * carries it so the web sends a signed-out person straight to that
 * provider. It picks the first screen and grants nothing.
 */
export async function desktopStart(params: {
  client_id: string;
  code_challenge: string;
  code_challenge_method: "S256";
  state: string;
  redirect_uri: string;
  deployment_id: string;
  device_label?: string;
  platform?: string;
  build?: string;
  provider?: SignInProvider;
}): Promise<DesktopStart | null> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, value);
  }
  const raw = await request(`/api/v1/auth/desktop/start?${query.toString()}`, { skipRefresh: true });
  return parseWithFallback<DesktopStart | null>(raw, DesktopStartSchema, null, {
    endpoint: "GET /api/v1/auth/desktop/start",
  });
}

/** Reads the authenticated, non-approving consent details for a pending attempt. */
export async function desktopConsent(attemptId: string): Promise<DesktopConsent | null> {
  const raw = await request(`/api/v1/auth/desktop/authorize?attempt_id=${encodeURIComponent(attemptId)}`);
  return parseWithFallback<DesktopConsent | null>(raw, DesktopConsentSchema, null, {
    endpoint: "GET /api/v1/auth/desktop/authorize",
  });
}

/** Approves or cancels an attempt; approval returns a callback URL for navigation. */
export async function desktopConsentCommand(
  body: { attempt_id: string; csrf_token: string; decision: "approve" | "cancel" },
): Promise<DesktopConsentResult | null> {
  const raw = await request("/api/v1/auth/desktop/authorize", { method: "POST", body });
  return parseWithFallback<DesktopConsentResult | null>(raw, DesktopConsentResultSchema, null, {
    endpoint: "POST /api/v1/auth/desktop/authorize",
  });
}

const UserResponse = z.object({ user: UserSchema });

export type { AuthProviders };

/**
 * An answer that opens a session, or the second factor still owed in its
 * place: the access token is stored only when the session parses. One of the
 * places a malformed response must NOT be smoothed over (login, register,
 * reset, the choice screen's create and claim-email verify): without a token
 * the session cannot start, so the caller gets null and shows an error
 * rather than a half-authenticated state (hooks.ts requireSession).
 */
export function startSession(raw: unknown, endpoint: string): SessionResponse | MFAChallenge | null {
  // An MFA account answers with a challenge, not a session; no token yet.
  const challenge = MFAChallengeSchema.safeParse(raw);
  if (challenge.success) return challenge.data;
  const sess = parseWithFallback<SessionResponse | null>(raw, SessionResponseSchema, null, { endpoint });
  setAccessToken(sess?.access_token ?? null);
  return sess;
}

/**
 * The choice screen's "Tôi đã có tài khoản" signs in to link the pending
 * provider (ADR 0047, /login?link=1): `keepSignInTicket` keeps the ticket
 * cookie this sign-in would otherwise drop.
 */
export interface SignInOptions {
  keepSignInTicket?: boolean;
}

const keepTicket = (opts?: SignInOptions) => (opts?.keepSignInTicket ? { keep_sign_in_ticket: true } : {});

export async function login(email: string, password: string, opts?: SignInOptions): Promise<SessionResponse | MFAChallenge | null> {
  const raw = await request("/api/v1/auth/login", {
    method: "POST",
    body: { email, password, ...keepTicket(opts) },
    skipRefresh: true,
  });
  return startSession(raw, "POST /api/v1/auth/login");
}

/**
 * Second login step. `mfaToken` null means the challenge rode in as a cookie
 * (Google, Apple, reset). The session may carry `link_skipped`: signed in,
 * but the provider the challenge waited to link was not linked.
 */
export async function verifyMfa(mfaToken: string | null, code: string, opts?: SignInOptions): Promise<SessionResponse | null> {
  const raw = await request("/api/v1/auth/mfa/verify", {
    method: "POST",
    body: { mfa_token: mfaToken ?? "", code, ...keepTicket(opts) },
    skipRefresh: true,
  });
  const sess = parseWithFallback<SessionResponse | null>(raw, SessionResponseSchema, null, {
    endpoint: "POST /api/v1/auth/mfa/verify",
  });
  setAccessToken(sess?.access_token ?? null);
  return sess;
}

const MFASetupSchema = z.object({ secret: z.string(), otpauth_url: z.string() });
export type MFASetup = z.infer<typeof MFASetupSchema>;

/** Turning the second factor on takes a step-up token (action enable_mfa when a mailed code bought it). */
export async function mfaSetup(stepUpToken: string): Promise<MFASetup | null> {
  const raw = await request("/api/v1/me/mfa/setup", { method: "POST", body: { step_up_token: stepUpToken } });
  return parseWithFallback<MFASetup | null>(raw, MFASetupSchema, null, { endpoint: "POST /api/v1/me/mfa/setup" });
}

const RecoveryCodesSchema = z.object({ recovery_codes: z.array(z.string()) });

/** Returns the recovery codes; an empty list on drift (the codes are shown once, so the UI must say so). */
export async function mfaConfirm(code: string, stepUpToken: string): Promise<string[]> {
  const raw = await request("/api/v1/me/mfa/confirm", { method: "POST", body: { code, step_up_token: stepUpToken } });
  return parseWithFallback<{ recovery_codes: string[] }>(raw, RecoveryCodesSchema, { recovery_codes: [] }, {
    endpoint: "POST /api/v1/me/mfa/confirm",
  }).recovery_codes;
}

export async function mfaDisable(code: string): Promise<User | null> {
  const raw = await request("/api/v1/me/mfa/disable", { method: "POST", body: { code } });
  return parseWithFallback<{ user: User } | null>(raw, UserResponse, null, {
    endpoint: "POST /api/v1/me/mfa/disable",
  })?.user ?? null;
}

const SessionListSchema = z.object({ sessions: z.array(UserSessionSchema) });

function dedupeSessionsById(sessions: UserSession[]): UserSession[] {
  const byId = new Map<string, UserSession>();
  for (const session of sessions) {
    const prev = byId.get(session.id);
    if (!prev || session.current || (!prev.current && (session.last_seen_at ?? "") > (prev.last_seen_at ?? ""))) {
      byId.set(session.id, session);
    }
  }
  return [...byId.values()];
}

export async function listSessions(): Promise<UserSession[]> {
  const raw = await request("/api/v1/me/sessions");
  const parsed = parseWithFallback<{ sessions: UserSession[] }>(raw, SessionListSchema, { sessions: [] }, {
    endpoint: "GET /api/v1/me/sessions",
  });
  return dedupeSessionsById(parsed.sessions);
}

export async function revokeSession(id: string): Promise<void> {
  await request(`/api/v1/me/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function revokeOtherSessions(): Promise<void> {
  await request("/api/v1/me/sessions/revoke-others", { method: "POST" });
}

/**
 * The proof is `step_up_token` (action delete_account when a mailed code
 * bought it); with it the server ignores the legacy proofs, which only the
 * shipped app still sends (reviewed 2027-01-31).
 */
export interface DeleteAccountBody {
  step_up_token?: string;
  password?: string;
  code?: string;
  email_confirmation?: string;
  close_organization?: string;
}

export async function deleteAccount(body: DeleteAccountBody): Promise<void> {
  await request("/api/v1/me/delete", { method: "POST", body });
  setAccessToken(null);
}

export async function registerUser(
  email: string,
  password: string,
  displayName: string,
): Promise<SessionResponse | null> {
  const raw = await request("/api/v1/auth/register", {
    method: "POST",
    body: { email, password, display_name: displayName },
    skipRefresh: true,
  });
  const sess = parseWithFallback<SessionResponse | null>(raw, SessionResponseSchema, null, {
    endpoint: "POST /api/v1/auth/register",
  });
  setAccessToken(sess?.access_token ?? null);
  return sess;
}

export async function logout(): Promise<void> {
  await request("/api/v1/auth/logout", { method: "POST", skipRefresh: true }).catch(() => {});
  setAccessToken(null);
}

export async function me(): Promise<User | null> {
  const raw = await request("/api/v1/me");
  return parseWithFallback<{ user: User } | null>(raw, UserResponse, null, { endpoint: "GET /api/v1/me" })
    ?.user ?? null;
}

export async function patchMe(body: { display_name?: string; locale?: "vi" | "en"; timezone?: string }): Promise<User | null> {
  const raw = await request("/api/v1/me", { method: "PATCH", body });
  return parseWithFallback<{ user: User } | null>(raw, UserResponse, null, {
    endpoint: "PATCH /api/v1/me",
  })?.user ?? null;
}

export async function uploadAvatar(file: File): Promise<User | null> {
  const form = new FormData();
  form.append("file", file);
  const raw = await request("/api/v1/me/avatar", { method: "POST", body: form });
  return parseWithFallback<{ user: User } | null>(raw, UserResponse, null, {
    endpoint: "POST /api/v1/me/avatar",
  })?.user ?? null;
}

export async function patchOnboarding(questionnaire: unknown): Promise<User | null> {
  const raw = await request("/api/v1/me/onboarding", { method: "PATCH", body: { questionnaire } });
  return parseWithFallback<{ user: User } | null>(raw, UserResponse, null, {
    endpoint: "PATCH /api/v1/me/onboarding",
  })?.user ?? null;
}

export async function completeOnboarding(
  completionPath: string,
  workspaceId?: string,
): Promise<User | null> {
  const raw = await request("/api/v1/me/onboarding/complete", {
    method: "POST",
    body: { completion_path: completionPath, workspace_id: workspaceId },
  });
  return parseWithFallback<{ user: User } | null>(raw, UserResponse, null, {
    endpoint: "POST /api/v1/me/onboarding/complete",
  })?.user ?? null;
}

export async function verifyEmail(code: string): Promise<User | null> {
  const raw = await request("/api/v1/me/email/verify", { method: "POST", body: { code } });
  return parseWithFallback<{ user: User } | null>(raw, UserResponse, null, {
    endpoint: "POST /api/v1/me/email/verify",
  })?.user ?? null;
}

export async function resendVerification(): Promise<void> {
  await request("/api/v1/me/email/resend", { method: "POST" });
}

export async function forgotPassword(email: string): Promise<void> {
  await request("/api/v1/auth/password/forgot", { method: "POST", body: { email }, skipRefresh: true });
}

/**
 * A reset link on an account that never verified its address takes it back
 * (the session carries `reclaimed: true`); `keepSignInTicket` when the reset
 * happens while a provider waits to be linked.
 */
export async function resetPassword(
  token: string,
  password: string,
  opts?: SignInOptions,
): Promise<SessionResponse | MFAChallenge | null> {
  const raw = await request("/api/v1/auth/password/reset", {
    method: "POST",
    body: { token, password, ...keepTicket(opts) },
    skipRefresh: true,
  });
  return startSession(raw, "POST /api/v1/auth/password/reset");
}

/** Which sign-ins this deployment offers (sign-in-schemas.ts); every provider off on drift. */
export async function authProviders(): Promise<AuthProviders> {
  return readAuthProviders(await request("/api/v1/auth/providers", { skipRefresh: true }));
}
