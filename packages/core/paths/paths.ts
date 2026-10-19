import { runtimeConfig } from "../runtime-config";
import { marketingHref, vietnamesePath } from "./marketing";

export const paths = {
  root: () => "/",
  login: () => "/login",
  register: () => "/register",
  verify: () => "/verify",
  authCallback: () => "/auth/callback",
  /** Consent page the desktop app's system-browser sign-in lands on (G4-02b). */
  desktopAuthorize: () => "/auth/desktop/authorize",
  /** Consent page an external AI client (MCP connector) sends the browser to (UNI-1308). */
  connectAuthorize: () => "/auth/connect/authorize",
  /** The UniChat desktop shell's start page; hands over to /login on the client. */
  unichatStart: () => "/auth/unichat",
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
  /**
   * Where an onboarded person who belongs to no organization lands: create one
   * or join through an invitation (ADR 0032 D12). Hyphenated root, reserved.
   */
  getStarted: () => "/get-started",
  /**
   * Where a plain member of an organization lands while no workspace has been
   * opened to them (UNI-1472, UNI-1582): they are told so and to ask an
   * admin, never sent to create one. Hyphenated root, reserved.
   */
  noWorkspace: () => "/no-workspace",
  newWorkspace: () => "/workspaces/new",
  invitations: () => "/invitations",
  workspaces: () => "/workspaces",
  invite: (token: string) => `/invite/${token}`,
  meetingInvite: (linkId: string) => `/invite/meeting/${linkId}`,
  meetingInviteRoom: (linkId: string) => `/invite/meeting/${linkId}/room`,
  /** Anonymous document link (G1-08): outside the shell, token-only access. */
  publicShare: (token: string) => `/share/${encodeURIComponent(token)}`,
  /**
   * Public marketing pages, one per team the product is sold to. The noun is
   * reserved so an organization can never take the subtree
   * (docs/conventions.md §Routes).
   */
  solutions: {
    root: () => "/solutions",
    product: () => "/solutions/product",
    operations: () => "/solutions/operations",
  },
  features: () => "/features",
  feature: (slug: string) => `/features/${encodeURIComponent(slug)}`,
  learn: () => "/learn",
  changelog: () => "/changelog",
  pricing: () => "/pricing",
  enterprise: () => "/enterprise",
  requestDemo: () => "/request-demo",
  /**
   * The ecosystem's apps (landing menu "Apps"): the hub with every download,
   * and one page per app. /office and /unichat permanently redirect here.
   */
  apps: {
    root: () => "/apps",
    office: () => "/apps/office",
    unichat: () => "/apps/unichat",
  },
  about: () => "/about",
  security: () => "/security",
  guide: (slug: string) => `/learn/${encodeURIComponent(slug)}`,
  marketing: marketingHref,
  vietnamese: vietnamesePath,
  /**
   * Positioning page: what the platforms a buyer already owns do not cover.
   * Hyphenated root, the third after forgot-password and reset-password; the
   * slug is reserved so an organization can never take it
   * (docs/conventions.md §Routes).
   */
  whyUniwork: () => "/why-uniwork",
  /** Platform-admin console: outside every organization, guarded by GET /admin/me. */
  admin: {
    root: () => "/admin",
    organizations: () => "/admin/organizations",
    demoRequests: () => "/admin/demo-requests",
    organization: (id: string) => `/admin/organizations/${id}`,
    flags: () => "/admin/flags",
    plans: () => "/admin/plans",
    invoices: () => "/admin/invoices",
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
      calendar: () => `${base}/calendar`,
      projects: () => `${base}/projects`,
      project: (id: string) => `${base}/projects/${id}`,
      meetings: () => `${base}/meetings`,
      documents: () => `${base}/documents`,
      // A folder is a query on the documents page, not a page of its own
      // (FD-06): consistency.test.ts has no route to match it against.
      documentsFolder: (id: string) => `${base}/documents?folder=${encodeURIComponent(id)}`,
      // The Thùng rác scope, with one trashed document to scroll to and
      // highlight (TRASH-NOTIFY-01); an id the list does not hold is ignored.
      documentsTrash: (focusId?: string) =>
        focusId
          ? `${base}/documents?view=archived&focus=${encodeURIComponent(focusId)}`
          : `${base}/documents?view=archived`,
      // Who holds which level on the documents the reader manages: the whole
      // workspace, or one folder and its subfolders (UNI-1643).
      documentsAccessReport: (folderId?: string) =>
        folderId
          ? `${base}/documents/access-report?folder=${encodeURIComponent(folderId)}`
          : `${base}/documents/access-report`,
      document: (id: string) => `${base}/documents/${id}`,
      meeting: (id: string) => `${base}/meetings/${id}`,
      room: (id: string) => `${base}/meetings/${id}/room`,
      chat: () => `${base}/chat`,
      /** Opens a room (and optionally scrolls to a message) on the chat page. */
      chatConversation: (roomId: string, messageId?: string) => {
        const params = new URLSearchParams();
        params.set("room", roomId);
        if (messageId) params.set("message", messageId);
        return `${base}/chat?${params.toString()}`;
      },
      inbox: () => `${base}/inbox`,
      email: () => `${base}/email`,
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
  "/get-started",
  "/no-workspace",
  "/invitations",
  "/workspaces",
  "/invite/",
  "/share/",
  "/admin",
  // Public marketing pages: without these the two-segment ones would read
  // as /[orgSlug]/[workspaceSlug] in RUM route patterns.
  "/solutions",
  "/features",
  "/why-uniwork",
  "/learn",
  "/changelog",
  "/pricing",
  "/enterprise",
  "/request-demo",
  "/apps",
  // The pre-/apps URLs: permanent redirects, still global.
  "/office",
  "/unichat",
  "/vi",
  "/about",
  "/security",
] as const;

export function isGlobalPath(path: string): boolean {
  return GLOBAL_PREFIXES.some(
    (prefix) => path === prefix.replace(/\/$/, "") || path.startsWith(prefix.endsWith("/") ? prefix : prefix + "/"),
  );
}
