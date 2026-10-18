/* global process, fetch, FormData, Blob, AbortSignal, Buffer */
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

// the loopback names the runner must not hand to Node: `localhost` resolves to ::1 first and the server listens on 127.0.0.1 only
const LOOPBACK_HOSTS = new Set(["localhost", "[::1]", "::1"]);
const BARE_LOOPBACK = /^(?:localhost|\[::1\]|::1)(:\d+)?$/;

/**
 * The origin the runner itself uses for direct D calls: `localhost` and the
 * IPv6 loopback (`[::1]`, bare `::1`) map to the IPv4 loopback, whose server
 * listener is the one that exists. Other hosts are left alone (review r2 R2-6).
 */
export function runnerApiOrigin(apiOrigin) {
  const text = String(apiOrigin ?? "").trim();
  // a bare loopback host without a scheme ("::1", "[::1]:8080", "localhost:8080"; `new URL` reads the last as a scheme)
  const bare = BARE_LOOPBACK.exec(text);
  if (bare) return `http://127.0.0.1${bare[1] ?? ""}`;
  try {
    const url = new URL(text);
    if (!LOOPBACK_HOSTS.has(url.hostname)) return apiOrigin;
    url.hostname = "127.0.0.1";
    return url.origin;
  } catch {
    return apiOrigin;
  }
}

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
    return { status: "unreachable", body: null, method, origin: hostOf(apiOrigin), error: error?.name ?? "error", message: error?.message, cause: causeOf(error) };
  }
}

const scalar = (value) => (typeof value === "string" || typeof value === "number" ? value : undefined);

function hostOf(apiOrigin) {
  try {
    return new URL(apiOrigin).host;
  } catch {
    return "invalid-origin";
  }
}

/** One level of error.cause, strings and numbers only (a fetch failure hides ECONNREFUSED here). */
function causeOf(error) {
  const cause = error?.cause;
  if (!cause || typeof cause !== "object") return undefined;
  const out = {};
  for (const key of ["name", "code", "message", "errno", "syscall", "address", "port"]) {
    if (scalar(cause[key]) !== undefined) out[key] = cause[key];
  }
  return out;
}

const causeClause = (cause) => {
  const where = cause?.address !== undefined || cause?.port !== undefined ? ` ${cause.address ?? ""}:${cause.port ?? ""}` : "";
  return `cause ${cause.code ?? cause.name ?? "error"}: ${cause.message ?? ""}${where}`;
};

/** " (<message>; cause <code|name>: <message> <address>:<port>)" for an unreachable result; "" for a result without message or cause. */
export function causeSuffix(source) {
  const message = source?.message;
  const cause = source instanceof Error ? causeOf(source) : source?.cause;
  if (!message && !cause) return "";
  return ` (${message ?? ""}${cause ? `; ${causeClause(cause)}` : ""})`;
}

/**
 * An error as one evidence line: its message once, plus its fetch cause when it
 * has one. A TenantError already carries the cause of the unreachable result it
 * was thrown for (`must`), so it is never given the clause a second time (review r2 R2-5).
 */
export function errorText(error) {
  const message = error?.message ?? String(error);
  const cause = error instanceof TenantError ? undefined : causeOf(error);
  return cause ? `${message} (${causeClause(cause)})` : message;
}

// ---- held sessions --------------------------------------------------------------
// The server's access token lives 15 minutes and is not configurable
// (`AccessTokenTTL`, server/internal/config/config.go:255), while one app run
// takes ~30 minutes. Every runner-held account (owner, app, foreign) is
// therefore renewed by signing in again: before a request once its token is
// TOKEN_RENEW_AFTER_MS old, and once more on a 401. The refresh route reads an
// HttpOnly cookie, so a fresh sign-in is the simpler equal path.
export const ACCESS_TOKEN_TTL_MS = 15 * 60_000;
export const TOKEN_RENEW_AFTER_MS = 10 * 60_000;

const canRenew = (account) => Boolean(account?.password && account?.email);

function holdToken(account, token, now) {
  account.token = token;
  account.tokenAt = now;
}

