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

/** Starts a PKCE attempt; the server returns an opaque browser authorization URL. */
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

const ProvidersSchema = z.object({ google: z.boolean().optional().default(false) });
export type AuthProviders = z.infer<typeof ProvidersSchema>;

/**
 * Login and register are the two places a malformed response must NOT be
 * smoothed over: without a token the session cannot start, so the caller
 * gets null and shows an error rather than a half-authenticated state.
 */
export async function login(email: string, password: string): Promise<SessionResponse | MFAChallenge | null> {
  const raw = await request("/api/v1/auth/login", {
    method: "POST",
    body: { email, password },
    skipRefresh: true,
  });
  // An MFA account answers with a challenge, not a session; no token yet.
  const challenge = MFAChallengeSchema.safeParse(raw);
  if (challenge.success) return challenge.data;
  const sess = parseWithFallback<SessionResponse | null>(raw, SessionResponseSchema, null, {
    endpoint: "POST /api/v1/auth/login",
  });
  setAccessToken(sess?.access_token ?? null);
  return sess;
}

/** Second login step. `mfaToken` null means the challenge rode in as a cookie (Google, reset). */
export async function verifyMfa(mfaToken: string | null, code: string): Promise<SessionResponse | null> {
  const raw = await request("/api/v1/auth/mfa/verify", {
    method: "POST",
    body: { mfa_token: mfaToken ?? "", code },
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

export async function mfaSetup(): Promise<MFASetup | null> {
  const raw = await request("/api/v1/me/mfa/setup", { method: "POST" });
  return parseWithFallback<MFASetup | null>(raw, MFASetupSchema, null, { endpoint: "POST /api/v1/me/mfa/setup" });
}

const RecoveryCodesSchema = z.object({ recovery_codes: z.array(z.string()) });

/** Returns the recovery codes; an empty list on drift (the codes are shown once, so the UI must say so). */
export async function mfaConfirm(code: string): Promise<string[]> {
  const raw = await request("/api/v1/me/mfa/confirm", { method: "POST", body: { code } });
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

export async function listSessions(): Promise<UserSession[]> {
  const raw = await request("/api/v1/me/sessions");
  return parseWithFallback<{ sessions: UserSession[] }>(raw, SessionListSchema, { sessions: [] }, {
    endpoint: "GET /api/v1/me/sessions",
  }).sessions;
}

export async function revokeSession(id: string): Promise<void> {
  await request(`/api/v1/me/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function revokeOtherSessions(): Promise<void> {
  await request("/api/v1/me/sessions/revoke-others", { method: "POST" });
}

export interface DeleteAccountBody {
  password?: string;
  code?: string;
  email_confirmation?: string;
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

export async function resetPassword(token: string, password: string): Promise<SessionResponse | MFAChallenge | null> {
  const raw = await request("/api/v1/auth/password/reset", {
    method: "POST",
    body: { token, password },
    skipRefresh: true,
  });
  const challenge = MFAChallengeSchema.safeParse(raw);
  if (challenge.success) return challenge.data;
  const sess = parseWithFallback<SessionResponse | null>(raw, SessionResponseSchema, null, {
    endpoint: "POST /api/v1/auth/password/reset",
  });
  setAccessToken(sess?.access_token ?? null);
  return sess;
}

/** Which third-party sign-ins this deployment offers; every provider off on drift. */
export async function authProviders(): Promise<AuthProviders> {
  const raw = await request("/api/v1/auth/providers", { skipRefresh: true });
  return parseWithFallback<AuthProviders>(raw, ProvidersSchema, { google: false }, {
    endpoint: "GET /api/v1/auth/providers",
  });
}
