// harness/world.mjs (G8-19, UNI-1414) against a stub D server: the seeding
// order, the invite -> register -> verify -> accept token flow, the raw SQL
// second org for M behind G819_ALLOW_SQL_MEMBERSHIP=1, the 0600 cache and its
// token refresh, cleanup leftovers, and that nothing secret is printed.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, before, beforeEach, test } from "node:test";

import { SQL_MEMBERSHIP_BLOCKER, WORLD_FILE, loadWorld, seedWorld } from "./world.mjs";

// ---- a stub D server that keeps just enough state ---------------------------

let server;
let origin;
let log;
let state;
let failNext;

function resetState() {
  log = [];
  failNext = {};
  state = { seq: 0, users: new Map(), byToken: new Map(), orgs: new Map(), invitations: [], docs: new Map(), shares: new Map(), deletions: [] };
}
const nextId = (prefix) => `${prefix}${String((state.seq += 1)).padStart(4, "0")}`;

function handle(method, path, auth, body) {
  const me = state.byToken.get((auth ?? "").replace(/^Bearer /, ""));
  const route = `${method} ${path.replace(/\/[A-Z]\d{4}(?=\/|$)/g, "/:id").replace(/\/invitations\/inv-[^/]+/, "/invitations/:token")}`;
  log.push({ route, user: me?.email ?? null, body });
  if (failNext[route]) {
    const f = failNext[route];
    delete failNext[route];
    return f;
  }
  const issue = (u) => {
    const token = `tok-${nextId("T")}`;
    state.byToken.set(token, u);
    return token;
  };
  switch (true) {
    case method === "POST" && path === "/api/v1/auth/register": {
      const u = { id: nextId("U"), email: body.email, password: body.password, displayName: body.display_name };
      state.users.set(u.email, u);
      return [201, { access_token: issue(u), user: { id: u.id } }];
    }
    case method === "POST" && path === "/api/v1/auth/login": {
      const u = state.users.get(body.email);
      if (!u || u.password !== body.password) return [401, { error: "invalid_credentials" }];
      return [200, { access_token: issue(u), user: { id: u.id } }];
    }
    case method === "POST" && path === "/api/v1/me/email/verify":
      return body.code === "123456" ? [200, {}] : [400, { error: "bad_code" }];
    case method === "POST" && path === "/api/v1/orgs": {
      const o = { id: nextId("O"), slug: body.slug, owner: me.email, workspaces: [] };
      state.orgs.set(o.id, o);
      return [201, { organization: { id: o.id, slug: o.slug } }];
    }
    case method === "POST" && /^\/api\/v1\/orgs\/[^/]+\/workspaces$/.test(path): {
      const ws = { id: nextId("W"), slug: body.slug };
      state.orgs.get(path.split("/")[4]).workspaces.push(ws);
      return [201, { workspace: ws }];
    }
    case method === "POST" && path === "/api/v1/me/onboarding/complete":
      return [200, { user: { id: me.id } }];
    case method === "POST" && /^\/api\/v1\/workspaces\/[^/]+\/invitations$/.test(path): {
      const inv = { token: `inv-${nextId("I")}`, email: body.email, workspaceId: path.split("/")[4], role: body.role };
      state.invitations.push(inv);
      return [201, { invitations: [{ id: inv.token }] }];
    }
    case method === "GET" && path === "/api/v1/me/invitations":
      return [200, { invitations: state.invitations.filter((i) => i.email === me.email && !i.accepted).map((i) => ({ id: i.token, token: i.token, workspace: { id: i.workspaceId } })) }];
    case method === "POST" && /^\/api\/v1\/invitations\/[^/]+\/accept$/.test(path): {
      const inv = state.invitations.find((i) => i.token === path.split("/")[4]);
      inv.accepted = true;
      return [200, { organization: {}, workspace: { id: inv.workspaceId } }];
    }
    case method === "POST" && /^\/api\/v1\/workspaces\/[^/]+\/documents\/files$/.test(path): {
      const d = { id: nextId("D"), versionId: nextId("V") };
      state.docs.set(d.id, d);
      return [201, { document: { id: d.id, file: { version_id: d.versionId } } }];
    }
    case method === "POST" && /^\/api\/v1\/documents\/[^/]+\/shares$/.test(path): {
      const s = { id: nextId("S"), ...body };
      state.shares.set(s.id, s);
      return [201, { share: { id: s.id } }];
    }
    case method === "DELETE" && /^\/api\/v1\/documents\/[^/]+\/shares\/[^/]+$/.test(path):
      return [204, null];
    case method === "POST" && /^\/api\/v1\/orgs\/[^/]+\/members\/[^/]+\/deactivate$/.test(path):
      return [200, { member: {} }];
    case method === "POST" && /^\/api\/v1\/orgs\/[^/]+\/privacy\/deletion$/.test(path):
      state.deletions.push(path.split("/")[4]);
      return [202, {}];
    case method === "POST" && path === "/api/v1/me/delete":
      return [200, {}];
    default:
      return [404, { error: `stub has no ${method} ${path}` }];
  }
}