/**
 * A request as a runner-held `account`: renewed first when its token is old,
 * and on a 401 renewed ONCE and retried ONCE (a second 401 is returned as is,
 * never looped). An account without a password (a test stub) is never renewed.
 */
export async function authedRequest(apiOrigin, path, { as: account, ...options } = {}, { now = Date.now, renew = login } = {}) {
  if (!account) return dRequest(apiOrigin, path, options);
  if (canRenew(account) && now() - (account.tokenAt ?? 0) >= TOKEN_RENEW_AFTER_MS) await renew(apiOrigin, account, { now });
  const first = await dRequest(apiOrigin, path, { ...options, token: account.token });
  if (first.status !== 401 || !canRenew(account)) return first;
  await renew(apiOrigin, account, { now });
  return dRequest(apiOrigin, path, { ...options, token: account.token });
}

/** The account's bearer token, renewed first when it is old (for helpers that take a raw token). */
export async function freshToken(apiOrigin, account, { now = Date.now, renew = login } = {}) {
  if (canRenew(account) && now() - (account.tokenAt ?? 0) >= TOKEN_RENEW_AFTER_MS) await renew(apiOrigin, account, { now });
  return account.token;
}

/** Throws a TenantError naming the step, method, path template and status. */
async function must(step, apiOrigin, path, options, okStatuses = [200, 201, 202, 204], template = path) {
  const res = await authedRequest(apiOrigin, path, options);
  if (!okStatuses.includes(res.status)) {
    const code = res.body?.error?.code ?? res.body?.code ?? "";
    throw new TenantError(`${step}: ${options?.method ?? "GET"} ${template} -> ${res.status}${code ? ` ${code}` : ""}${res.status === "unreachable" ? causeSuffix(res) : ""}`);
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
  const account = { tag, email, userId, token, tokenAt: Date.now() };
  // the password stays in memory for re-login, never in the object's JSON
  Object.defineProperty(account, "password", { value: password, enumerable: false });
  return account;
}

/**
 * Signs `account` in again. An account with MFA on answers `{mfa_required,
 * mfa_token}` (handler/identity.go:44); the second step sends the TOTP code the
 * runner computes from the secret it enrolled (`totpSecret`, never printed).
 */
export async function login(apiOrigin, account, { now = Date.now } = {}) {
  const res = await must("login", apiOrigin, "/api/v1/auth/login", { method: "POST", json: { email: account.email, password: account.password } });
  let session = res;
  if (res?.mfa_required) {
    if (!account.totpSecret) throw new TenantError("login: MFA required but the runner holds no TOTP secret for the account");
    session = await must("login mfa", apiOrigin, "/api/v1/auth/mfa/verify", {
      method: "POST", json: { mfa_token: res.mfa_token, code: totpCode(account.totpSecret, now()) },
    });
  }
  if (!session?.access_token) throw new TenantError("login: no access token in the answer");
  holdToken(account, session.access_token, now());
  return account.token;
}

// ---- TOTP (RFC 6238 SHA-1, 6 digits, 30 s: server/internal/auth/totp.go) ----------

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Decode(text) {
  const clean = String(text ?? "").toUpperCase().replace(/[\s=]/g, "");
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new TenantError("totp: bad base32 secret");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** The 6-digit TOTP code for a base32 secret at `nowMs`. */
export function totpCode(secret, nowMs = Date.now(), digits = 6) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(nowMs / 30_000)));
  const sum = crypto.createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = sum[sum.length - 1] & 0x0f;
  const code = (sum.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(code).padStart(digits, "0");
}

/**
 * Turns MFA on for `account` through the product's own enrolment
 * (`POST /me/mfa/setup` then `/me/mfa/confirm`, service/mfa.go): a platform
 * role holder without MFA is refused every admin route with 403 mfa_required
 * (middleware/platform_role.go:36). The secret stays in memory only.
 */
