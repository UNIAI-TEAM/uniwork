import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  loadRefreshMaterial,
  prepareConfig,
  publicRefreshMessage,
  refreshCredentials,
  refreshStorePath,
} from "./tokens.mjs";

const SESSION = "session-refresh-old";
const MCP = "uwm_rt_old";
const CLIENT = "mcpc_client";

function tempStore() {
  const dir = mkdtempSync(join(tmpdir(), "uniai-refresh-"));
  return { dir, path: join(dir, "nested", "refresh.json") };
}

test("refreshCredentials posts the session cookie and stores the rotated cookie", async () => {
  const store = tempStore();
  const calls = [];
  try {
    const result = await refreshCredentials({
      origin: "https://uniwork.example",
      material: { sessionRefresh: SESSION, mcpRefresh: "", mcpClientId: "" },
      path: store.path,
      fetch: async (url, init) => {
        calls.push({ url, init });
        return {
          ok: true,
          status: 200,
          headers: { getSetCookie: () => ["uniwork_refresh=session-refresh-new; Path=/api/v1/auth; HttpOnly"] },
          json: async () => ({ access_token: "session-access-new", user: { id: "u" } }),
        };
      },
    });
    assert.equal(result.sessionToken, "session-access-new");
    assert.equal(calls[0].url, "https://uniwork.example/api/v1/auth/refresh");
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.headers.Cookie, `uniwork_refresh=${SESSION}`);
    const saved = JSON.parse(readFileSync(store.path, "utf8"));
    assert.equal(saved.session_refresh, "session-refresh-new");
    assert.equal(statSync(store.path).mode & 0o777, 0o600);
  } finally {
    rmSync(store.dir, { recursive: true, force: true });
  }
});

test("refreshCredentials reads a session cookie from a single set-cookie header", async () => {
  const store = tempStore();
  try {
    await refreshCredentials({
      origin: "https://uniwork.example",
      material: { sessionRefresh: SESSION, mcpRefresh: "", mcpClientId: "" },
      path: store.path,
      fetch: async () => ({
        ok: true,
        status: 200,
        headers: { get: () => "uniwork_refresh=from-header; Path=/api/v1/auth; HttpOnly" },
        json: async () => ({ access_token: "session-access-new" }),
      }),
    });
    const saved = JSON.parse(readFileSync(store.path, "utf8"));
    assert.equal(saved.session_refresh, "from-header");
  } finally {
    rmSync(store.dir, { recursive: true, force: true });
  }
});

test("refreshCredentials posts the mcp refresh form and stores the rotated token", async () => {
  const store = tempStore();
  const calls = [];
  try {
    const result = await refreshCredentials({
      origin: "https://uniwork.example/",
      material: { sessionRefresh: "", mcpRefresh: MCP, mcpClientId: CLIENT },
      path: store.path,
      fetch: async (url, init) => {
        calls.push({ url, body: String(init.body) });
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: "uwm_at_new", refresh_token: "uwm_rt_new", token_type: "Bearer" }),
        };
      },
    });
    assert.equal(result.mcpToken, "uwm_at_new");
    assert.equal(calls[0].url, "https://uniwork.example/oauth/token");
    const params = new URLSearchParams(calls[0].body);
    assert.equal(params.get("grant_type"), "refresh_token");
    assert.equal(params.get("client_id"), CLIENT);
    assert.equal(params.get("refresh_token"), MCP);
    const saved = JSON.parse(readFileSync(store.path, "utf8"));
    assert.equal(saved.mcp_refresh, "uwm_rt_new");
    assert.equal(saved.mcp_client_id, CLIENT);
  } finally {
    rmSync(store.dir, { recursive: true, force: true });
  }
});

test("a failed mcp refresh keeps the rotated session cookie", async () => {
  const store = tempStore();
  try {
    await assert.rejects(
      refreshCredentials({
        origin: "https://uniwork.example",
        material: { sessionRefresh: SESSION, mcpRefresh: MCP, mcpClientId: CLIENT },
        path: store.path,
        fetch: async (url) => {
          if (url.endsWith("/api/v1/auth/refresh")) {
            return {
              ok: true,
              status: 200,
              headers: { getSetCookie: () => ["uniwork_refresh=session-refresh-new; Path=/api/v1/auth; HttpOnly"] },
              json: async () => ({ access_token: "session-access-new" }),
            };
          }
          return { ok: false, status: 400, json: async () => ({ error: "invalid_grant", refresh_token: MCP }) };
        },
      }),
      { message: "mcp refresh failed" },
    );
    const saved = JSON.parse(readFileSync(store.path, "utf8"));
    assert.equal(saved.session_refresh, "session-refresh-new");
    assert.equal(saved.mcp_refresh, MCP);
    assert.equal(JSON.stringify(saved).includes("invalid_grant"), false);
  } finally {
    rmSync(store.dir, { recursive: true, force: true });
  }
});

test("refresh failure does not include the refresh token", async () => {
  const store = tempStore();
  try {
    await assert.rejects(
      refreshCredentials({
        origin: "https://uniwork.example",
        material: { sessionRefresh: SESSION, mcpRefresh: "", mcpClientId: "" },
        path: store.path,
        fetch: async () => ({
          ok: false,
          status: 401,
          headers: { getSetCookie: () => [] },
          json: async () => ({ message: `missing ${SESSION}` }),
          text: async () => SESSION,
        }),
      }),
      (error) => {
        assert.equal(error.message, "session refresh failed");
        assert.equal(error.message.includes(SESSION), false);
        return true;
      },
    );
  } finally {
    rmSync(store.dir, { recursive: true, force: true });
  }
});

