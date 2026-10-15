// harness/api.mjs (G8-19, UNI-1414): the G8 API rows against the server's own
// router, handlers and SDI structs (the same check api-contract.test.mjs runs
// for the document step), and the session transport: a 4xx or a network
// failure is an answer, never a throw; comment_id rides on office/sessions;
// nothing secret leaks into an error.
import assert from "node:assert/strict";
import http from "node:http";
import { after, before, test } from "node:test";

import { API_PREFIX, G8_API_CALLS, G8_CALLS } from "./api-contract.mjs";
import { createApi, session } from "./api.mjs";
import { paramKind, pathParamTarget, routeCatalogue, sdiFields } from "./server-contract.helper.mjs";

const routes = routeCatalogue();

for (const [name, call] of Object.entries(G8_CALLS)) {
  test(`G8 row ${name}: ${call.method} ${call.path} is registered and its params/body match the server`, () => {
    const route = routes.find((r) => r.method === call.method && r.path === call.path);
    assert.ok(route, `the router registers no ${call.method} ${API_PREFIX}${call.path}`);
    const placeholders = [...call.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    assert.deepEqual(placeholders.sort(), Object.keys(call.params ?? {}).sort(), `${name}: path params and the table's params differ`);
    for (const [param, kind] of Object.entries(call.params ?? {})) {
      const target = pathParamTarget(route.handler, param);
      if (target) {
        const seen = paramKind(target.name) ?? (/token/i.test(target.name ?? "") ? "token" : null);
        assert.equal(seen, kind, `${name}: {${param}} reaches ${target.method} as "${target.name}"`);
      } else if (kind === "token") {
        assert.match(param, /token/i);
      } else if (kind === "slug") {
        // the handler resolves the slug itself (orgIDFromSlug), not through a service param
        assert.equal(param, "org", `${name}: only {org} is resolved from a slug by the handler`);
      } else {
        assert.match(param, /ID$/, `${name}: cannot see where {${param}} goes and its name does not say id`);
        assert.equal(kind, "id");
      }
    }
    if (call.sdi) {
      const fields = sdiFields(call.sdi);
      for (const key of call.body) assert.ok(key in fields, `${call.sdi} has no json field ${key}`);
      for (const [key, { required }] of Object.entries(fields)) {
        if (required) assert.ok(call.body.includes(key), `${call.sdi} requires ${key}`);
      }
    }
  });
}

test("deactivateOrgMember takes the org slug (the handler resolves it with orgIDFromSlug)", async () => {
  const { handlerBody } = await import("./server-contract.helper.mjs");
  assert.match(handlerBody("DeactivateOrgMember"), /orgIDFromSlug\(w, r\)/);
  assert.equal(G8_CALLS.deactivateOrgMember.params.org, "slug");
});

test("mintLaunch may send comment_id, an optional CreateOfficeLaunchSessionSDI field", () => {
  assert.ok(G8_API_CALLS.mintLaunch.body.includes("comment_id"));
  assert.equal(sdiFields("CreateOfficeLaunchSessionSDI").comment_id.required, false);
});

test("G8_API_CALLS holds the document-step, tracer and G8 rows, each once", () => {
  for (const name of ["register", "mintLaunch", "getDesktopConsent", "getDocument", "createDocumentComment", "acceptInvitation"]) {
    assert.ok(name in G8_API_CALLS, name);
  }
});

// ---- transport, against a local stub server ---------------------------------

let server;
let origin;
const seen = [];
before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization ?? null, body });
      if (req.url.startsWith("/api/v1/documents/missing")) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end('{"error":"not_found","access_token":"SHOULD.NOT.LEAK"}');
        return;
      }
      if (req.url.startsWith("/api/v1/me/notifications/unread-count")) {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("not json");
        return;
      }
      if (req.method === "DELETE") {
        res.writeHead(204);
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ echo: body ? JSON.parse(body) : null }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((resolve) => server.close(resolve)));

const userB = { key: "B", id: "user-B", token: "TOKEN-B-SECRET" };

test("a 4xx is returned as {status, body}, never thrown, and carries no token in error", async () => {
  const s = createApi({ apiOrigin: origin }).session(userB);
  const res = await s.call("getDocument", { documentID: "missing" });
  assert.equal(res.status, 404);
  assert.equal(res.ok, false);
  assert.equal(res.body.error, "not_found");
  assert.equal(s.userKey, "B");
  assert.equal(seen.at(-1).auth, "Bearer TOKEN-B-SECRET");
});

test("2xx JSON is parsed, an empty body is null, a non-JSON body is {rawText}", async () => {
  const s = session(userB, { apiOrigin: origin });
  const created = await s.call("createDocumentComment", { documentID: "d1" }, { body: "xin chào", kind: "comment" });
  assert.deepEqual([created.status, created.ok, created.body.echo], [200, true, { body: "xin chào", kind: "comment" }]);
  const deleted = await s.call("deleteDocumentComment", { documentID: "d1", commentID: "c1" });
  assert.deepEqual([deleted.status, deleted.body], [204, null]);
  const odd = await s.call("unreadNotificationCount");
  assert.deepEqual(odd.body, { rawText: "not json" });
});

test("comment_id passes through on office/sessions, and query params are sent", async () => {
  const s = session(userB, { apiOrigin: origin });
  await s.call("mintLaunch", { documentID: "d1" }, { operation: "edit", deployment_id: "default", client_id: "uniwork-office-dev", comment_id: "c-7" });
  assert.equal(seen.at(-1).url, "/api/v1/documents/d1/office/sessions");
  assert.equal(JSON.parse(seen.at(-1).body).comment_id, "c-7");
  await s.call("listDocumentComments", { documentID: "d1" }, undefined, { query: { kind: "discussion", since_token: "" } });
  assert.equal(seen.at(-1).url, "/api/v1/documents/d1/comments?kind=discussion");
});

test("a network failure or a timeout resolves {status: 0, ok: false, body: null, error}", async () => {
  const dead = session(userB, { apiOrigin: "http://127.0.0.1:1" });
  const res = await dead.call("listNotifications");
  assert.equal(res.status, 0);
  assert.equal(res.ok, false);
  assert.equal(res.body, null);
  assert.equal(typeof res.error, "string");
  const hanging = session(userB, {
    apiOrigin: origin,
    fetchImpl: (_url, { signal }) =>
      new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" })));
      }),
  });
  const timedOut = await hanging.call("listNotifications", {}, undefined, { timeoutMs: 20 });
  assert.equal(timedOut.status, 0);
  assert.match(timedOut.error, /timeout/i);
});

test("an error string never carries a token, ticket or password", async () => {
  const leaky = session(userB, {
    apiOrigin: origin,
    fetchImpl: () => Promise.reject(new Error('boom Bearer TOKEN-B-SECRET at uniwork-office-dev://open?ticket=abc "password":"pw1"')),
  });
  const res = await leaky.call("listNotifications");
  assert.ok(!/TOKEN-B-SECRET|abc|pw1/.test(res.error), res.error);
});

test("programming errors throw: unknown row, missing path param, unknown body key", async () => {
  const s = session(userB, { apiOrigin: origin });
  await assert.rejects(s.call("nope"), /unknown API call/);
  await assert.rejects(s.call("getDocument"), /takes path params/);
  await assert.rejects(s.call("updateDocumentComment", { documentID: "d", commentID: "c" }, { body: "x", author_id: "y" }), /author_id/);
});

test("a session without a token sends no authorization header", async () => {
  await session({ key: "anon" }, { apiOrigin: origin }).call("listNotifications");
  assert.equal(seen.at(-1).auth, null);
});
