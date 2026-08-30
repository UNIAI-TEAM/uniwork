import { runtimeConfig } from "../runtime-config";

export const paths = {
  root: () => "/",
  login: () => "/login",
  register: () => "/register",
  verify: () => "/verify",
  authCallback: () => "/auth/callback",
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
  workspace: (orgSlug: string, wsSlug: string) => {
    const base = `/${orgSlug}/${wsSlug}`;
    return {
      root: () => base,
      tasks: () => `${base}/tasks`,
      task: (id: string) => `${base}/tasks/${id}`,
      meetings: () => `${base}/meetings`,
      meeting: (id: string) => `${base}/meetings/${id}`,
      room: (id: string) => `${base}/meetings/${id}/room`,
      chat: () => `${base}/chat`,
      members: () => `${base}/members`,
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
  "/auth/",
  "/onboarding",
  "/invitations",
  "/workspaces",
  "/invite/",
] as const;

export function isGlobalPath(path: string): boolean {
  return GLOBAL_PREFIXES.some(
    (prefix) => path === prefix.replace(/\/$/, "") || path.startsWith(prefix.endsWith("/") ? prefix : prefix + "/"),
  );
}
