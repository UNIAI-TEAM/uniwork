// The D server API calls the document step makes, as one table (UNI-1376 r6).
// document-step.mjs builds every path from it, and api-contract.test.mjs pins
// the table against the server's route catalogue (server/internal/handler/router),
// the handlers and the SDI structs, so a call that the server does not route, a
// path param that takes an id where the step passed a slug (cloud round 5: POST
// /orgs/<slug>/workspaces -> 403), or a body key the SDI does not have fails in
// node --test before it fails on a cloud VM.
//
// Per call: the HTTP method, the path template exactly as the router registers
// it (under /api/v1), what each path param takes (`id` or `slug`), the SDI
// struct the JSON body decodes into (`sdi`) and the keys the step sends, or for
// a multipart upload the form fields the handler reads (`form`).

export const API_PREFIX = "/api/v1";

export const API_CALLS = {
  register: { method: "POST", path: "/auth/register", sdi: "RegisterSDI", body: ["email", "password", "display_name"] },
  verifyEmail: { method: "POST", path: "/me/email/verify", sdi: "VerifyEmailSDI", body: ["code"] },
  login: { method: "POST", path: "/auth/login", sdi: "LoginSDI", body: ["email", "password"] },
  createOrganization: { method: "POST", path: "/orgs", sdi: "CreateOrganizationSDI", body: ["name", "slug"] },
  // `{org}` of this one route is the organization ID, not its slug
  // (handler/organization.go createOrgWorkspace -> WorkspaceService.CreateInOrg(orgID)).
  createWorkspace: { method: "POST", path: "/orgs/{org}/workspaces", params: { org: "id" }, sdi: "CreateWorkspaceSDI", body: ["name", "slug"] },
  createFileDocument: { method: "POST", path: "/workspaces/{workspaceID}/documents/files", params: { workspaceID: "id" }, form: ["file", "title"] },
  mintLaunch: {
    method: "POST",
    path: "/documents/{documentID}/office/sessions",
    params: { documentID: "id" },
    sdi: "CreateOfficeLaunchSessionSDI",
    // comment_id (G8-07): the launch ticket names the comment the app reveals; G8-19 sends it
    body: ["operation", "deployment_id", "client_id", "return_hint", "comment_id"],
  },
  desktopDevices: { method: "GET", path: "/auth/desktop/devices" },
  requestOrganizationDeletion: { method: "POST", path: "/orgs/{orgID}/privacy/deletion", params: { orgID: "id" }, sdi: "CreatePrivacyDeletionSDI", body: ["confirm_slug"] },
  deleteAccount: { method: "POST", path: "/me/delete", sdi: "DeleteAccountSDI", body: ["password"] },
};

/**
 * The rows the G8-19 cross-host harness (harness/api.mjs) calls on top of
 * API_CALLS: comments, anchors, mentions, notifications, shares, invitations,
 * rename/archive/copy and member deactivation (UNI-1414). Same shape as
 * API_CALLS; `params` kinds here may also be `token` (an invitation token).
 * Pinned against the router by harness/api.test.mjs.
 */
