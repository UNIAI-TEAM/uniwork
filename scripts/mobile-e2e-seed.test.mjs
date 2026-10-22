// scripts/mobile-e2e-seed.mjs: the seed the PR's signed-in device flows run against (mobile-verify.yml ›
// android-e2e), checked against a fake server that answers the way the Go handlers do. What it must hold: the
// accounts go through the real onboarding (register, verify, organization, workspace, invite, accept), the group
// has the two others a group needs, the DM is the peer's with the test account, the flows get every MAESTRO_* name
// they read, and a password never reaches the log unmasked.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { client, githubEnv, ROOM_NAME, seed } from "./mobile-e2e-seed.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** A fake UniWork API: just enough state to answer each call as the server would, and a log of what was asked. */
function fakeServer({ failOn } = {}) {
  const calls = [];
  const users = new Map(); // token -> user
  const invitations = [];
  let n = 0;
  const id = (prefix) => `${prefix}${++n}`;
  const json = (status, body) => ({ ok: status < 300, status, text: async () => JSON.stringify(body) });
  const fetchImpl = async (url, init) => {
    const { pathname } = new URL(url);
    const route = pathname.replace(/^\/api\/v1/, "");
    const method = init.method;
    const body = init.body ? JSON.parse(init.body) : undefined;
    const token = init.headers.Authorization?.replace(/^Bearer /, "");
    const me = token ? users.get(token) : undefined;
    calls.push({ method, route, body, as: me?.name });
    if (failOn === `${method} ${route.replace(/\/[a-z]+\d+/g, "/:id")}`) return json(500, { error: "boom" });
    if (route !== "/auth/register" && !me) return json(401, { error: "unauthorized" });
    if (method === "POST" && route === "/auth/register") {
      const user = { id: id("u"), email: body.email, name: body.display_name, verified: false };
      const access = id("tok");
      users.set(access, user);
      return json(201, { user: { id: user.id, email: user.email }, access_token: access });
    }
    if (method === "POST" && route === "/me/email/verify") {
      assert.equal(body.code, "654321");
      me.verified = true;
      return json(200, { user: me });
    }
    assert.ok(me.verified, `${me.name} acted before verifying (${method} ${route})`);
    if (method === "POST" && route === "/orgs") return json(201, { organization: { id: id("o"), slug: body.slug } });
    if (method === "POST" && /^\/orgs\/o\d+\/workspaces$/.test(route)) return json(201, { workspace: { id: "w1", slug: body.slug } });
    if (method === "POST" && route === "/me/onboarding/complete") return json(200, { user: me });
    if (method === "POST" && route === "/workspaces/w1/invitations") {
      for (const email of body.emails) invitations.push({ email, token: id("inv"), workspace: { id: "w1" } });
      return json(201, { invitations: [] });
    }
    if (method === "GET" && route === "/me/invitations") return json(200, { invitations: invitations.filter((i) => i.email === me.email) });
    if (method === "POST" && /^\/invitations\/inv\d+\/accept$/.test(route)) return json(200, { organization: {}, workspace: { id: "w1" } });
    if (method === "POST" && route === "/workspaces/w1/chat/groups") return json(201, { room: { id: "g1", kind: "group", name: body.name } });
    if (method === "POST" && route === "/workspaces/w1/chat/dm") return json(200, { room: { id: "d1", kind: "dm" } });
    if (method === "POST" && /^\/workspaces\/w1\/chat\/rooms\/(g1|d1)\/messages$/.test(route)) return json(201, { message: { id: id("m") } });
    return json(404, { error: `no route ${method} ${route}` });
  };
  return { calls, fetchImpl };
}

