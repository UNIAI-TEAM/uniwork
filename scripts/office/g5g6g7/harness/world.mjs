// G8-19 (UNI-1414) world seed: users A, B, C, M; org X (W1, W2) owned by A;
// org Y (WY) owned by M, who also joins X/W1 by a test-only SQL insert.
// Everything else goes through the D API the way a person would: register,
// verify (dev code 123456), create, invite, accept, onboard. The record is
// cached 0600 in the run dir and is the only place a password or token is
// written; nothing here prints one. Contract: g8-contract.md §2-§3.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ApiError, G8_API_CALLS, apiPath, redact } from "./api-contract.mjs";
import { session as apiSession } from "./api.mjs";
import { redactSignInError } from "./app-steps.mjs";
import { loadVerifiedFixture } from "./fixture-files.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = resolve(HERE, "../../../..");

export const WORLD_FILE = "g8-19-world.json";
export const SQL_MEMBERSHIP_ENV = "G819_ALLOW_SQL_MEMBERSHIP";
export const SQL_MEMBERSHIP_REASON =
  "test seed only: ADR 0032 refuses a second active organization through every API, so M's org X membership is a raw SQL insert (the TestIsolationMatrix shape)";
export const SQL_MEMBERSHIP_BLOCKER =
  "G819_ALLOW_SQL_MEMBERSHIP is not 1: a second active organization cannot be made through the API (ADR 0032)";

const VERIFY_CODE = "123456";

/** `pg` from e2e/node_modules (e2e/package.json), as the e2e fixtures use it. */
function defaultSqlClientFactory(repoRoot) {
  return (dbUrl) => {
    const req = createRequire(join(repoRoot, "e2e", "package.json"));
    const { Client } = req("pg");
    return new Client({ connectionString: dbUrl });
  };
}

function safeMessage(err) {
  return redactSignInError(redact(err instanceof Error ? err.message : String(err)));
}

/** The cached world record of `runDir`, or null. */
export function loadWorld(runDir) {
  const file = join(runDir, WORLD_FILE);
  if (!existsSync(file)) return null;
  try {
    const record = JSON.parse(readFileSync(file, "utf8"));
    return record && record.users && record.orgs ? record : null;
  } catch {
    return null;
  }
}

function saveWorld(runDir, record) {
  mkdirSync(runDir, { recursive: true });
  const file = join(runDir, WORLD_FILE);
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
}

/** Seeds (or reuses) the G8-19 world and returns it with its methods (contract §3). */
export async function seedWorld({
  runDir,
  apiOrigin,
  dbUrl = process.env.G819_DATABASE_URL ?? process.env.DATABASE_URL,
  fetchImpl = fetch,
  sqlClientFactory = null,
  env = process.env,
  now = Date.now(),
  reuse = true,
  repoRoot = DEFAULT_REPO_ROOT,
} = {}) {
  if (!runDir) throw new Error("seedWorld: runDir is required");
  if (!apiOrigin) throw new Error("seedWorld: apiOrigin is required");
  const sessionOf = (user) => apiSession(user, { apiOrigin, fetchImpl });
  /** a seeding call must succeed: anything else is an ApiError (seeding is not under test); resolves {status, body} */
  const must = async (user, name, params, body, opts) => {
    const res = await sessionOf(user).call(name, params, body, opts);
    if (!res.ok) {
      throw new ApiError({
        method: G8_API_CALLS[name].method,
        path: apiPath(name, params, G8_API_CALLS),
        status: res.status,
        bodyText: res.error ?? JSON.stringify(res.body ?? ""),
      });
    }
    return { status: res.status, body: res.body ?? {} };
  };

  let record = reuse ? loadWorld(runDir) : null;
  if (record && record.apiOrigin !== apiOrigin) record = null;

  if (record) {
    await loginAll(record, must);
    saveWorld(runDir, record);
  } else {
    record = await seedFresh({ apiOrigin, must, env, now, dbUrl, sqlClientFactory: sqlClientFactory ?? defaultSqlClientFactory(repoRoot) });
    saveWorld(runDir, record);
  }
  return bindWorld(record, { runDir, must, sessionOf, repoRoot });
}

