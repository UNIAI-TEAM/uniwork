// The document step's API calls against the server's own source (UNI-1376 r6).
// Cloud round 5 died on `POST /api/v1/orgs/<slug>/workspaces -> 403`: the step
// named the organization by slug where the route takes its id. Nothing local
// could say so because the fake server accepted any `{org}`. These tests read
// the server's route catalogue, handlers, service signatures and SDI structs, so
// that mistake, an unrouted path, an unknown body key or a missing required key
// fails here.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { API_CALLS, API_PREFIX, ApiError, apiPath, assertBodyKeys, failureInfo } from "./api-contract.mjs";
import { handlerFunction, paramKind, pathParamTarget, routeCatalogue, routeMatches, sdiFields } from "./server-contract.helper.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const routes = routeCatalogue();
/** The Routes field a registered path/method maps to, or throws. */
function routeOf(call) {
  const route = routes.find((r) => r.method === call.method && r.path === call.path);
  assert.ok(route, `the router registers no ${call.method} ${API_PREFIX}${call.path}`);
  return route;
}

test("the route catalogue is read (guard against a parser that finds nothing)", () => {
  assert.ok(routes.length > 200, `parsed ${routes.length} routes`);
  assert.ok(routes.some((r) => r.method === "POST" && r.path === "/orgs/{org}/workspaces" && r.handler === "CreateOrgWorkspace"));
});

for (const [name, call] of Object.entries(API_CALLS)) {
  test(`${name}: ${call.method} ${call.path} is a route the router registers`, () => {
    routeOf(call);
  });

  test(`${name}: every path param is an id or slug the handler really passes on`, () => {
    const route = routeOf(call);
    for (const [param, kind] of Object.entries(call.params ?? {})) {
      assert.ok(call.path.includes(`{${param}}`), `${name} declares {${param}} but the path has none`);
      const target = pathParamTarget(route.handler, param);
      if (target) {
        assert.ok(paramKind(target.name), `${route.handler}: {${param}} reaches ${target.method} as "${target.name}", which is neither an id nor a slug`);
        assert.equal(
          paramKind(target.name),
          kind,
          `${name}: {${param}} reaches service ${target.method} as "${target.name}" (${paramKind(target.name)}), the table says it takes the ${kind}`,
        );
      } else {
        // the handler does not pass the param straight to a service call: fall
        // back to the router's own naming, where {fooID} is an id
        assert.match(param, /ID$/, `${name}: cannot see where {${param}} goes, and its name does not say it is an id`);
        assert.equal(kind, "id");
      }
    }
    // every placeholder in the path is declared
    const placeholders = [...call.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    assert.deepEqual(placeholders.sort(), Object.keys(call.params ?? {}).sort(), `${name}: path params and the table's params differ`);
  });

  if (call.sdi) {
    test(`${name}: the body keys are ${call.sdi} json fields and every required field is sent`, () => {
      const fields = sdiFields(call.sdi);
      for (const key of call.body) assert.ok(key in fields, `${call.sdi} has no json field ${key} (it has ${Object.keys(fields).join(", ")})`);
      for (const [key, { required }] of Object.entries(fields)) {
        if (required) assert.ok(call.body.includes(key), `${call.sdi} requires ${key}, the step does not send it`);
      }
    });
  }
}

test("sdiFields treats pointer / omitempty fields as optional even when they carry minLength bounds for present values (C1)", () => {
  const fields = sdiFields("CreateOfficeLaunchSessionSDI");
  assert.equal(fields.deployment_id?.required, true);
  assert.equal(fields.client_id?.required, true);
  assert.equal(fields.version?.required, false);
  assert.equal(fields.return_hint?.required, false);
  assert.equal(fields.comment_id?.required, false);
});

test("the slug-for-id mistake of cloud round 5 is caught: createWorkspace's {org} reaches the service as an id", () => {
  const target = pathParamTarget("CreateOrgWorkspace", "org");
  assert.deepEqual({ method: target.method, kind: paramKind(target.name) }, { method: "CreateInOrg", kind: "id" });
  // and the counter-example the table must not confuse it with: GET /orgs/{org} takes the slug
  assert.equal(paramKind(pathParamTarget("GetOrganization", "org").name), "slug");
  assert.equal(API_CALLS.createWorkspace.params.org, "id");
});

test("the multipart upload sends the fields the handler reads", () => {
  const handler = handlerFunction("createDocumentFile");
  const form = handlerFunction("documentUploadForm");
  assert.match(form, /FormName\(\) != "file"/, "the file part is named file");
  for (const key of API_CALLS.createFileDocument.form.filter((k) => k !== "file")) {
    assert.match(handler, new RegExp(`fields\\["${key}"\\]`), `the handler reads form field ${key}`);
  }
});

test("document-step.mjs reaches the server only through the table", () => {
  const source = readFileSync(join(HERE, "document-step.mjs"), "utf8");
  const code = source.split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
  assert.ok(!code.includes("/api/v1"), "no raw /api/v1 path in the step; add the call to api-contract.mjs");
  const used = new Set([...source.matchAll(/apiCall\("(\w+)"/g)].map((m) => m[1]));
  for (const name of used) assert.ok(name in API_CALLS, `document-step calls ${name}, which the table does not have`);
  for (const name of Object.keys(API_CALLS)) assert.ok(used.has(name), `the table lists ${name} and the step never calls it`);
});

test("apiPath builds the path from the template and refuses a missing or extra param", () => {
  assert.equal(apiPath("createWorkspace", { org: "01JABC" }), "/api/v1/orgs/01JABC/workspaces");
  assert.equal(apiPath("mintLaunch", { documentID: "d 1" }), "/api/v1/documents/d%201/office/sessions");
  assert.throws(() => apiPath("createWorkspace"), /takes path params \{org\}/);
  assert.throws(() => apiPath("register", { org: "x" }), /takes path params \{\}/);
  assert.throws(() => apiPath("createWorkspace", { org: "" }), /empty/);
  assert.throws(() => apiPath("nope"), /unknown API call/);
  // every path the table builds is routed
  for (const [name, call] of Object.entries(API_CALLS)) {
    const params = Object.fromEntries(Object.keys(call.params ?? {}).map((p) => [p, "x1"]));
    assert.ok(routeMatches(routes, call.method, apiPath(name, params).slice(API_PREFIX.length)), name);
  }
});

test("assertBodyKeys refuses a key the table does not list", () => {
  assertBodyKeys("createWorkspace", { name: "n", slug: "s" });
  assert.throws(() => assertBodyKeys("createWorkspace", { name: "n", slug: "s", org: "o" }), /org/);
});

test("an ApiError names the method, path and status, and never a token", () => {
  const error = new ApiError({
    method: "POST",
    path: "/api/v1/orgs/o1/workspaces",
    status: 403,
    bodyText: '{"error":"forbidden","access_token":"SECRET.JWT","launch_url":"uniwork-office-dev://open?ticket=abc123"}',
  });
  assert.match(error.message, /^POST \/api\/v1\/orgs\/o1\/workspaces -> 403: /);
  assert.ok(!/SECRET\.JWT|abc123/.test(error.message), error.message);
  assert.deepEqual(failureInfo(error).request, { method: "POST", path: "/api/v1/orgs/o1/workspaces", status: 403 });
  assert.deepEqual(failureInfo(new Error("boom")), { reason: "boom" });
});
