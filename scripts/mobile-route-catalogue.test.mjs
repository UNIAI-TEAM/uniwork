// Every path UniChat mobile calls is a route the server registers (scripts/mobile-route-catalogue.mjs). The phone's
// reachability probe asked /api/v1/healthz before any router served it (92b860efd) and every iPhone stayed offline;
// this check fails on that, on the phone's side or the server's.
import assert from "node:assert/strict";
import test from "node:test";
import { readPhonePaths, readServerRoutes, serverSources, phoneSources, serves, unreadPhoneCalls, unservedPaths } from "./mobile-route-catalogue.mjs";

const server = readServerRoutes(serverSources());
const phone = readPhonePaths(phoneSources());
const where = (calls) => calls.map((c) => `${c.path} (${c.file}:${c.line})`).join("\n  ");

test("every path the phone calls is a route the server's router registers", () => {
  const unserved = unservedPaths(phone, server.routes);
  assert.deepEqual(unserved, [], `no route serves:\n  ${where(unserved)}\nregister it in ${"server/internal/handler/router"}, or stop calling it`);
});

test("the router reader places every registration of server/internal/handler/router", () => {
  assert.deepEqual(server.issues, [], "teach scripts/mobile-route-catalogue.mjs the new form rather than leave routes out");
  assert.ok(server.routes.length > 500, `only ${server.routes.length} routes read`);
  const keys = new Set(server.routes.map((r) => `${r.method} ${r.path}`));
  for (const key of [
    // registerAPIHealth on the /api/v1 router, registerMeta and registerMCP on the root one
    "GET /api/v1/healthz",
    "GET /healthz",
    "POST /mcp",
    // v1.r.Get, off the api wrapper
    "GET /api/v1/ws",
    // the Route("/admin") closure
    "GET /api/v1/admin/me",
    // a package constant as the path
    "POST /api/v1/integrations/livekit/webhook",
    // `const base` + a literal, on a With chain
    "POST /api/v1/office-frame/documents/{documentID}/ai/cloud/search",
    // `av := f` then av.r.Head
    "HEAD /api/v1/office-frame/documents/{documentID}/avatars/{userID}",
    "PUT /api/v1/workspaces/{workspaceID}/documents/folder-uploads/{batchID}/files/{fileKey}/content",
  ]) {
    assert.ok(keys.has(key), `the reader lost ${key}`);
  }
});

test("the phone reader finds the calls of the app, its builders and the core endpoints it runs", () => {
  assert.ok(phone.length > 80, `only ${phone.length} calls read`);
  const found = (p, file) => phone.some((c) => c.path === p && c.file === file);
  for (const [p, file] of [
    // `${apiUrl}/api/v1/healthz`: the reachability probe
    ["/api/v1/healthz", "apps/chat-mobile/lib/reachability.ts"],
    ["/api/v1/ws", "apps/chat-mobile/data/realtime/realtime-provider.tsx"],
    // `/api/v1${route}` with route: Route, a union of four literals
    ["/api/v1/auth/desktop/refresh", "apps/chat-mobile/data/auth/transport.ts"],
    ["/api/v1/auth/desktop/exchange", "apps/chat-mobile/data/auth/transport.ts"],
    ["/api/v1/me", "apps/chat-mobile/data/api.ts"],
    // `${ws(wsId)}/chat/sync${query}`: a builder, then a query glued on
    ["/api/v1/workspaces/{}/chat/sync", "apps/chat-mobile/data/chat-sync/api.ts"],
    // the core factories the phone binds to its own transport (runtimeClosure)
    ["/api/v1/workspaces/{}/chat/rooms/{}/messages", "packages/core/api/endpoints/chat-messages-api.ts"],
    ["/api/v1/workspaces/{}/chat/stickers/trending", "packages/core/api/endpoints/chat-media-api.ts"],
    // a builder handed straight to request(…), no template around it: `request(block(ws, uid))`
    ["/api/v1/workspaces/{}/chat/users/{}/block", "packages/core/api/endpoints/chat-users-api.ts"],
    // `request(msg(ws, room, id), { method: "PATCH" })`, a builder that inlines two more
    ["/api/v1/workspaces/{}/chat/rooms/{}/messages/{}", "packages/core/api/endpoints/chat-messages-api.ts"],
  ]) {
    assert.ok(found(p, file), `the reader lost ${p} in ${file}`);
  }
  // A label or a comparison is no call.
  assert.equal(phone.some((c) => c.path === "/api/v1/auth/desktop"), false);
});

test("the phone reader reads the path of every transport call of the app and the core files it runs", () => {
  assert.deepEqual(unreadPhoneCalls(phoneSources()), [], "teach scripts/mobile-route-catalogue.mjs the new form rather than leave a call out");
});

test("it would have caught the probe no router served (before 92b860efd)", () => {
  const before = serverSources();
  const file = "server/internal/handler/router/router.go";
  const src = before.get(file);
  assert.match(src, /registerAPIHealth\(v1, h\)/);
  before.set(file, src.replace(/registerAPIHealth\(v1, h\)\n/, ""));
  const unserved = unservedPaths(phone, readServerRoutes(before).routes);
  assert.deepEqual(
    unserved.map((c) => `${c.path} ${c.file}`),
    ["/api/v1/healthz apps/chat-mobile/lib/reachability.ts"],
  );
});