before(async () => {
  server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks);
      let body = null;
      if ((req.headers["content-type"] ?? "").includes("application/json")) body = JSON.parse(raw.toString("utf8") || "null");
      else if (raw.length) body = { multipart: raw.length };
      const [status, payload] = handle(req.method, req.url.split("?")[0], req.headers.authorization, body);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(payload === null ? "" : JSON.stringify(payload));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((resolve) => server.close(resolve)));

let runDir;
let sql;
let printed;
const origLog = console.log;
const origErr = console.error;
const origWarn = console.warn;
beforeEach(() => {
  resetState();
  runDir = mkdtempSync(join(tmpdir(), "g819-world-"));
  sql = { queries: [], connected: 0, ended: 0, fail: false };
  printed = [];
  console.log = (...a) => printed.push(a.join(" "));
  console.error = (...a) => printed.push(a.join(" "));
  console.warn = (...a) => printed.push(a.join(" "));
});
afterEach(() => {
  console.log = origLog;
  console.error = origErr;
  console.warn = origWarn;
  rmSync(runDir, { recursive: true, force: true });
});

const sqlClientFactory = (dbUrl) => ({
  dbUrl,
  async connect() {
    sql.connected += 1;
  },
  async query(text, params) {
    if (sql.fail) throw new Error(`connection to ${dbUrl} refused`);
    sql.queries.push({ text: text.replace(/\s+/g, " ").trim(), params });
    return { rowCount: 1 };
  },
  async end() {
    sql.ended += 1;
  },
});

const seed = (env = { G819_ALLOW_SQL_MEMBERSHIP: "1" }, extra = {}) =>
  seedWorld({ runDir, apiOrigin: origin, dbUrl: "postgres://u:SECRETPW@db:5432/x", env, sqlClientFactory, now: 1_700_000_000_000, ...extra });

