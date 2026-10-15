/* global process, fetch, FormData, Blob, AbortSignal */
// The D server side of the app-layer fault runner (UNI-1380, WI-4): the
// accounts, the tenant, device B's commits and the real server conditions
// (revoke, archive, deactivate, suspend, flag override) a case sets and lifts.
// Every call here goes STRAIGHT to the D server, never through the fault proxy
// (matrix §1: device B, the owner and the admin are not the side under test).
// No token, password or ticket is ever printed or written: errors carry the
// method, the path template and the status only.

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { basename } from "node:path";

const REQUEST_TIMEOUT_MS = 30_000;

export class TenantError extends Error {}

/** A request to the D server; resolves `{status, body}` and never throws on a status. */
export async function dRequest(apiOrigin, path, { method = "GET", token, headers = {}, json, form } = {}) {
  const reqHeaders = { accept: "application/json", ...headers };
  if (token) reqHeaders.authorization = `Bearer ${token}`;
  let body;
  if (json !== undefined) {
    reqHeaders["content-type"] = "application/json";
    body = JSON.stringify(json);
  } else if (form) body = form;
  try {
    const res = await fetch(`${apiOrigin}${path}`, { method, headers: reqHeaders, body, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    const text = await res.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    return { status: res.status, body: parsed };
  } catch (error) {
    return { status: "unreachable", body: null, error: error?.name ?? "error" };
  }
}

/** Throws a TenantError naming the step, method, path template and status. */
async function must(step, apiOrigin, path, options, okStatuses = [200, 201, 202, 204], template = path) {
  const res = await dRequest(apiOrigin, path, options);
  if (!okStatuses.includes(res.status)) {
    const code = res.body?.error?.code ?? res.body?.code ?? "";
    throw new TenantError(`${step}: ${options?.method ?? "GET"} ${template} -> ${res.status}${code ? ` ${code}` : ""}`);
  }
  return res.body;
}

/** Registers and verifies one throwaway account (register answers 200 or 201). */
export async function seedAccount(apiOrigin, tag, { verificationCode = "123456" } = {}) {
  const suffix = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
  const email = `g7-03a-${tag}-${suffix}@example.com`;
  const password = crypto.randomBytes(15).toString("base64url");
  const reg = await must("register", apiOrigin, "/api/v1/auth/register", {
    method: "POST",
    json: { email, password, display_name: `G7-03a ${tag}` },
  });
  const token = reg?.access_token;
  const userId = reg?.user?.id;
  if (!token || !userId) throw new TenantError(`register ${tag}: no access token or user id in the answer`);
  await must("verify email", apiOrigin, "/api/v1/me/email/verify", { method: "POST", token, json: { code: verificationCode } });
  const account = { tag, email, userId, token };
  // the password stays in memory for re-login, never in the object's JSON
  Object.defineProperty(account, "password", { value: password, enumerable: false });
  return account;
}

export async function login(apiOrigin, account) {
  const res = await must("login", apiOrigin, "/api/v1/auth/login", { method: "POST", json: { email: account.email, password: account.password } });
  account.token = res?.access_token ?? account.token;
  return account.token;
}

/** An organization + workspace owned by `owner`. */
export async function seedOrgWorkspace(apiOrigin, owner, label) {
  const slug = `${label}-${Date.now().toString(36)}-${crypto.randomBytes(2).toString("hex")}`.toLowerCase();
  const org = await must("create organization", apiOrigin, "/api/v1/orgs", {
    method: "POST", token: owner.token, json: { name: `G7-03a ${label}`, slug: `o-${slug}` },
  });
  const orgId = org?.organization?.id;
  const ws = await must("create workspace", apiOrigin, `/api/v1/orgs/${orgId}/workspaces`, {
    method: "POST", token: owner.token, json: { name: `G7-03a ${label}`, slug: `w-${slug}` },
  }, undefined, "/api/v1/orgs/{org}/workspaces");
  return { orgId, orgSlug: org?.organization?.slug, workspaceId: ws?.workspace?.id };
}

/** Invites `member` into the workspace and accepts as them (also re-adds after a removal). */
export async function addWorkspaceMember(apiOrigin, tenant, member, role = "member") {
  await must("invite member", apiOrigin, `/api/v1/workspaces/${tenant.workspaceId}/invitations`, {
    method: "POST", token: tenant.owner.token, json: { emails: [member.email], role },
  }, undefined, "/api/v1/workspaces/{workspaceID}/invitations");
  const mine = await must("list my invitations", apiOrigin, "/api/v1/me/invitations", { token: member.token });
  const pending = (mine?.invitations ?? []).find((inv) => inv.workspace?.id === tenant.workspaceId);
  if (!pending?.token) return false;
  await must("accept invitation", apiOrigin, `/api/v1/invitations/${pending.token}/accept`, {
    method: "POST", token: member.token, json: {},
  }, undefined, "/api/v1/invitations/{token}/accept");
  return true;
}

/**
 * The run's tenant: an owner (also device B and, once granted, the platform
 * admin), the app's account as a plain workspace member (so the owner can
 * revoke, deactivate and restore it), and a foreign account in its own org.
 */
export async function seedAppTenant(apiOrigin, { verificationCode } = {}) {
  const owner = await seedAccount(apiOrigin, "owner", { verificationCode });
  const app = await seedAccount(apiOrigin, "app", { verificationCode });
  const foreign = await seedAccount(apiOrigin, "foreign", { verificationCode });
  const { orgId, orgSlug, workspaceId } = await seedOrgWorkspace(apiOrigin, owner, "fault");
  const tenant = { apiOrigin, owner, app, foreign, orgId, orgSlug, workspaceId };
  await addWorkspaceMember(apiOrigin, tenant, app);
  await seedOrgWorkspace(apiOrigin, foreign, "foreign");
  return tenant;
}

/** Uploads a fixture as a new file document owned by the owner; returns `{id, revision}`. */
export async function createFileDocument(tenant, fixture, title) {
  const form = new FormData();
  form.set("file", new Blob([fixture.bytes], { type: fixture.mime || "application/octet-stream" }), basename(fixture.path));
  form.set("title", title);
  const created = await must("create file document", tenant.apiOrigin, `/api/v1/workspaces/${tenant.workspaceId}/documents/files`, {
    method: "POST", token: tenant.owner.token, form,
  }, undefined, "/api/v1/workspaces/{workspaceID}/documents/files");
  const doc = created?.document;
  if (!doc?.id) throw new TenantError("create file document: no document in the answer");
  return { id: doc.id, revision: String(doc.revision ?? "") };
}

export async function headRevision(tenant, documentId) {
  const res = await must("read document", tenant.apiOrigin, `/api/v1/documents/${documentId}`, { token: tenant.owner.token },
    undefined, "/api/v1/documents/{documentID}");
  return String(res?.document?.revision ?? "");
}

/** Device B (the owner, straight to D) saves a new version on the current head. */
export async function deviceBCommit(tenant, documentId, fixture) {
  const base = await headRevision(tenant, documentId);
  const form = new FormData();
  form.set("file", new Blob([fixture.bytes], { type: fixture.mime || "application/octet-stream" }), basename(fixture.path));
  const upKey = `g7-03a-b-up-${crypto.randomUUID()}`;
  const up = await must("device B upload", tenant.apiOrigin, `/api/v1/documents/${documentId}/uploads`, {
    method: "POST", token: tenant.owner.token, headers: { "Idempotency-Key": upKey }, form,
  }, undefined, "/api/v1/documents/{documentID}/uploads");
  const commit = await dRequest(tenant.apiOrigin, `/api/v1/documents/${documentId}/versions/commit`, {
    method: "POST",
    token: tenant.owner.token,
    headers: { "Idempotency-Key": `g7-03a-b-commit-${crypto.randomUUID()}` },
    json: { upload_id: up?.upload_id, base_revision: Number(base) },
  });
  return { status: commit.status, versionId: commit.body?.version?.id ?? null };
}

// ---- real server conditions (set, then lifted) ---------------------------------

export const removeAppFromWorkspace = (tenant) =>
  must("remove member", tenant.apiOrigin, `/api/v1/workspaces/${tenant.workspaceId}/members/${tenant.app.userId}`,
    { method: "DELETE", token: tenant.owner.token }, undefined, "/api/v1/workspaces/{workspaceID}/members/{userID}");
export const readdAppToWorkspace = (tenant) => addWorkspaceMember(tenant.apiOrigin, tenant, tenant.app);
export const archiveDocument = (tenant, documentId) =>
  must("archive document", tenant.apiOrigin, `/api/v1/documents/${documentId}/archive`,
    { method: "POST", token: tenant.owner.token }, undefined, "/api/v1/documents/{documentID}/archive");
export const restoreDocument = (tenant, documentId) =>
  must("restore document", tenant.apiOrigin, `/api/v1/documents/${documentId}/restore`,
    { method: "POST", token: tenant.owner.token }, undefined, "/api/v1/documents/{documentID}/restore");
export const deactivateApp = (tenant) =>
  must("deactivate member", tenant.apiOrigin, `/api/v1/orgs/${tenant.orgId}/members/${tenant.app.userId}/deactivate`,
    { method: "POST", token: tenant.owner.token }, undefined, "/api/v1/orgs/{org}/members/{userID}/deactivate");
export const reactivateApp = (tenant) =>
  must("reactivate member", tenant.apiOrigin, `/api/v1/orgs/${tenant.orgId}/members/${tenant.app.userId}/reactivate`,
    { method: "POST", token: tenant.owner.token }, undefined, "/api/v1/orgs/{org}/members/{userID}/reactivate");

const ADMIN_REASON = "G7-03a fault runner (UNI-1380) test condition";

/**
 * Grants the owner the platform admin role through the only path the product
 * has (`server/cmd/uniwork-admin`, CLAUDE.md › Platform Admin). Returns null on
 * success or the reason it could not (a missing tool is a precondition: BLOCKED).
 */
export function grantPlatformAdmin({ repoRoot, databaseUrl, email }) {
  if (!databaseUrl) return "no DATABASE_URL in the run's server.env (needed by uniwork-admin)";
  const res = spawnSync("go", ["run", "./cmd/uniwork-admin", "grant-platform-role", "--email", email, "--role", "admin", "--reason", ADMIN_REASON], {
    cwd: `${repoRoot}/server`,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: "utf8",
    timeout: 300_000,
  });
  if (res.error?.code === "ENOENT") return "go is not on PATH (uniwork-admin grants the platform role)";
  if (res.status !== 0) return `uniwork-admin grant-platform-role exited ${res.status}`;
  return null;
}

export const suspendOrg = (tenant) =>
  must("suspend organization", tenant.apiOrigin, `/api/v1/admin/organizations/${tenant.orgId}/suspend`,
    { method: "POST", token: tenant.owner.token, json: { reason: ADMIN_REASON } }, undefined, "/api/v1/admin/organizations/{orgID}/suspend");
export const unsuspendOrg = (tenant) =>
  must("unsuspend organization", tenant.apiOrigin, `/api/v1/admin/organizations/${tenant.orgId}/unsuspend`,
    { method: "POST", token: tenant.owner.token, json: { reason: ADMIN_REASON } }, undefined, "/api/v1/admin/organizations/{orgID}/unsuspend");
export const setSyncWrite = (tenant, enabled) =>
  must("office_sync_write override", tenant.apiOrigin, "/api/v1/admin/flags/office_sync_write/overrides", {
    method: "PUT", token: tenant.owner.token,
    json: { scope_type: "organization", scope_id: tenant.orgId, enabled, reason: ADMIN_REASON },
  }, undefined, "/api/v1/admin/flags/{key}/overrides");
export const clearSyncWrite = (tenant) =>
  must("office_sync_write override delete", tenant.apiOrigin, "/api/v1/admin/flags/office_sync_write/overrides", {
    method: "DELETE", token: tenant.owner.token,
    json: { scope_type: "organization", scope_id: tenant.orgId, reason: ADMIN_REASON },
  }, [200, 204, 404], "/api/v1/admin/flags/{key}/overrides");

/**
 * FQ-24's test setup (OQ-F3, agreed by the lead): expires the upload claims the
 * app staged in this run's organization, in the run's own database, through
 * psql. Returns `{rows}` or `{blocker}` when psql is missing.
 */
export function expireStagedClaims({ databaseUrl, orgId }) {
  if (!databaseUrl) return { blocker: "no DATABASE_URL in the run's server.env" };
  if (!/^[0-9A-Za-z]+$/.test(orgId)) return { blocker: "organization id is not a ULID" };
  const sql = `UPDATE file_upload_sessions SET claim_expires_at = clock_timestamp() - interval '1 second' `
    + `WHERE organization_id = '${orgId}' AND status = 'staged' AND claim_expires_at IS NOT NULL`;
  const res = spawnSync("psql", [databaseUrl, "-v", "ON_ERROR_STOP=1", "-qAt", "-c", sql], { encoding: "utf8", timeout: 60_000 });
  if (res.error?.code === "ENOENT") return { blocker: "psql is not on PATH (FQ-24 expires the upload claim in the run's database)" };
  if (res.status !== 0) return { error: `psql exited ${res.status}` };
  const match = /UPDATE (\d+)/.exec(res.stdout ?? "");
  return { rows: match ? Number(match[1]) : null };
}

// ---- desktop sign-in (consent approved by the account, straight to D) -------------

/**
 * Approves a pending desktop authorization attempt as `account` and returns the
 * one-time callback URL the app must receive (handler/desktop_auth.go).
 */
export async function approveDesktopAttempt(apiOrigin, account, attemptId) {
  const consent = await must("desktop consent", apiOrigin, `/api/v1/auth/desktop/authorize?attempt_id=${encodeURIComponent(attemptId)}`,
    { token: account.token }, undefined, "/api/v1/auth/desktop/authorize");
  const result = await must("desktop approve", apiOrigin, "/api/v1/auth/desktop/authorize", {
    method: "POST", token: account.token, json: { attempt_id: attemptId, csrf_token: consent?.csrf_token, decision: "approve" },
  });
  if (!result?.callback_url) throw new TenantError("desktop approve: no callback URL in the answer");
  return result.callback_url;
}
