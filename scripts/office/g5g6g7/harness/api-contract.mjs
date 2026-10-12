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
    body: ["operation", "deployment_id", "client_id", "return_hint"],
  },
  desktopDevices: { method: "GET", path: "/auth/desktop/devices" },
  requestOrganizationDeletion: { method: "POST", path: "/orgs/{orgID}/privacy/deletion", params: { orgID: "id" }, sdi: "CreatePrivacyDeletionSDI", body: ["confirm_slug"] },
  deleteAccount: { method: "POST", path: "/me/delete", sdi: "DeleteAccountSDI", body: ["password"] },
};

/** `/api/v1` + the template with each `{param}` replaced by its value (URL-escaped). */
export function apiPath(name, params = {}) {
  const call = API_CALLS[name];
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
export function assertBodyKeys(name, body) {
  const call = API_CALLS[name];
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