export async function enrollTotp(apiOrigin, account, { now = Date.now } = {}) {
  if (account.totpSecret) return;
  const setup = await must("mfa setup", apiOrigin, "/api/v1/me/mfa/setup", { method: "POST", as: account, json: {} });
  if (!setup?.secret) throw new TenantError("mfa setup: no secret in the answer");
  await must("mfa confirm", apiOrigin, "/api/v1/me/mfa/confirm", { method: "POST", as: account, json: { code: totpCode(setup.secret, now()) } });
  Object.defineProperty(account, "totpSecret", { value: setup.secret, enumerable: false, configurable: true });
}

/** An organization + workspace owned by `owner`. */
export async function seedOrgWorkspace(apiOrigin, owner, label) {
  const slug = `${label}-${Date.now().toString(36)}-${crypto.randomBytes(2).toString("hex")}`.toLowerCase();
  const org = await must("create organization", apiOrigin, "/api/v1/orgs", {
    method: "POST", as: owner, json: { name: `G7-03a ${label}`, slug: `o-${slug}` },
  });
  const orgId = org?.organization?.id;
  const ws = await must("create workspace", apiOrigin, `/api/v1/orgs/${orgId}/workspaces`, {
    method: "POST", as: owner, json: { name: `G7-03a ${label}`, slug: `w-${slug}` },
  }, undefined, "/api/v1/orgs/{org}/workspaces");
  return { orgId, orgSlug: org?.organization?.slug, workspaceId: ws?.workspace?.id };
}

/** Invites `member` into the workspace and accepts as them (also re-adds after a removal). */
export async function addWorkspaceMember(apiOrigin, tenant, member, role = "member") {
  await must("invite member", apiOrigin, `/api/v1/workspaces/${tenant.workspaceId}/invitations`, {
    method: "POST", as: tenant.owner, json: { emails: [member.email], role },
  }, undefined, "/api/v1/workspaces/{workspaceID}/invitations");
  const mine = await must("list my invitations", apiOrigin, "/api/v1/me/invitations", { as: member });
  const pending = (mine?.invitations ?? []).find((inv) => inv.workspace?.id === tenant.workspaceId);
  if (!pending?.token) return false;
  await must("accept invitation", apiOrigin, `/api/v1/invitations/${pending.token}/accept`, {
    method: "POST", as: member, json: {},
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
    method: "POST", as: tenant.owner, form,
  }, undefined, "/api/v1/workspaces/{workspaceID}/documents/files");
  const doc = created?.document;
  if (!doc?.id) throw new TenantError("create file document: no document in the answer");
  return { id: doc.id, revision: String(doc.revision ?? "") };
}

export async function headRevision(tenant, documentId) {
  const res = await must("read document", tenant.apiOrigin, `/api/v1/documents/${documentId}`, { as: tenant.owner },
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
    method: "POST", as: tenant.owner, headers: { "Idempotency-Key": upKey }, form,
  }, undefined, "/api/v1/documents/{documentID}/uploads");
  const commit = await authedRequest(tenant.apiOrigin, `/api/v1/documents/${documentId}/versions/commit`, {
    method: "POST",
    as: tenant.owner,
    headers: { "Idempotency-Key": `g7-03a-b-commit-${crypto.randomUUID()}` },
    json: { upload_id: up?.upload_id, base_revision: String(base) },
  });
  return { status: commit.status, versionId: commit.body?.version?.id ?? null };
}

// ---- real server conditions (set, then lifted) ---------------------------------

/**
 * Grants `principal` (default: the app's account) a live share of `documentId`
 * at `level` (POST /documents/{id}/shares). The same principal at a new level
 * replaces the live grant in one transaction, so this is both the grant and the
 * role change (route: server/internal/handler/router/documents.go:528).
 */
export const shareDocumentLevel = (tenant, documentId, level, principal = tenant.app) =>
  must("share document", tenant.apiOrigin, `/api/v1/documents/${documentId}/shares`,
    { method: "POST", as: tenant.owner, json: { principal_type: "user", principal_id: principal.userId, level } },
    undefined, "/api/v1/documents/{documentID}/shares");

/**
 * Sets a document's visibility (`workspace` | `restricted`); needs the head
 * revision and manage (server/internal/service/document_pages.go:535-550,
 * `validDocumentVisibility` :117-122).
 */
