import { runtimeConfig } from "../runtime-config";

export const paths = {
  root: () => "/",
  login: () => "/login",
  register: () => "/register",
  verify: () => "/verify",
  authCallback: () => "/auth/callback",
  forgotPassword: () => "/forgot-password",
  resetPassword: (token?: string) =>
    token ? `/reset-password?token=${encodeURIComponent(token)}` : "/reset-password",
  /**
   * Absolute URL on the API, not a page: the browser leaves for Google from
   * here and the API sets the session cookie before sending it back to
   * authCallback(). `next` is re-sanitized by the server.
   */
  googleStart: (next?: string | null) =>
    `${runtimeConfig().apiUrl}/api/v1/auth/google/start${next ? `?next=${encodeURIComponent(next)}` : ""}`,
  onboarding: () => "/onboarding",
  newWorkspace: () => "/workspaces/new",
  invitations: () => "/invitations",
  workspaces: () => "/workspaces",
  invite: (token: string) => `/invite/${token}`,
  meetingInvite: (linkId: string) => `/invite/meeting/${linkId}`,
  meetingInviteRoom: (linkId: string) => `/invite/meeting/${linkId}/room`,
  /** Platform-admin console: outside every organization, guarded by GET /admin/me. */
  admin: {
    root: () => "/admin",
    organizations: () => "/admin/organizations",
    organization: (id: string) => `/admin/organizations/${id}`,
    flags: () => "/admin/flags",
    trace: (traceId?: string) => (traceId ? `/admin/trace?id=${encodeURIComponent(traceId)}` : "/admin/trace"),
    quota: () => "/admin/quota",
    system: () => "/admin/system",
  },
  workspace: (orgSlug: string, wsSlug: string) => {
    const base = `/${orgSlug}/${wsSlug}`;
    return {
      root: () => base,
      tasks: () => `${base}/tasks`,
      task: (id: string) => `${base}/tasks/${id}`,
      myTasks: () => `${base}/my-tasks`,
      meetings: () => `${base}/meetings`,
      meeting: (id: string) => `${base}/meetings/${id}`,
      room: (id: string) => `${base}/meetings/${id}/room`,
      chat: () => `${base}/chat`,
      inbox: () => `${base}/inbox`,
      members: () => `${base}/members`,
      people: () => `${base}/people`,
      person: (userId: string) => `${base}/people/${userId}`,
      settings: () => `${base}/settings`,
    };
  },
};

/** Chỉ cho phép path cùng origin: bắt đầu bằng "/" và không phải "//". */
export function sanitizeNextUrl(raw: string | null | undefined): string | null {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return null;
  return raw;
}

/**
 * Route prefixes that are never workspace-scoped. Each one's first segment
 * must also be a reserved slug (consistency.test.ts checks), otherwise an
 * organization named "login" would shadow the login page.
 */
export const GLOBAL_PREFIXES = [
  "/login",
  "/register",
  "/verify",
  "/forgot-password",
  "/reset-password",
  "/auth/",
  "/onboarding",
  "/invitations",
  "/workspaces",
  "/invite/",
  "/admin",
] as const;

export function isGlobalPath(path: string): boolean {
  return GLOBAL_PREFIXES.some(
    (prefix) => path === prefix.replace(/\/$/, "") || path.startsWith(prefix.endsWith("/") ? prefix : prefix + "/"),
  );
}
