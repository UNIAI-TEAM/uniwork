import { z } from "zod";
import { SessionResponseSchema, UserSchema, type SessionResponse, type User } from "../../types/user";
import { request } from "../http";
import { parseWithFallback } from "../schema";
import { setAccessToken } from "../session";

export { refreshSession } from "../http";

const UserResponse = z.object({ user: UserSchema });

/**
 * Login and register are the two places a malformed response must NOT be
 * smoothed over: without a token the session cannot start, so the caller
 * gets null and shows an error rather than a half-authenticated state.
 */
export async function login(email: string, password: string): Promise<SessionResponse | null> {
  const raw = await request("/api/v1/auth/login", {
    method: "POST",
    body: { email, password },
    skipRefresh: true,
  });
  const sess = parseWithFallback<SessionResponse | null>(raw, SessionResponseSchema, null, {
    endpoint: "POST /api/v1/auth/login",
  });
  setAccessToken(sess?.access_token ?? null);
  return sess;
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

export async function patchMe(body: { display_name: string }): Promise<User | null> {
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