export const setDocumentVisibility = async (tenant, documentId, visibility) =>
  must("set document visibility", tenant.apiOrigin, `/api/v1/documents/${documentId}`,
    { method: "PATCH", as: tenant.owner, json: { revision: await headRevision(tenant, documentId), visibility } },
    undefined, "/api/v1/documents/{documentID}");

export const archiveDocument = (tenant, documentId) =>
  must("archive document", tenant.apiOrigin, `/api/v1/documents/${documentId}/archive`,
    { method: "POST", as: tenant.owner }, undefined, "/api/v1/documents/{documentID}/archive");
export const restoreDocument = (tenant, documentId) =>
  must("restore document", tenant.apiOrigin, `/api/v1/documents/${documentId}/restore`,
    { method: "POST", as: tenant.owner }, undefined, "/api/v1/documents/{documentID}/restore");
/**
 * Deactivates / reactivates the app's account in the run's organization as the
 * owner (the owner deactivates any member; an admin only members:
 * handler/router/organizations.go:89-102). The `{org}` segment is the
 * organization SLUG, never its id: both handlers resolve it through
 * `Organizations.GetBySlug` (handler/organization_members.go:31-38, used by
 * `deactivateOrgMember` :95-106 and `reactivateOrgMember` :108-119), so the id
 * the runner holds answered `404 not_found` in r13 (13d3 FQ-43 exit 8, 13f2
 * FQ-50 exit 5). `seedOrgWorkspace` keeps the slug on the tenant for exactly
 * these routes.
 */
export const deactivateApp = (tenant) =>
  must("deactivate member", tenant.apiOrigin, `/api/v1/orgs/${tenant.orgSlug}/members/${tenant.app.userId}/deactivate`,
    { method: "POST", as: tenant.owner }, undefined, "/api/v1/orgs/{org}/members/{userID}/deactivate");
export const reactivateApp = (tenant) =>
  must("reactivate member", tenant.apiOrigin, `/api/v1/orgs/${tenant.orgSlug}/members/${tenant.app.userId}/reactivate`,
    { method: "POST", as: tenant.owner }, undefined, "/api/v1/orgs/{org}/members/{userID}/reactivate");

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

/**
 * FL-06's revoke on D: every live offline lease of the run's organization ends
 * (`uniwork-admin revoke-offline-leases`, server/cmd/uniwork-admin: bumps the
 * organization's policy epoch and revokes the live leases, one `office_lease.revoked`
 * outbox event each). The next renew of a lease the app holds answers 403
 * `offline_lease_revoked`. Returns `{failure, evidence}`: `failure` is null on
 * success or the reason it could not (a missing tool is a precondition: BLOCKED);
 * `evidence` is the CLI's own stdout line parsed (`<org> offline policy epoch now N,
 * K live lease(s) revoked`), kept so the row can prove the revoke hit THIS run's
 * organization and revoked something (review r2 R2-9).
 */
export function revokeOrgOfflineLeases({ repoRoot, databaseUrl, orgId }, { run = spawnSync } = {}) {
  const fail = (failure) => ({ failure, evidence: null });
  if (!databaseUrl) return fail("no DATABASE_URL in the run's server.env (needed by uniwork-admin)");
  const res = run("go", ["run", "./cmd/uniwork-admin", "revoke-offline-leases", "--org-id", orgId, "--reason", ADMIN_REASON], {
    cwd: `${repoRoot}/server`,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: "utf8",
    timeout: 300_000,
  });
  if (res.error?.code === "ENOENT") return fail("go is not on PATH (uniwork-admin revokes the offline leases)");
  if (res.status !== 0) return fail(`uniwork-admin revoke-offline-leases exited ${res.status}: ${redactUrls(String(res.stderr ?? "").trim().split("\n")[0] ?? "")}`);
  const line = redactUrls(String(res.stdout ?? "").trim().split("\n").filter(Boolean).at(-1) ?? "");
  const match = /^(\S+) offline policy epoch now (\d+), (\d+) live lease\(s\) revoked$/.exec(line);
  return { failure: null, evidence: { line, orgId: match?.[1] ?? null, epoch: match ? Number(match[2]) : null, revoked: match ? Number(match[3]) : null } };
}