export const G8_CALLS = {
  completeOnboarding: { method: "POST", path: "/me/onboarding/complete", sdi: "CompleteOnboardingSDI", body: ["completion_path", "workspace_id"] },
  getDocument: { method: "GET", path: "/documents/{documentID}", params: { documentID: "id" } },
  patchDocument: { method: "PATCH", path: "/documents/{documentID}", params: { documentID: "id" }, sdi: "PatchDocumentSDI", body: ["revision", "title"] },
  archiveDocument: { method: "POST", path: "/documents/{documentID}/archive", params: { documentID: "id" } },
  restoreDocument: { method: "POST", path: "/documents/{documentID}/restore", params: { documentID: "id" } },
  copyDocument: { method: "POST", path: "/documents/{documentID}/copies", params: { documentID: "id" }, sdi: "CopyDocumentSDI", body: ["consent", "title"] },
  listSharedWithMe: { method: "GET", path: "/workspaces/{workspaceID}/documents/shared-with-me", params: { workspaceID: "id" } },
  listDocumentComments: { method: "GET", path: "/documents/{documentID}/comments", params: { documentID: "id" }, query: ["kind", "since_token"] },
  createDocumentComment: {
    method: "POST",
    path: "/documents/{documentID}/comments",
    params: { documentID: "id" },
    sdi: "CreateDocumentCommentSDI",
    body: ["body", "parent_id", "kind", "anchor", "base_version_id"],
  },
  putDocumentCommentAnchors: {
    method: "PUT",
    path: "/documents/{documentID}/comments/anchors",
    params: { documentID: "id" },
    sdi: "PutDocumentCommentAnchorsSDI",
    body: ["version_id", "anchors"],
  },
  updateDocumentComment: {
    method: "PATCH",
    path: "/documents/{documentID}/comments/{commentID}",
    params: { documentID: "id", commentID: "id" },
    sdi: "UpdateDocumentCommentSDI",
    body: ["body"],
  },
  deleteDocumentComment: { method: "DELETE", path: "/documents/{documentID}/comments/{commentID}", params: { documentID: "id", commentID: "id" } },
  resolveDocumentComment: { method: "POST", path: "/documents/{documentID}/comments/{commentID}/resolve", params: { documentID: "id", commentID: "id" } },
  reopenDocumentComment: { method: "DELETE", path: "/documents/{documentID}/comments/{commentID}/resolve", params: { documentID: "id", commentID: "id" } },
  listDocumentCommentRevisions: {
    method: "GET",
    path: "/documents/{documentID}/comments/{commentID}/revisions",
    params: { documentID: "id", commentID: "id" },
  },
  listMentionCandidates: { method: "GET", path: "/documents/{documentID}/mention-candidates", params: { documentID: "id" }, query: ["q", "limit"] },
  listNotifications: { method: "GET", path: "/me/notifications" },
  unreadNotificationCount: { method: "GET", path: "/me/notifications/unread-count" },
  markNotificationsRead: { method: "POST", path: "/me/notifications/read", sdi: "NotificationIDsSDI", body: ["ids", "all", "workspace_id"] },
  listDocumentShares: { method: "GET", path: "/documents/{documentID}/shares", params: { documentID: "id" } },
  createDocumentShare: {
    method: "POST",
    path: "/documents/{documentID}/shares",
    params: { documentID: "id" },
    sdi: "ShareDocumentSDI",
    body: ["principal_type", "principal_id", "level"],
  },
  revokeDocumentShare: { method: "DELETE", path: "/documents/{documentID}/shares/{shareID}", params: { documentID: "id", shareID: "id" } },
  createInvitation: { method: "POST", path: "/workspaces/{workspaceID}/invitations", params: { workspaceID: "id" }, sdi: "CreateInvitationSDI", body: ["email", "role"] },
  myInvitations: { method: "GET", path: "/me/invitations" },
  acceptInvitation: { method: "POST", path: "/invitations/{token}/accept", params: { token: "token" } },
  // `{org}` of this route is the organization SLUG (handler/organization_members.go deactivateOrgMember -> orgIDFromSlug)
  deactivateOrgMember: { method: "POST", path: "/orgs/{org}/members/{userID}/deactivate", params: { org: "slug", userID: "id" } },
};

/** Every row harness/api.mjs may call: the document-step rows plus the G8 rows. */
export const G8_API_CALLS = { ...API_CALLS, ...G8_CALLS };

/** `/api/v1` + the template with each `{param}` replaced by its value (URL-escaped). */
export function apiPath(name, params = {}, table = API_CALLS) {
  const call = table[name];
  if (!call) throw new Error(`unknown API call ${name}`);
  const wanted = Object.keys(call.params ?? {});
  const given = Object.keys(params);
  if (wanted.length !== given.length || wanted.some((key) => !(key in params))) {
    throw new Error(`API call ${name} takes path params {${wanted.join(", ")}}, got {${given.join(", ")}}`);
  }
  return API_PREFIX + call.path.replace(/\{(\w+)\}/g, (_, key) => {
    const value = params[key];
    if (typeof value !== "string" || value === "") throw new Error(`API call ${name}: path param ${key} is empty`);
    return encodeURIComponent(value);
  });
}

/** Throws unless `body` has exactly keys from the call's table (so the step cannot send a key the contract does not pin). */
export function assertBodyKeys(name, body, table = API_CALLS) {
  const call = table[name];
  const sent = Object.keys(body ?? {});
  const unknown = sent.filter((key) => !(call.body ?? []).includes(key));
  if (unknown.length > 0) throw new Error(`API call ${name} sends body keys ${unknown.join(", ")} that the contract table does not list`);
}

/**
 * A failed API call: the method, the path and the status, and what the server
 * answered. The message never carries the origin's credentials; a token is never
 * in a path, and a response body is cut to 200 characters with token-looking
 * fields redacted.
 */
export class ApiError extends Error {
  constructor({ method, path, status, bodyText }) {
    super(`${method} ${path} -> ${status}: ${redact(bodyText).slice(0, 200)}`);
    this.method = method;
    this.path = path;
    this.status = status;
  }
}

/** Failure info for the evidence output: what failed and, for an API call, which request. */
export function failureInfo(error) {
  const info = { reason: String(error?.message ?? error) };
  if (error instanceof ApiError) info.request = { method: error.method, path: error.path, status: error.status };
  return info;
}

function redact(text) {
  return String(text ?? "")
    .replace(/("(?:access_token|refresh_token|launch_ticket|ticket|token|password)"\s*:\s*)"[^"]*"/gi, '$1"<redacted>"')
    .replace(/ticket=[^&\s"]+/g, "ticket=<redacted>");
}
