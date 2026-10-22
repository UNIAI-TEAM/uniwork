import { chmodSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const PUBLIC_MESSAGES = new Set([
  "session refresh failed",
  "mcp refresh failed",
  "mcp refresh missing client id",
  "refresh file is not json",
  "refresh file missing",
]);

export function refreshStorePath(env, home) {
  if (env.UNIWORK_REFRESH_FILE) return env.UNIWORK_REFRESH_FILE;
  return join(home, ".config", "uniai-uniwork-sync", "refresh.json");
}

export function publicRefreshMessage(error) {
  return PUBLIC_MESSAGES.has(error?.message) ? error.message : "refresh failed";
}

export function loadRefreshMaterial(env, readFile, path) {
  let raw;
  try {
    raw = readFile(path);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return {
      sessionRefresh: env.UNIWORK_SESSION_REFRESH ?? "",
      mcpRefresh: env.UNIWORK_MCP_REFRESH ?? "",
      mcpClientId: env.UNIWORK_MCP_CLIENT_ID ?? "",
    };
  }
  let file;
  try {
    file = JSON.parse(raw);
  } catch {
    throw Object.assign(new Error("refresh file is not json"), { code: "refresh_file_invalid" });
  }
  return {
    sessionRefresh: file.session_refresh ?? "",
    mcpRefresh: file.mcp_refresh ?? "",
    mcpClientId: file.mcp_client_id ?? "",
  };
}

function failed(kind) {
  return Object.assign(new Error(`${kind} refresh failed`), { code: `${kind}_refresh_failed` });
}

function originOf(origin) {
  return String(origin ?? "").replace(/\/$/, "");
}

function setCookieRows(headers) {
  if (headers && typeof headers.getSetCookie === "function") {
    const rows = headers.getSetCookie();
    if (rows?.length) return rows;
  }
  if (headers && typeof headers.get === "function") {
    const raw = headers.get("set-cookie");
    if (raw) return [raw];
  }
  return [];
}

function cookieValue(headers, name) {
  for (const row of setCookieRows(headers)) {
    const pair = String(row).split(";")[0];
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    if (pair.slice(0, eq).trim() !== name) continue;
    const value = decodeURIComponent(pair.slice(eq + 1).trim());
    if (value) return value;
  }
  return "";
}

function writeRefreshFile(path, material) {
  const body = `${JSON.stringify({
    session_refresh: material.sessionRefresh ?? "",
    mcp_refresh: material.mcpRefresh ?? "",
    mcp_client_id: material.mcpClientId ?? "",
  })}\n`;
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, body, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
  chmodSync(path, 0o600);
}

async function post(fetchImpl, url, init, kind) {
  let response;
  try {
    response = await fetchImpl(url, init);
  } catch {
    throw failed(kind);
  }
  if (!response?.ok) throw failed(kind);
  let json;
  try {
    json = await response.json();
  } catch {
    throw failed(kind);
  }
  return { response, json };
}

export async function refreshCredentials({ origin, material, path, fetch: fetchImpl }) {
  if (material.mcpRefresh && !material.mcpClientId) {
    throw Object.assign(new Error("mcp refresh missing client id"), { code: "mcp_refresh_missing_client_id" });
  }
  const next = {
    sessionRefresh: material.sessionRefresh ?? "",
    mcpRefresh: material.mcpRefresh ?? "",
    mcpClientId: material.mcpClientId ?? "",
  };
  const tokens = { sessionToken: "", mcpToken: "" };
  const base = originOf(origin);
  if (next.sessionRefresh) {
    const { response, json } = await post(fetchImpl, `${base}/api/v1/auth/refresh`, {
      method: "POST",
      headers: {
        Cookie: `uniwork_refresh=${encodeURIComponent(next.sessionRefresh)}`,
        Accept: "application/json",
      },
      redirect: "manual",
    }, "session");
    const refresh = cookieValue(response.headers, "uniwork_refresh");
    if (refresh) {
      next.sessionRefresh = refresh;
      writeRefreshFile(path, next);
    }
    if (!refresh || !json?.access_token) throw failed("session");
    tokens.sessionToken = json.access_token;
  }
  if (next.mcpRefresh) {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: next.mcpClientId,
      refresh_token: next.mcpRefresh,
    });
    const { json } = await post(fetchImpl, `${base}/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
      redirect: "manual",
    }, "mcp");
    if (json?.refresh_token) {
      next.mcpRefresh = json.refresh_token;
      writeRefreshFile(path, next);
    }
    if (!json?.access_token || !json?.refresh_token) throw failed("mcp");
    tokens.mcpToken = json.access_token;
  }
  return tokens;
}

function envMaterial(env) {
  return {
    sessionRefresh: env.UNIWORK_SESSION_REFRESH ?? "",
    mcpRefresh: env.UNIWORK_MCP_REFRESH ?? "",
    mcpClientId: env.UNIWORK_MCP_CLIENT_ID ?? "",
  };
}

async function applyRefresh(config, material, path, fetchImpl) {
  const tokens = await refreshCredentials({
    origin: config.origin,
    material,
    path,
    fetch: fetchImpl,
  });
  return {
    ...config,
    sessionToken: tokens.sessionToken || config.sessionToken,
    mcpToken: tokens.mcpToken || config.mcpToken,
  };
}

export async function prepareConfig(config, opts) {
  const path = refreshStorePath(opts.env, opts.home);
  const material = loadRefreshMaterial(opts.env, opts.readFile, path);
  const fromEnv = envMaterial(opts.env);
  if (!material.sessionRefresh && !material.mcpRefresh) {
    if (config.sessionToken && config.mcpToken) return config;
    throw Object.assign(new Error("refresh file missing"), { code: "refresh_file_missing" });
  }
  const fetchImpl = opts.fetch ?? fetch;
  try {
    return await applyRefresh(config, material, path, fetchImpl);
  } catch (error) {
    const envSession = fromEnv.sessionRefresh;
    if (error?.message !== "session refresh failed" || !envSession || envSession === material.sessionRefresh) {
      throw error;
    }
    return await applyRefresh(config, { ...material, sessionRefresh: envSession }, path, fetchImpl);
  }
}