export const suspendOrg = (tenant) =>
  must("suspend organization", tenant.apiOrigin, `/api/v1/admin/organizations/${tenant.orgId}/suspend`,
    { method: "POST", as: tenant.owner, json: { reason: ADMIN_REASON } }, undefined, "/api/v1/admin/organizations/{orgID}/suspend");
export const unsuspendOrg = (tenant) =>
  must("unsuspend organization", tenant.apiOrigin, `/api/v1/admin/organizations/${tenant.orgId}/unsuspend`,
    { method: "POST", as: tenant.owner, json: { reason: ADMIN_REASON } }, undefined, "/api/v1/admin/organizations/{orgID}/unsuspend");
export const setSyncWrite = (tenant, enabled) =>
  must("office_sync_write override", tenant.apiOrigin, "/api/v1/admin/flags/office_sync_write/overrides", {
    method: "PUT", as: tenant.owner,
    json: { scope_type: "organization", scope_id: tenant.orgId, enabled, reason: ADMIN_REASON },
  }, undefined, "/api/v1/admin/flags/{key}/overrides");
export const clearSyncWrite = (tenant) =>
  must("office_sync_write override delete", tenant.apiOrigin, "/api/v1/admin/flags/office_sync_write/overrides", {
    method: "DELETE", as: tenant.owner,
    json: { scope_type: "organization", scope_id: tenant.orgId, reason: ADMIN_REASON },
  }, [200, 204, 404], "/api/v1/admin/flags/{key}/overrides");

/**
 * G7-03b: the org capability `office_offline_library` (default OFF,
 * server/internal/featureflags/keys.go:60) is switched on for the FL rows only,
 * through the SAME organization-scoped admin override route the harness already
 * uses for `office_sync_write` (its own precedent). The alternative the contract
 * names - `FF_OFFICE_OFFLINE_LIBRARY=true` in the runner's ENV_FILE - also works
 * without touching the harness: start.sh copies the VM's .env into the server's
 * own cwd minus the keys the run owns (harness/lib.mjs `serverDotEnv`), and the
 * server's flag service reads `FF_<KEY>` (pkg/featureflag env_provider.go:41-46).
 * The override is chosen here because it is scoped to the run's own tenant and
 * can be lifted per row, so a non-FL row never runs with the capability on.
 */
export const setOfflineLibrary = (tenant, enabled = true) =>
  must("office_offline_library override", tenant.apiOrigin, "/api/v1/admin/flags/office_offline_library/overrides", {
    method: "PUT", as: tenant.owner,
    json: { scope_type: "organization", scope_id: tenant.orgId, enabled, reason: ADMIN_REASON },
  }, undefined, "/api/v1/admin/flags/{key}/overrides");
export const clearOfflineLibrary = (tenant) =>
  must("office_offline_library override delete", tenant.apiOrigin, "/api/v1/admin/flags/office_offline_library/overrides", {
    method: "DELETE", as: tenant.owner,
    json: { scope_type: "organization", scope_id: tenant.orgId, reason: ADMIN_REASON },
  }, [200, 204, 404], "/api/v1/admin/flags/{key}/overrides");

/**
 * The organization-scoped `office_offline_library` override of this run's
 * tenant, read back from the server (GET `/api/v1/admin/flags/{key}/overrides`,
 * admin_flags.go `adminListFlagOverrides` -> `AdminFlagOverrideDTO`): the row
 * itself, or null when the tenant carries none (review r1 R1-9).
 *
 * The read is how the runner proves a lift actually took effect instead of
 * assuming the DELETE did; an unreachable server or a refused read is reported
 * as `{error}` so the caller decides (a lift it cannot verify is a failure, not
 * a silent success).
 */
export async function readOfflineLibraryOverride(tenant) {
  const res = await authedRequest(tenant.apiOrigin, "/api/v1/admin/flags/office_offline_library/overrides", { method: "GET", as: tenant.owner });
  if (res.status !== 200) {
    const code = res.body?.error?.code ?? res.body?.code ?? "";
    return { error: `GET /api/v1/admin/flags/{key}/overrides -> ${res.status}${code ? ` ${code}` : ""}` };
  }
  const rows = Array.isArray(res.body?.overrides) ? res.body.overrides : [];
  return { override: rows.find((row) => row?.scope_type === "organization" && row?.scope_id === tenant.orgId) ?? null };
}