test("serves: a {param} takes any one segment, a trailing * the rest, a literal only itself", () => {
  assert.equal(serves("/api/v1/workspaces/{workspaceID}/chat/rooms", "/api/v1/workspaces/{}/chat/rooms"), true);
  assert.equal(serves("/api/v1/workspaces/{workspaceID}/chat/rooms", "/api/v1/workspaces/w1/chat/rooms"), true);
  assert.equal(serves("/api/v1/workspaces/{workspaceID}/chat/rooms", "/api/v1/workspaces/{}/chat"), false);
  assert.equal(serves("/api/v1/chat/voice/token", "/api/v1/chat/{}/token"), false);
  assert.equal(serves("/uploads/*", "/uploads/a/b.png"), true);
  assert.equal(serves("/healthz", "/api/v1/healthz"), false);
});

test("the router reader follows Route, Group, With, aliases and register calls, and says what it cannot place", () => {
  const go = (src) => readServerRoutes(new Map([["router.go", `package router\n${src}`]]));
  const { routes, issues } = go(`
const hookPath = "/hooks/x"
func New(d Deps, h Routes) http.Handler {
	r := chi.NewRouter()
	root := newAPI(r, cat)
	registerMeta(root)
	root.Route("/api/v1", func(v1 api) {
		v1.r.Get("/ws", h.WS) // a comment with r.Get("/not-a-route")
		v1.Group(func(authed api) {
			limited := authed.With(limit)
			registerThings(limited, h)
		})
		v1.Post(hookPath, h.Hook, apiOp{})
	})
	return r
}
func registerMeta(root api) { root.Get("/healthz", h.Health, apiOp{}) }
func registerThings(r api, h Routes) {
	const base = "/things/{thingID}"
	r.Get(base+"/parts", h.Parts, apiOp{})
	alias := r
	alias.With(other).Delete("/things/{thingID}", h.Del, apiOp{})
	r.Route("/admin", func(a api) {
		a.Put("/flags/{key}/", h.Flag, apiOp{})
	})
	if v := req.Header.Get("Authorization"); v != "" {}
}
func (a api) Get(path string, h http.HandlerFunc, op apiOp) { a.r.Get(path, h) }
func registerOrphan(r api, h Routes) { r.Get("/orphan", h.X, apiOp{}) }
`);
  assert.deepEqual(routes.map((r) => `${r.method} ${r.path}`).sort(), [
    "DELETE /api/v1/things/{thingID}",
    "GET /api/v1/things/{thingID}/parts",
    "GET /api/v1/ws",
    "GET /healthz",
    "POST /api/v1/hooks/x",
    "PUT /api/v1/admin/flags/{key}",
  ]);
  assert.deepEqual(issues, ['router.go:30: Get("/orphan") on a router this reader cannot trace to New']);

  const unsupported = go(`
func New() { r := chi.NewRouter(); r.Mount("/sub", sub); r.Get(pathFrom(x), h) }
`);
  assert.deepEqual(unsupported.issues, [
    "router.go:3: Mount is a registration this reader does not follow",
    "router.go:3: Get with a path this reader cannot evaluate",
  ]);
});

test("a transport call whose path the phone reader cannot read is an issue, not a call left out", () => {
  const issues = unreadPhoneCalls(
    new Map([
      [
        "a.ts",
        `
export function make(request: (p: string) => unknown, api: { request: (p: string) => unknown }) {
  const ws = (id: string) => \`/api/v1/workspaces/\${id}\`;
  const fixed = "/api/v1/me";
  const get = (path: string) => request(path);
  const built = pathFor("x");
  return {
    a: () => request(ws("1")),
    b: () => api.request(fixed),
    c: () => get("/api/v1/me"),
    d: () => api.request(built),
    e: () => request(pathFor("y")),
    f: () => PermissionsAndroid.request(PERMISSION),
  };
}
`,
      ],
    ]),
  );
  assert.deepEqual(issues, [
    "a.ts:11: request(built, …) hands on a path this reader cannot read",
    "a.ts:12: request(pathFor(\"y\"), …) hands on a path this reader cannot read",
  ]);
});

test("the phone reader inlines builders, expands literal unions and constants, and skips labels and comparisons", () => {
  const calls = readPhonePaths(
    new Map([
      [
        "a.ts",
        `
type Route = "/auth/a" | "/auth/b";
// "/api/v1/in-a-comment" is not a call
export function make(request: (p: string) => unknown, apiUrl: string) {
  const ws = (id: string) => \`/api/v1/workspaces/\${enc(id)}\`;
  const room = (id: string, r: string) => \`\${ws(id)}/rooms/\${enc(r)}\`;
  return {
    send: (route: Route) => fetch(\`\${apiUrl}/api/v1\${route}?x=1\`),
    rooms: (id: string, q: string) => request(\`\${ws(id)}/rooms\${q}\`),
    messages: (id: string, r: string) => request(\`\${room(id, r)}/messages?before=\${r}\`),
    kind: (id: string, q: boolean) => {
      const mode = q ? "search" : "trending";
      return request(\`\${ws(id)}/gifs/\${mode}\`);
    },
    me: () => request("/api/v1/" + "me"),
    edit: (id: string, r: string) => request(room(id, r), { method: "PATCH" }),
    label: () => ({ endpoint: "GET /api/v1/workspaces/{ws}/rooms" }),
    native: (p: string) => p.startsWith("/api/v1/auth/"),
  };
}
`,
      ],
    ]),
  );
  assert.deepEqual(
    calls.map((c) => `${c.path} :${c.line}`),
    [
      "/api/v1/auth/a :8",
      "/api/v1/auth/b :8",
      "/api/v1/workspaces/{}/rooms :9",
      "/api/v1/workspaces/{}/rooms/{}/messages :10",
      "/api/v1/workspaces/{}/gifs/search :13",
      "/api/v1/workspaces/{}/gifs/trending :13",
      "/api/v1/me :15",
      "/api/v1/workspaces/{}/rooms/{} :16",
    ],
  );
});