test("loadRefreshMaterial prefers the file over the environment", () => {
  const files = new Map([
    ["/tmp/refresh.json", JSON.stringify({
      session_refresh: "from-file",
      mcp_refresh: "uwm_rt_file",
      mcp_client_id: "mcpc_file",
    })],
  ]);
  const material = loadRefreshMaterial(
    { UNIWORK_SESSION_REFRESH: "from-env", UNIWORK_MCP_REFRESH: "uwm_rt_env", UNIWORK_MCP_CLIENT_ID: "mcpc_env" },
    (path) => files.get(path),
    "/tmp/refresh.json",
  );
  assert.deepEqual(material, {
    sessionRefresh: "from-file",
    mcpRefresh: "uwm_rt_file",
    mcpClientId: "mcpc_file",
  });
});

test("loadRefreshMaterial uses the environment when the file is missing", () => {
  const material = loadRefreshMaterial(
    { UNIWORK_SESSION_REFRESH: "from-env", UNIWORK_MCP_REFRESH: "uwm_rt_env", UNIWORK_MCP_CLIENT_ID: "mcpc_env" },
    () => {
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    },
    "/tmp/missing.json",
  );
  assert.deepEqual(material, {
    sessionRefresh: "from-env",
    mcpRefresh: "uwm_rt_env",
    mcpClientId: "mcpc_env",
  });
});

test("loadRefreshMaterial rejects a file that is not json without echoing it", () => {
  assert.throws(
    () => loadRefreshMaterial({}, () => `not-json ${SESSION}`, "/tmp/refresh.json"),
    (error) => {
      assert.equal(error.message, "refresh file is not json");
      assert.equal(String(error).includes(SESSION), false);
      return true;
    },
  );
});

test("prepareConfig keeps env access tokens when no refresh material exists", async () => {
  let called = false;
  const config = await prepareConfig(
    { origin: "https://uniwork.example", sessionToken: "sess", mcpToken: "uwm_at_x" },
    {
      env: {},
      home: "/home/operator",
      readFile: () => {
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      },
      fetch: async () => {
        called = true;
        throw new Error("fetch");
      },
    },
  );
  assert.equal(called, false);
  assert.equal(config.sessionToken, "sess");
  assert.equal(config.mcpToken, "uwm_at_x");
});

test("prepareConfig uses the env session refresh when the stored cookie is rejected", async () => {
  const dir = mkdtempSync(join(tmpdir(), "uniai-refresh-"));
  const path = join(dir, "refresh.json");
  writeFileSync(path, JSON.stringify({
    session_refresh: "dead-cookie",
    mcp_refresh: "",
    mcp_client_id: "",
  }));
  try {
    const config = await prepareConfig(
      { origin: "https://uniwork.example", sessionToken: "", mcpToken: "" },
      {
        env: { UNIWORK_REFRESH_FILE: path, UNIWORK_SESSION_REFRESH: "live-cookie" },
        home: "/home/operator",
        readFile: (file) => readFileSync(file, "utf8"),
        fetch: async (_url, init) => {
          if (String(init.headers.Cookie).includes("dead-cookie")) {
            return { ok: false, status: 401, json: async () => ({}) };
          }
          return {
            ok: true,
            status: 200,
            headers: { getSetCookie: () => ["uniwork_refresh=rotated-live; Path=/api/v1/auth; HttpOnly"] },
            json: async () => ({ access_token: "eyJ-live" }),
          };
        },
      },
    );
    assert.equal(config.sessionToken, "eyJ-live");
    assert.equal(JSON.parse(readFileSync(path, "utf8")).session_refresh, "rotated-live");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("prepareConfig reports a missing refresh file when access tokens are empty", async () => {
  await assert.rejects(
    prepareConfig(
      { origin: "https://uniwork.example", sessionToken: "", mcpToken: "" },
      {
        env: {},
        home: "/home/operator",
        readFile: () => {
          throw Object.assign(new Error("missing"), { code: "ENOENT" });
        },
      },
    ),
    { message: "refresh file missing" },
  );
});

test("refreshCredentials refuses an mcp refresh without a client id", async () => {
  const store = tempStore();
  let called = false;
  try {
    await assert.rejects(
      refreshCredentials({
        origin: "https://uniwork.example",
        material: { sessionRefresh: SESSION, mcpRefresh: MCP, mcpClientId: "" },
        path: store.path,
        fetch: async () => {
          called = true;
          return { ok: true, status: 200, json: async () => ({}) };
        },
      }),
      { message: "mcp refresh missing client id" },
    );
    assert.equal(called, false);
  } finally {
    rmSync(store.dir, { recursive: true, force: true });
  }
});

test("publicRefreshMessage hides unexpected errors", () => {
  assert.equal(publicRefreshMessage(new Error("session refresh failed")), "session refresh failed");
  assert.equal(publicRefreshMessage(new Error(`boom ${SESSION}`)), "refresh failed");
});

test("refreshStorePath uses UNIWORK_REFRESH_FILE or the home config path", () => {
  assert.equal(refreshStorePath({ UNIWORK_REFRESH_FILE: "/var/refresh.json" }, "/home/operator"), "/var/refresh.json");
  assert.equal(
    refreshStorePath({}, "/home/operator"),
    "/home/operator/.config/uniai-uniwork-sync/refresh.json",
  );
});