test("seeding order: A builds X/W1/W2, invites B and C to W2 who accept, M builds Y/WY, then M joins X/W1 by SQL", async () => {
  const world = await seed();
  const routes = log.map((l) => `${l.user ?? "-"} ${l.route}`);
  const firstOf = (pattern) => routes.findIndex((r) => pattern.test(r));
  // A first: register, verify, org, two workspaces, onboarding
  assert.match(routes[0], /^- POST \/api\/v1\/auth\/register$/);
  assert.ok(firstOf(/POST \/api\/v1\/orgs$/) < firstOf(/workspaces\/:id\/invitations/));
  // B and C are invited by A before they register, accept with the token from GET /me/invitations
  for (const key of ["B", "C"]) {
    const email = world.users[key].email;
    const invite = log.findIndex((l) => l.route === "POST /api/v1/workspaces/:id/invitations" && l.body.email === email);
    const accept = log.findIndex((l) => l.user === email && l.route === "POST /api/v1/invitations/:token/accept");
    const listed = log.findIndex((l) => l.user === email && l.route === "GET /api/v1/me/invitations");
    const verified = log.findIndex((l) => l.user === email && l.route === "POST /api/v1/me/email/verify");
    assert.ok(invite >= 0 && invite < verified && verified < listed && listed < accept, `${key}: invite ${invite} verify ${verified} list ${listed} accept ${accept}`);
    assert.equal(log[invite].user, world.users.A.email);
    assert.equal(log[invite].body.role, "member");
    const onboarding = log.find((l) => l.user === email && l.route === "POST /api/v1/me/onboarding/complete");
    assert.deepEqual(onboarding.body, { completion_path: "invite_accept", workspace_id: world.orgs.X.workspaces.W2.id });
  }
  // M owns Y through the API
  const mOrg = log.find((l) => l.user === world.users.M.email && l.route === "POST /api/v1/orgs");
  assert.ok(mOrg);
  assert.equal(world.orgs.Y.ownerKey, "M");
  assert.deepEqual(Object.keys(world.orgs.X.workspaces).sort(), ["W1", "W2"]);
  assert.deepEqual(Object.keys(world.orgs.Y.workspaces), ["WY"]);
});

test("the second org for M is the TestIsolationMatrix insert shape, only with G819_ALLOW_SQL_MEMBERSHIP=1", async () => {
  const world = await seed();
  assert.equal(sql.queries.length, 2);
  assert.match(sql.queries[0].text, /^INSERT INTO organization_members \(organization_id, user_id, role\) VALUES \(\$1, \$2, 'member'\)/);
  assert.deepEqual(sql.queries[0].params, [world.orgs.X.id, world.users.M.id]);
  assert.match(sql.queries[1].text, /^INSERT INTO workspace_members \(workspace_id, user_id, role, organization_id\) VALUES \(\$1, \$2, 'member', \$3\)/);
  assert.deepEqual(sql.queries[1].params, [world.orgs.X.workspaces.W1.id, world.users.M.id, world.orgs.X.id]);
  assert.equal(sql.connected, 1);
  assert.equal(sql.ended, 1);
  assert.equal(world.users.M.multiOrg.status, "SEEDED");
  assert.equal(world.users.M.multiOrg.via, "sql");
  assert.match(world.users.M.multiOrg.reason, /ADR 0032/);
});

test("without G819_ALLOW_SQL_MEMBERSHIP=1 no SQL runs and M carries the BLOCKED marker; the rest of the world is seeded", async () => {
  const world = await seed({});
  assert.equal(sql.queries.length, 0);
  assert.equal(sql.connected, 0);
  assert.deepEqual(world.users.M.multiOrg, { status: "BLOCKED", blocker: SQL_MEMBERSHIP_BLOCKER });
  assert.ok(world.users.B.id && world.orgs.Y.id);
});

test("a failing SQL insert is a BLOCKED marker with a redacted reason, never the database URL", async () => {
  sql.fail = true;
  const world = await seed();
  assert.equal(world.users.M.multiOrg.status, "BLOCKED");
  assert.ok(!world.users.M.multiOrg.blocker.includes("SECRETPW"), world.users.M.multiOrg.blocker);
  assert.equal(sql.ended, 1);
});

test("the world is cached 0600 in $runDir/g8-19-world.json, reused with fresh tokens, and loadWorld reads it", async () => {
  const first = await seed();
  const file = join(runDir, WORLD_FILE);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(loadWorld(runDir).users.A.id, first.users.A.id);
  const oldToken = first.users.B.token;
  log.length = 0;
  const again = await seed();
  assert.equal(again.users.B.id, first.users.B.id);
  assert.notEqual(again.users.B.token, oldToken, "a reused world logs every user in again (15 min access tokens)");
  assert.ok(log.every((l) => l.route === "POST /api/v1/auth/login"), JSON.stringify(log.map((l) => l.route)));
  assert.equal(log.length, 4);
  assert.equal(JSON.parse(readFileSync(file, "utf8")).users.B.token, again.users.B.token);
  // another API origin is not reused
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), apiOrigin: "http://elsewhere" }));
  log.length = 0;
  await seed();
  assert.ok(log.some((l) => l.route === "POST /api/v1/auth/register"));
  assert.equal(loadWorld(join(runDir, "nope")), null);
});

