/* global fetch, AbortSignal, FormData, Blob */
// Seeds the web host's account through the D API, the way the harness's
// document step does (same call table, harness/api-contract.mjs), then
// completes onboarding (the server's single "may enter a workspace" switch,
// e2e/meeting-recording-fixture.ts createRecordingAccount) and uploads every
// fixture as a file document.
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { API_CALLS, API_PREFIX, ApiError, apiPath, assertBodyKeys } from "../../harness/api-contract.mjs";

/** Not in the harness call table (the document step never onboards); the path and body are the e2e fixture's. */
const ONBOARDING_COMPLETE = { method: "POST", path: `${API_PREFIX}/me/onboarding/complete` };
export const SEED_PASSWORD = "password123";
const VERIFY_CODE = "123456";

async function call({ apiOrigin, fetchImpl, name, params, token, body, form, raw }) {
  const spec = raw ?? API_CALLS[name];
  const path = raw ? raw.path : apiPath(name, params);
  if (!raw && body !== undefined) assertBodyKeys(name, body);
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetchImpl(`${apiOrigin}${path}`, {
    method: spec.method,
    headers,
    body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok) throw new ApiError({ method: spec.method, path, status: res.status, bodyText: text });
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

/**
 * One verified, onboarded account owning one organization and one workspace,
 * with every fixture uploaded as a file document. Returns what the browser needs
 * to sign in and open each document, plus what a cleanup may remove by id.
 */
export async function seedWorkspace({ apiOrigin, fixtures, fetchImpl = fetch, now = Date.now() }) {
  const base = { apiOrigin, fetchImpl };
  const email = `g7-06-capture-${now}@example.com`;
  const stamp = now.toString(36);
  const session = await call({ ...base, name: "register", body: { email, password: SEED_PASSWORD, display_name: "G7-06 capture" } });
  const token = session.access_token;
  await call({ ...base, name: "verifyEmail", token, body: { code: VERIFY_CODE } });
  const org = await call({ ...base, name: "createOrganization", token, body: { name: "G7-06 capture", slug: `o-g706-${stamp}` } });
  const organization = { id: org.organization.id, slug: org.organization.slug };
  // {org} of this route is the organization ID (api-contract.mjs)
  const ws = await call({ ...base, name: "createWorkspace", params: { org: organization.id }, token, body: { name: "G7-06 capture", slug: `w-g706-${stamp}` } });
  const workspace = { id: ws.workspace.id, slug: ws.workspace.slug };
  await call({ ...base, raw: ONBOARDING_COMPLETE, token, body: { completion_path: "full", workspace_id: workspace.id } });
  const documents = {};
  for (const fixture of fixtures) {
    const form = new FormData();
    const name = basename(fixture.path);
    form.append("file", new Blob([readFileSync(fixture.absPath)], { type: fixture.mime ?? "application/octet-stream" }), name);
    form.append("title", name);
    const created = await call({ ...base, name: "createFileDocument", params: { workspaceID: workspace.id }, token, form });
    documents[fixture.id] = created.document.id;
  }
  return { email, password: SEED_PASSWORD, token, userId: session.user?.id ?? null, organization, workspace, documents };
}

/**
 * Asks the server to erase the seeded organization (queued, 5 days; the account
 * stays its owner until then, the same leftover the document step reports).
 * Never throws: a cleanup says nothing about the shots.
 */
export async function cleanupSeed({ apiOrigin, seed, fetchImpl = fetch }) {
  try {
    await call({ apiOrigin, fetchImpl, name: "requestOrganizationDeletion", params: { orgID: seed.organization.id }, token: seed.token, body: { confirm_slug: seed.organization.slug } });
    return { ok: true, leftover: `organization ${seed.organization.id} (erasure queued) and its owner account ${seed.email}` };
  } catch (error) {
    return { ok: false, leftover: `organization ${seed.organization.id} and account ${seed.email} (deletion request failed: ${error.message})` };
  }
}