async function loginAll(record, must) {
  for (const user of Object.values(record.users)) {
    const out = (await must({}, "login", {}, { email: user.email, password: user.password })).body;
    user.token = out.access_token;
  }
}

async function seedFresh({ apiOrigin, must, env, now, dbUrl, sqlClientFactory }) {
  const stamp = `${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const record = { apiOrigin, seededAt: new Date(now).toISOString(), users: {}, orgs: {}, docs: {}, shares: {} };

  const register = async (key) => {
    const user = {
      key,
      id: "",
      email: `g8-19-${key.toLowerCase()}-${stamp}@example.com`,
      password: `g819-${key}-${Math.random().toString(36).slice(2, 12)}`,
      token: "",
      displayName: `G8-19 ${key}`,
    };
    const out = (await must({}, "register", {}, { email: user.email, password: user.password, display_name: user.displayName })).body;
    user.token = out.access_token;
    user.id = out.user?.id ?? "";
    await must(user, "verifyEmail", {}, { code: VERIFY_CODE });
    record.users[key] = user;
    return user;
  };
  const createOrg = async (owner, orgKey, wsKeys) => {
    const slug = `g819-${orgKey.toLowerCase()}-${stamp}`;
    const org = (await must(owner, "createOrganization", {}, { name: `G8-19 ${orgKey}`, slug })).body.organization;
    const workspaces = {};
    for (const wsKey of wsKeys) {
      const wsSlug = `${wsKey.toLowerCase()}-${stamp}`;
      const ws = (await must(owner, "createWorkspace", { org: org.id }, { name: `G8-19 ${wsKey}`, slug: wsSlug })).body.workspace;
      workspaces[wsKey] = { id: ws.id, slug: ws.slug ?? wsSlug };
    }
    record.orgs[orgKey] = { id: org.id, slug: org.slug ?? slug, ownerKey: owner.key, workspaces };
    await must(owner, "completeOnboarding", {}, { completion_path: "full", workspace_id: workspaces[wsKeys[0]].id });
  };
  const joinByInvite = async (owner, key, orgKey, wsKey) => {
    const ws = record.orgs[orgKey].workspaces[wsKey];
    const email = `g8-19-${key.toLowerCase()}-${stamp}@example.com`;
    await must(owner, "createInvitation", { workspaceID: ws.id }, { email, role: "member" });
    const user = await register(key);
    const pending = (await must(user, "myInvitations", {}, undefined)).body.invitations ?? [];
    const invitation = pending.find((i) => i.workspace?.id === ws.id) ?? pending[0];
    if (!invitation?.token) throw new Error(`seedWorld: ${key} has no pending invitation to ${wsKey}`);
    await must(user, "acceptInvitation", { token: invitation.token }, undefined);
    await must(user, "completeOnboarding", {}, { completion_path: "invite_accept", workspace_id: ws.id });
  };

  const a = await register("A");
  await createOrg(a, "X", ["W1", "W2"]);
  await joinByInvite(a, "B", "X", "W2");
  await joinByInvite(a, "C", "X", "W2");
  const m = await register("M");
  await createOrg(m, "Y", ["WY"]);
  m.multiOrg = await joinSecondOrgBySql({ env, dbUrl, sqlClientFactory, userId: m.id, org: record.orgs.X, wsKey: "W1" });
  return record;
}

async function joinSecondOrgBySql({ env, dbUrl, sqlClientFactory, userId, org, wsKey }) {
  if (env?.[SQL_MEMBERSHIP_ENV] !== "1") return { status: "BLOCKED", blocker: SQL_MEMBERSHIP_BLOCKER };
  if (!dbUrl) return { status: "BLOCKED", blocker: "no G819_DATABASE_URL/DATABASE_URL for the test-seed SQL membership" };
  const client = sqlClientFactory(dbUrl);
  try {
    await client.connect();
    await client.query("INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'member')", [org.id, userId]);
    await client.query("INSERT INTO workspace_members (workspace_id, user_id, role, organization_id) VALUES ($1, $2, 'member', $3)", [
      org.workspaces[wsKey].id,
      userId,
      org.id,
    ]);
    return { status: "SEEDED", via: "sql", reason: SQL_MEMBERSHIP_REASON };
  } catch (err) {
    return { status: "BLOCKED", blocker: `test-seed SQL membership failed: ${safeMessage(err).replace(/postgres(?:ql)?:\/\/\S+/gi, "<db>")}` };
  } finally {
    await Promise.resolve()
      .then(() => client.end())
      .catch(() => {});
  }
}

function bindWorld(record, { runDir, must, sessionOf, repoRoot }) {
  const user = (key) => {
    const u = record.users[key];
    if (!u) throw new Error(`no user ${key} in the world`);
    return u;
  };
  const org = (key) => {
    const o = record.orgs[key];
    if (!o) throw new Error(`no org ${key} in the world`);
    return o;
  };
  const workspace = (orgKey, wsKey) => {
    const w = org(orgKey).workspaces[wsKey];
    if (!w) throw new Error(`no workspace ${wsKey} in org ${orgKey}`);
    return w;
  };
  const persist = () => saveWorld(runDir, record);

  return {
    record,
    users: record.users,
    orgs: record.orgs,
    docs: record.docs,
    shares: record.shares,
    user,
    org,
    workspace,
    session: (key) => sessionOf(user(key)),
    async refreshTokens() {
      await loginAll(record, must);
      persist();
    },
    async upload(userKey, wsKey, fixtureId, { title } = {}) {
      const owner = user(userKey);
      const orgKey = Object.keys(record.orgs).find((k) => wsKey in record.orgs[k].workspaces);
      if (!orgKey) throw new Error(`no workspace ${wsKey} in the world`);
      const fixture = loadVerifiedFixture(fixtureId, repoRoot);
      const filename = basename(fixture.entry.path);
      const form = new FormData();
      form.append("file", new Blob([fixture.bytes]), filename);
      form.append("title", title ?? filename);
      const out = (await must(owner, "createFileDocument", { workspaceID: workspace(orgKey, wsKey).id }, undefined, { form })).body;
      const doc = {
        documentId: out.document?.id ?? "",
        versionId: out.document?.file?.version_id ?? "",
        workspaceKey: wsKey,
        orgKey,
        ownerKey: userKey,
        fixtureId,
        filename,
      };
      record.docs[doc.documentId] = doc;
      persist();
      return { documentId: doc.documentId, versionId: doc.versionId, filename };
    },
    async share(ownerKey, documentId, userId, level) {
      const out = (await must(user(ownerKey), "createDocumentShare", { documentID: documentId }, { principal_type: "user", principal_id: userId, level })).body;
      const shareId = out.share?.id ?? "";
      record.shares[shareId] = { shareId, documentId, userId, level, revoked: false };
      persist();
      return { shareId };
    },
    async revokeShare(ownerKey, documentId, shareId) {
      const res = await must(user(ownerKey), "revokeDocumentShare", { documentID: documentId, shareID: shareId });
      if (record.shares[shareId]) record.shares[shareId].revoked = true;
      persist();
      return { status: res.status };
    },
    async deactivate(ownerKey, orgKey, userId) {
      const res = await must(user(ownerKey), "deactivateOrgMember", { org: org(orgKey).slug, userID: userId });
      return { status: res.status };
    },
    async cleanup() {
      const leftovers = [];
      for (const [orgKey, o] of Object.entries(record.orgs)) {
        const owner = record.users[o.ownerKey];
        const res = owner ? await sessionOf(owner).call("requestOrganizationDeletion", { orgID: o.id }, { confirm_slug: o.slug }) : { ok: false, status: 0 };
        if (!res.ok) leftovers.push(`org ${orgKey}: deletion request answered ${res.status}`);
      }
      for (const [key, u] of Object.entries(record.users)) {
        const res = await sessionOf(u).call("deleteAccount", {}, { password: u.password });
        if (!res.ok) leftovers.push(`user ${key}: delete account answered ${res.status}`);
      }
      if (record.users.M?.multiOrg?.status === "SEEDED") {
        leftovers.push("org X organization_members/workspace_members row of M (test-seed SQL; cleanup never deletes by SQL, the org deletion covers it)");
      }
      try {
        rmSync(join(runDir, WORLD_FILE), { force: true });
      } catch {
        leftovers.push(`cache ${WORLD_FILE}`);
      }
      return { leftovers };
    },
  };
}
