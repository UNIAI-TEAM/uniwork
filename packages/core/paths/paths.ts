export const paths = {
  root: () => "/",
  login: () => "/login",
  register: () => "/register",
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