test("seeds three onboarded accounts, a group of three and the peer's DM, and hands the flows every setting they read", async () => {
  const server = fakeServer();
  const settings = await seed({ api: "http://api.test", app: "http://app.test", code: "654321", stamp: 7, fetchImpl: server.fetchImpl });
  assert.deepEqual(settings, {
    MAESTRO_API_URL: "http://api.test",
    MAESTRO_APP_URL: "http://app.test",
    MAESTRO_ORG_SLUG: "maestro-7",
    MAESTRO_WS_SLUG: "team-7",
    MAESTRO_ROOM_ID: "g1",
    MAESTRO_TEST_EMAIL: "maestro-me-7@example.com",
    MAESTRO_TEST_PASSWORD: "maestro-7-pw",
    MAESTRO_CALLER_EMAIL: "maestro-peer-7@example.com",
    MAESTRO_CALLER_PASSWORD: "maestro-7-pw",
    MAESTRO_CALLER_WS_ID: "w1",
    MAESTRO_DM_ROOM_ID: "d1",
  });
  const group = server.calls.find((c) => c.route === "/workspaces/w1/chat/groups");
  assert.equal(group.as, "Maestro An");
  assert.deepEqual(group.body, { name: ROOM_NAME, member_user_ids: ["u3", "u5"] });
  const dm = server.calls.find((c) => c.route === "/workspaces/w1/chat/dm");
  assert.deepEqual([dm.as, dm.body], ["Maestro Bình", { user_id: "u1" }]);
  // Both invited accounts accept and finish onboarding in the workspace.
  const accepted = server.calls.filter((c) => c.route.endsWith("/accept")).map((c) => c.as);
  assert.deepEqual(accepted, ["Maestro Bình", "Maestro Chi"]);
  assert.equal(server.calls.filter((c) => c.route === "/me/onboarding/complete").length, 3);
});

test("names the endpoint and the status when the server refuses a step, and nothing it sent", async () => {
  const server = fakeServer({ failOn: "POST /workspaces/:id/chat/groups" });
  await assert.rejects(
    seed({ api: "http://api.test", app: "http://app.test", code: "654321", stamp: 8, fetchImpl: server.fetchImpl }),
    (error) => /POST \/workspaces\/w1\/chat\/groups answered 500/.test(error.message) && !error.message.includes("maestro-8-pw"),
  );
});

test("a call without a body sends none, and an empty answer reads as an empty object", async () => {
  let seen;
  const call = client("http://api.test", async (url, init) => {
    seen = { url, init };
    return { ok: true, status: 204, text: async () => "" };
  });
  assert.deepEqual(await call("GET", "/me", { token: "t" }), {});
  assert.equal(seen.url, "http://api.test/api/v1/me");
  assert.equal(seen.init.body, undefined);
  assert.equal(seen.init.headers.Authorization, "Bearer t");
});

test("masks the passwords before writing the settings, and refuses a value that would split a line", () => {
  const { masks, lines } = githubEnv({ MAESTRO_TEST_PASSWORD: "p1", MAESTRO_CALLER_PASSWORD: "p2", MAESTRO_ROOM_ID: "g1" });
  assert.deepEqual(masks, ["::add-mask::p1", "::add-mask::p2"]);
  assert.deepEqual(lines, ["MAESTRO_TEST_PASSWORD=p1", "MAESTRO_CALLER_PASSWORD=p2", "MAESTRO_ROOM_ID=g1"]);
  assert.throws(() => githubEnv({ MAESTRO_ROOM_ID: "g1\nEVIL=1" }), /newline/);
});

test("every MAESTRO_* name a flow or a peer script reads is one the seed provides, or one only the nightly has", () => {
  const maestro = path.join(root, "apps/chat-mobile/maestro");
  const files = ["flows", "subflows", "scripts"].flatMap((dir) => fs.readdirSync(path.join(maestro, dir)).map((f) => path.join(maestro, dir, f)));
  const read = new Set(files.flatMap((file) => fs.readFileSync(file, "utf8").match(/MAESTRO_[A-Z_]*[A-Z]\b/g) ?? []));
  const seeded = new Set();
  for (const key of [
    "MAESTRO_API_URL",
    "MAESTRO_APP_URL",
    "MAESTRO_ORG_SLUG",
    "MAESTRO_WS_SLUG",
    "MAESTRO_ROOM_ID",
    "MAESTRO_TEST_EMAIL",
    "MAESTRO_TEST_PASSWORD",
    "MAESTRO_CALLER_EMAIL",
    "MAESTRO_CALLER_PASSWORD",
    "MAESTRO_CALLER_WS_ID",
    "MAESTRO_DM_ROOM_ID",
  ])
    seeded.add(key);
  // Set by the workflow, not the seed: the build's link scheme.
  seeded.add("MAESTRO_APP_SCHEME");
  assert.deepEqual([...read].filter((key) => !seeded.has(key)).sort(), []);
});
