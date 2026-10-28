import type { SignInProvider } from "../api/endpoints/sign-in-schemas";
import { runtimeConfig } from "../runtime-config";
import { marketingHref, vietnamesePath } from "./marketing";

/** `path?a=1&b=2` of the params that have a value, in the order given (URLSearchParams encodes them). */
function withQuery(path: string, params: Record<string, string | null | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
  const s = query.toString();
  return s ? `${path}?${s}` : path;
}

/**
 * Where a provider's start sends the browser back when nothing matched
 * (ADR 0047): sign_in (the default, left out of the URL) issues a ticket for
 * the choice screen; sign_up (the register page) creates the account at once.
 */
export type ProviderStartIntent = "sign_in" | "sign_up";

/** `next` is a same-origin path the server sanitizes again; `intent` as above. */
export interface ProviderStartOptions {
  next?: string | null;
  intent?: ProviderStartIntent;
}

function providerStart(path: string, opts: ProviderStartOptions): string {
  return withQuery(`${runtimeConfig().apiUrl}${path}`, {
    next: opts.next,
    intent: opts.intent === "sign_up" ? "sign_up" : null,
  });
}

export const paths = {
  root: () => "/",
  /**
   * `next` survives the sign-in; `link` is the choice screen's "Tôi đã có tài
   * khoản" (spec §4.4): the page says which provider waits and keeps the
   * pending sign-in through the password, the second factor and a reset.
   * `provider` is the desktop or phone app's button (spec §3.5): the page
   * goes on to that provider once, and drops it from the URL.
   */
  login: (opts: { next?: string | null; link?: boolean; provider?: SignInProvider | null } = {}) =>
    withQuery("/login", { next: opts.next, link: opts.link ? "1" : null, provider: opts.provider }),
  register: (opts: { next?: string | null } = {}) => withQuery("/register", { next: opts.next }),
  verify: (opts: { next?: string | null } = {}) => withQuery("/verify", { next: opts.next }),
  authCallback: () => "/auth/callback",
  /**
   * The choice screen a provider sign-in that found no account lands on
   * (ADR 0047 §2c, spec §4.3); `step: "link"` is its link step, which a
   * sign-in whose `next` it is keeps the pending sign-in for.
   */
  authContinue: (opts: { next?: string | null; step?: "link" } = {}) =>
    withQuery("/auth/continue", { step: opts.step, next: opts.next }),
  /** Consent page the desktop app's system-browser sign-in lands on (G4-02b). */
  desktopAuthorize: () => "/auth/desktop/authorize",
  /** Consent page an external AI client (MCP connector) sends the browser to (UNI-1308). */
  connectAuthorize: () => "/auth/connect/authorize",
  /** The UniChat desktop shell's start page; hands over to /login on the client. */
  unichatStart: () => "/auth/unichat",
  forgotPassword: (opts: { next?: string | null } = {}) => withQuery("/forgot-password", { next: opts.next }),
  resetPassword: (token?: string) =>
    token ? `/reset-password?token=${encodeURIComponent(token)}` : "/reset-password",
  /**
   * Absolute URLs on the API, not pages: the browser leaves for Google or
   * Apple from here and the API sets the session cookie (or the choice
   * screen's ticket) before sending it back to authCallback() (or
   * authContinue()).
   */
  googleStart: (opts: ProviderStartOptions = {}) => providerStart("/api/v1/auth/google/start", opts),
  appleStart: (opts: ProviderStartOptions = {}) => providerStart("/api/v1/auth/apple/start", opts),
  onboarding: (opts: { next?: string | null } = {}) => withQuery("/onboarding", { next: opts.next }),
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
  /** Shareable membership invite link (workspace or organization). Secret rides in the fragment. */
  membershipInvite: (linkId: string) => `/join/${encodeURIComponent(linkId)}`,
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
  /** The public security page (marketing); the account's own security settings are securitySettings(). */
  security: () => "/security",
  /**
   * Account-level settings outside every workspace (spec §4.5): a person
   * with a workspace is sent on to its settings, one without one gets the
   * security tab here. securitySettings is where Sign-in methods lives and
   * where a link from Settings comes back to; `expectUser` is the account
   * the UniChat shell signed in with, so the browser can warn when it is
   * signed in as someone else.
   */
  accountSettings: () => "/settings",
  securitySettings: (opts: { expectUser?: string } = {}) =>
    withQuery("/settings", { tab: "security", expect_user: opts.expectUser }),
  privacy: () => "/privacy",
  terms: () => "/terms",
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
    chatReports: () => "/admin/chat-reports",
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
      // The document page with its version history open (a chat card's
      // "Lịch sử phiên bản"); the page drops the parameter once it opens.
      documentVersions: (id: string) => `${base}/documents/${id}?panel=versions`,
      meeting: (id: string) => `${base}/meetings/${id}`,
      room: (id: string) => `${base}/meetings/${id}/room`,
      chat: () => `${base}/chat`,
      /** Chat's direct messages and groups, which belong to the organization (UniChat's Tin nhắn). */
      chatMessages: () => `${base}/chat?view=messages`,
      /** Chat's channels of this workspace. */
      chatChannels: () => `${base}/chat?view=channels`,
      /** UniChat's own settings (the shell keeps to /chat*), beside the workspace rail. */
      chatSettings: () => `${base}/chat/settings`,
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

const SAME_ORIGIN_PROBE = "https://app.invalid";

/** Chỉ cho phép path cùng origin: bắt đầu bằng "/" và không phải "//". */
export function sanitizeNextUrl(raw: string | null | undefined): string | null {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return null;
  // Browsers drop tab/CR/LF and read "\" as "/" before parsing, so "/\t/x.com"
  // would navigate to "//x.com"; refuse any whitespace, control or backslash.
  if (/[\s\p{Cc}\\]/u.test(raw)) return null;
  return new URL(raw, SAME_ORIGIN_PROBE).origin === SAME_ORIGIN_PROBE ? raw : null;
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
  "/join/",
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
  "/privacy",
  "/terms",
] as const;

export function isGlobalPath(path: string): boolean {
  return GLOBAL_PREFIXES.some(
    (prefix) => path === prefix.replace(/\/$/, "") || path.startsWith(prefix.endsWith("/") ? prefix : prefix + "/"),
  );
}