/**
 * FQ-24's test setup (OQ-F3, agreed by the lead): expires the upload claims the
 * app staged in this run's organization, in the run's own database, through
 * psql (table and columns: server/migrations/951_file_upload_sessions.up.sql).
 * Returns `{rows}` (>= 1) or `{blocker}`: a setup that did not age a claim
 * (no psql, a psql error, 0 rows) is BLOCKED, never a product FAIL. r4 read
 * `undefined` here because `-q` drops the `UPDATE n` tag; the count now comes
 * from a CTE.
 */
export function expireStagedClaims({ databaseUrl, orgId }, { run = spawnSync } = {}) {
  if (!databaseUrl) return { blocker: "no DATABASE_URL in the run's server.env" };
  if (!/^[0-9A-Za-z]+$/.test(String(orgId ?? ""))) return { blocker: "organization id is not a ULID" };
  const sql = "WITH aged AS (UPDATE file_upload_sessions SET claim_expires_at = clock_timestamp() - interval '1 second' "
    + `WHERE organization_id = '${orgId}' AND status = 'staged' AND claim_expires_at IS NOT NULL RETURNING 1) `
    + "SELECT count(*) FROM aged";
  const res = run("psql", [psqlUrl(databaseUrl), "-v", "ON_ERROR_STOP=1", "-qAt", "-c", sql], { encoding: "utf8", timeout: 60_000 });
  if (res.error?.code === "ENOENT") return { blocker: "psql is not on PATH (FQ-24 expires the upload claim in the run's database)" };
  if (res.error || res.status !== 0) {
    const detail = redactUrls(String(res.stderr ?? res.error?.message ?? "").trim().split(/\r?\n/)[0] ?? "");
    return { blocker: `setup claim_expired_in_run_db: psql exited ${res.status ?? res.error?.code ?? "?"}${detail ? `: ${detail}` : ""}` };
  }
  const last = String(res.stdout ?? "").trim().split(/\r?\n/).at(-1);
  const rows = /^\d+$/.test(last) ? Number(last) : null;
  if (rows === null) return { blocker: "setup claim_expired_in_run_db: psql printed no row count" };
  if (rows < 1) return { blocker: `setup claim_expired_in_run_db: 0 staged upload claims of organization ${orgId} to age` };
  return { rows };
}

/** libpq refuses pgx-only URI parameters (pool_max_conns, …) that server.env may carry. */
export function psqlUrl(databaseUrl) {
  try {
    const url = new URL(databaseUrl);
    for (const key of [...url.searchParams.keys()]) if (/^pool_/.test(key)) url.searchParams.delete(key);
    return url.toString();
  } catch {
    return databaseUrl;
  }
}

/** Removes the credentials of any connection URL from a message. */
export const redactUrls = (text) => String(text).replace(/([a-z][a-z0-9+.-]*:\/\/)[^@\s/]+@/gi, "$1<redacted>@");

// ---- desktop sign-in (consent approved by the account, straight to D) -------------

/**
 * Approves a pending desktop authorization attempt as `account` and returns the
 * one-time callback URL the app must receive (handler/desktop_auth.go).
 */
export async function approveDesktopAttempt(apiOrigin, account, attemptId) {
  const consent = await must("desktop consent", apiOrigin, `/api/v1/auth/desktop/authorize?attempt_id=${encodeURIComponent(attemptId)}`,
    { as: account }, undefined, "/api/v1/auth/desktop/authorize");
  const result = await must("desktop approve", apiOrigin, "/api/v1/auth/desktop/authorize", {
    method: "POST", as: account, json: { attempt_id: attemptId, csrf_token: consent?.csrf_token, decision: "approve" },
  });
  if (!result?.callback_url) throw new TenantError("desktop approve: no callback URL in the answer");
  return result.callback_url;
}