test("refreshTokens logs every user in again and the sessions pick the new token up", async () => {
  const world = await seed();
  const s = world.session("A");
  const before_ = world.users.A.token;
  await world.refreshTokens();
  assert.notEqual(world.users.A.token, before_);
  assert.equal(s.user.token, world.users.A.token);
});

test("upload, share, revokeShare, deactivate go to the server as the named user and land in the record", async () => {
  const world = await seed();
  const up = await world.upload("A", "W1", "fx-docx-report-vi");
  assert.match(up.documentId, /^D/);
  assert.match(up.versionId, /^V/);
  assert.equal(up.filename, "fx-docx-report-vi.docx");
  assert.deepEqual(
    { ...world.docs[up.documentId], filename: undefined },
    { documentId: up.documentId, versionId: up.versionId, workspaceKey: "W1", orgKey: "X", ownerKey: "A", fixtureId: "fx-docx-report-vi", filename: undefined },
  );
  const upload = log.find((l) => l.route === "POST /api/v1/workspaces/:id/documents/files");
  assert.equal(upload.user, world.users.A.email);
  assert.ok(upload.body.multipart > 1000);
  const { shareId } = await world.share("A", up.documentId, world.users.B.id, "view");
  assert.deepEqual(log.at(-1).body, { principal_type: "user", principal_id: world.users.B.id, level: "view" });
  assert.equal(world.shares[shareId].revoked, false);
  assert.equal((await world.revokeShare("A", up.documentId, shareId)).status, 204);
  assert.equal(world.shares[shareId].revoked, true);
  assert.equal((await world.deactivate("A", "X", world.users.C.id)).status, 200);
  assert.equal(log.at(-1).route, `POST /api/v1/orgs/${world.orgs.X.slug}/members/:id/deactivate`);
  await assert.rejects(world.upload("A", "WZ", "fx-docx-report-vi"), /no workspace WZ/);
});

test("a seeding step the server refuses throws an ApiError naming the call, with no token in it", async () => {
  failNext["POST /api/v1/orgs"] = [403, { error: "forbidden", access_token: "LEAKME" }];
  await assert.rejects(seed(), (err) => {
    assert.match(err.message, /POST \/api\/v1\/orgs -> 403/);
    assert.ok(!err.message.includes("LEAKME"));
    return true;
  });
});

test("cleanup asks each owner to delete its org, deletes every account, removes the cache and lists leftovers", async () => {
  const world = await seed();
  failNext["POST /api/v1/me/delete"] = [500, { error: "boom" }];
  const { leftovers } = await world.cleanup();
  assert.deepEqual(state.deletions.sort(), [world.orgs.X.id, world.orgs.Y.id].sort());
  assert.equal(leftovers.length, 2, JSON.stringify(leftovers));
  assert.ok(leftovers.some((l) => /delete account/.test(l)));
  assert.ok(leftovers.some((l) => /organization_members/.test(l)), "the SQL membership row is reported, cleanup never deletes by SQL");
  assert.equal(loadWorld(runDir), null);
});

test("nothing secret is printed: no password, token, email or database URL", async () => {
  const world = await seed();
  await world.upload("A", "W1", "fx-xlsx-revenue-xyz");
  await world.cleanup();
  const out = printed.join("\n");
  for (const u of Object.values(world.users)) {
    for (const secret of [u.password, u.token, u.email]) assert.ok(!out.includes(secret), `printed ${secret}`);
  }
  assert.ok(!out.includes("SECRETPW"));
});
