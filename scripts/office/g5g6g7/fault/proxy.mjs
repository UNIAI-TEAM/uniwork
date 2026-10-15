/* global process, Buffer */
// Fault-injection HTTP reverse proxy for G7-03a (UNI-1380).
//
// Sits between the client (or Electron fork app / web frame) and the D server.
// Forwards all HTTP methods, streaming/multipart bodies and WebSocket upgrades,
// injects configured rule faults, serves the control API under `/__fault/*`
// without forwarding control paths, and writes a sanitized JSONL request log.

import crypto from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { harnessPaths, isMainModule, origin as buildOrigin } from "../harness/lib.mjs";
import { createRuleEngine, stripQuery } from "./rules.mjs";

const CONTROL_PREFIX = "/__fault";

function sleep(ms) {
  return new Promise((resolveTimer) => setTimeout(resolveTimer, ms));
}

function extractIdempotencyKey(headers = {}) {
  const raw = headers["idempotency-key"];
  if (Array.isArray(raw)) {
    const found = raw.find((item) => typeof item === "string" && item.trim() !== "");
    return found ? found.trim() : null;
  }
  if (typeof raw === "string" && raw.trim() !== "") {
    return raw.trim();
  }
  return null;
}

function buildTargetPath(basePathname, reqUrl = "/") {
  const cleanBase = basePathname && basePathname !== "/" ? basePathname.replace(/\/+$/, "") : "";
  const suffix = String(reqUrl || "/").startsWith("/") ? String(reqUrl || "/") : `/${reqUrl}`;
  return `${cleanBase}${suffix}`;
}

function buildForwardHeaders(incomingHeaders, targetHost) {
  const headers = {};
  for (const [key, value] of Object.entries(incomingHeaders ?? {})) {
    if (value === undefined) continue;
    headers[key] = value;
  }
  headers.host = targetHost;
  return headers;
}

function readJsonBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) {
        resolveBody(null);
        return;
      }
      try {
        resolveBody(JSON.parse(raw));
      } catch (error) {
        rejectBody(new Error(`invalid JSON body: ${error.message}`));
      }
    });
    req.on("error", rejectBody);
  });
}

function sendJson(res, statusCode, payload) {
  const body = `${JSON.stringify(payload)}\n`;
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(Buffer.byteLength(body)),
    "cache-control": "no-store",
  });
  res.end(body);
}

function destroySocket(socket, reset = false) {
  if (!socket || socket.destroyed) return;
  if (reset && typeof socket.resetAndDestroy === "function") {
    socket.resetAndDestroy();
    return;
  }
  socket.destroy();
}

/**
 * Starts the fault-injection reverse proxy in front of `target`.
 *
 * @param {object} options
 * @param {string} options.target Upstream origin (e.g. `http://localhost:8080`)
 * @param {number} [options.port=0] Port to listen on (`0` = kernel-assigned free port)
 * @param {string} [options.logFile] Optional JSONL log file path
 * @param {Array}  [options.rules=[]] Optional initial rules
 * @param {string} [options.host="127.0.0.1"] Bind address
 */
export async function startFaultProxy({
  target,
  port = 0,
  logFile,
  rules = [],
  host = "127.0.0.1",
} = {}) {
  if (!target || typeof target !== "string") {
    throw new Error("startFaultProxy requires a target origin string");
  }
  let targetUrl;
  try {
    targetUrl = new URL(target);
  } catch {
    throw new Error(`startFaultProxy: invalid target URL "${target}"`);
  }
  if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:") {
    throw new Error(`startFaultProxy: unsupported target protocol "${targetUrl.protocol}"`);
  }

  const resolvedLogFile = logFile ? resolve(logFile) : null;
  if (resolvedLogFile) {
    mkdirSync(dirname(resolvedLogFile), { recursive: true });
    if (!existsSync(resolvedLogFile)) {
      writeFileSync(resolvedLogFile, "", "utf8");
    }
  }

  // Per-proxy random salt for keyTag (first 12 hex chars of HMAC-SHA256); never logged.
  const keySalt = crypto.randomBytes(32);
  const ruleEngine = createRuleEngine(rules);
  const logEntries = [];
  const openSockets = new Set();
  const activeUpstreamRequests = new Set();
  let closing = false;

  const transport = targetUrl.protocol === "https:" ? https : http;
  const targetPort = targetUrl.port
    ? Number(targetUrl.port)
    : targetUrl.protocol === "https:"
      ? 443
      : 80;

  function inspectIdempotencyKey(headers) {
    const rawKey = extractIdempotencyKey(headers);
    if (!rawKey) {
      return { idempotencyKey: false, keyTag: null };
    }
    const keyTag = crypto.createHmac("sha256", keySalt).update(rawKey).digest("hex").slice(0, 12);
    return { idempotencyKey: true, keyTag };
  }

  function recordLog({ startTime, method, path, status, idempotencyKey, keyTag, ruleId }) {
    const entry = {
      ts: new Date().toISOString(),
      method: String(method || "GET").toUpperCase(),
      path: stripQuery(path),
      status,
      ms: Math.max(0, Math.round(performance.now() - startTime)),
      idempotencyKey: Boolean(idempotencyKey),
      keyTag: keyTag ?? null,
      ruleId: ruleId ?? null,
    };
    const serialized = `${JSON.stringify(entry)}\n`;
    logEntries.push(serialized);
    if (resolvedLogFile) {
      appendFileSync(resolvedLogFile, serialized, "utf8");
    }
    return entry;
  }

  async function handleControlRequest(req, res, cleanPath) {
    const method = String(req.method || "GET").toUpperCase();

    if (cleanPath === "/__fault/rules") {
      if (method === "GET") {
        sendJson(res, 200, ruleEngine.getRules());
        return;
      }
      if (method === "DELETE") {
        req.resume();
        sendJson(res, 200, ruleEngine.clearRules());
        return;
      }
      if (method === "POST") {
        try {
          const body = await readJsonBody(req);
          const updated = ruleEngine.setRules(body ?? []);
          sendJson(res, 200, updated);
        } catch (error) {
          sendJson(res, 400, { error: error.message });
        }
        return;
      }
      sendJson(res, 405, { error: `method ${method} not allowed on ${cleanPath}` });
      return;
    }

    if (cleanPath.startsWith("/__fault/release/")) {
      if (method !== "POST") {
        sendJson(res, 405, { error: `method ${method} not allowed on ${cleanPath}` });
        return;
      }
      req.resume();
      const rawRuleId = cleanPath.slice("/__fault/release/".length);
      let ruleId = "";
      try {
        ruleId = decodeURIComponent(rawRuleId).trim();
      } catch {
        ruleId = rawRuleId.trim();
      }
      if (!ruleId) {
        sendJson(res, 400, { error: "missing ruleId in /__fault/release/<ruleId>" });
        return;
      }
      const outcome = ruleEngine.release(ruleId);
      sendJson(res, 200, { ok: true, ...outcome });
      return;
    }

    if (cleanPath === "/__fault/log") {
      if (method === "GET") {
        const body = logEntries.join("");
        res.writeHead(200, {
          "content-type": "application/x-ndjson; charset=utf-8",
          "content-length": String(Buffer.byteLength(body)),
          "cache-control": "no-store",
        });
        res.end(body);
        return;
      }
      if (method === "DELETE") {
        req.resume();
        logEntries.length = 0;
        if (resolvedLogFile) {
          writeFileSync(resolvedLogFile, "", "utf8");
        }
        sendJson(res, 200, { ok: true });
        return;
      }
      sendJson(res, 405, { error: `method ${method} not allowed on ${cleanPath}` });
      return;
    }

    req.resume();
    sendJson(res, 404, { error: `unknown fault control path ${cleanPath}` });
  }

  function bufferIncomingBody(req) {
    const state = {
      chunks: [],
      ended: false,
      error: null,
      onChunk: null,
      onEnd: null,
    };
    req.on("data", (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (state.onChunk) {
        state.onChunk(buf);
      } else {
        state.chunks.push(buf);
      }
    });
    req.on("end", () => {
      state.ended = true;
      if (state.onEnd) state.onEnd();
    });
    req.on("error", (err) => {
      state.error = err;
    });
    return state;
  }

  function forwardToTarget({
    req,
    res,
    startTime,
    cleanPath,
    idempotencyKey,
    keyTag,
    ruleId,
    dropResponseAfterForward = false,
    bufferedBody = null,
  }) {
    let logged = false;
    const logOnce = (status) => {
      if (logged) return;
      logged = true;
      recordLog({
        startTime,
        method: req.method,
        path: cleanPath,
        status,
        idempotencyKey,
        keyTag,
        ruleId,
      });
    };

    const upstreamReq = transport.request(
      {
        protocol: targetUrl.protocol,
        hostname: targetUrl.hostname,
        port: targetPort,
        method: req.method,
        path: buildTargetPath(targetUrl.pathname, req.url),
        headers: buildForwardHeaders(req.headers, targetUrl.host),
      },
      (proxyRes) => {
        if (dropResponseAfterForward) {
          proxyRes.on("end", () => {
            logOnce("dropped");
            destroySocket(req.socket, true);
          });
          proxyRes.on("error", () => {
            logOnce("dropped");
            destroySocket(req.socket, true);
          });
          proxyRes.resume();
          return;
        }

        const statusCode = proxyRes.statusCode ?? 502;
        if (!res.headersSent && !res.writableEnded) {
          res.writeHead(statusCode, proxyRes.headers);
        }
        proxyRes.on("data", (chunk) => {
          if (!res.writableEnded && !res.destroyed) {
            res.write(chunk);
          }
        });
        proxyRes.on("end", () => {
          logOnce(statusCode);
          if (!res.writableEnded && !res.destroyed) {
            res.end();
          }
        });
        proxyRes.on("error", () => {
          logOnce(statusCode);
          destroySocket(req.socket, false);
        });
      },
    );

    activeUpstreamRequests.add(upstreamReq);
    upstreamReq.on("close", () => {
      activeUpstreamRequests.delete(upstreamReq);
    });

    upstreamReq.on("error", (error) => {
      if (dropResponseAfterForward) {
        logOnce("dropped");
        destroySocket(req.socket, true);
        return;
      }
      logOnce(502);
      if (!res.headersSent && !res.writableEnded && !res.destroyed) {
        sendJson(res, 502, { error: "bad_gateway", detail: error.code || error.message });
      } else {
        destroySocket(req.socket, false);
      }
    });

    if (bufferedBody) {
      for (const chunk of bufferedBody.chunks) {
        upstreamReq.write(chunk);
      }
      bufferedBody.chunks.length = 0;
      if (bufferedBody.ended) {
        upstreamReq.end();
      } else {
        bufferedBody.onChunk = (chunk) => upstreamReq.write(chunk);
        bufferedBody.onEnd = () => upstreamReq.end();
      }
    } else {
      req.pipe(upstreamReq);
      req.on("error", () => {
        upstreamReq.destroy();
      });
    }
  }

  const server = http.createServer(async (req, res) => {
    req.on("error", () => {});
    res.on("error", () => {});

    const cleanPath = stripQuery(req.url || "/");
    if (cleanPath === CONTROL_PREFIX || cleanPath.startsWith(`${CONTROL_PREFIX}/`)) {
      await handleControlRequest(req, res, cleanPath);
      return;
    }

    const startTime = performance.now();
    const { idempotencyKey, keyTag } = inspectIdempotencyKey(req.headers);
    const matched = ruleEngine.matchRequest({ method: req.method, path: cleanPath });

    if (!matched) {
      forwardToTarget({
        req,
        res,
        startTime,
        cleanPath,
        idempotencyKey,
        keyTag,
        ruleId: null,
        dropResponseAfterForward: false,
      });
      return;
    }

    const { ruleId, action, waitForRelease } = matched;

    if (action.type === "drop_request") {
      recordLog({
        startTime,
        method: req.method,
        path: cleanPath,
        status: "dropped",
        idempotencyKey,
        keyTag,
        ruleId,
      });
      destroySocket(req.socket, false);
      return;
    }

    if (action.type === "reset") {
      recordLog({
        startTime,
        method: req.method,
        path: cleanPath,
        status: "reset",
        idempotencyKey,
        keyTag,
        ruleId,
      });
      destroySocket(req.socket, true);
      return;
    }

    if (action.type === "status") {
      req.resume();
      recordLog({
        startTime,
        method: req.method,
        path: cleanPath,
        status: "synthetic",
        idempotencyKey,
        keyTag,
        ruleId,
      });
      if (action.body === undefined || action.body === null) {
        res.writeHead(action.code, {
          "content-length": "0",
          "cache-control": "no-store",
        });
        res.end();
        return;
      }
      const isObjectBody = typeof action.body === "object";
      const bodyString = isObjectBody ? JSON.stringify(action.body) : String(action.body);
      let contentType = "text/plain; charset=utf-8";
      if (isObjectBody) {
        contentType = "application/json; charset=utf-8";
      } else {
        const trimmed = bodyString.trim();
        if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
          contentType = "application/json; charset=utf-8";
        }
      }
      res.writeHead(action.code, {
        "content-type": contentType,
        "content-length": String(Buffer.byteLength(bodyString)),
        "cache-control": "no-store",
      });
      res.end(bodyString);
      return;
    }

    if (action.type === "drop_response_after_forward") {
      forwardToTarget({
        req,
        res,
        startTime,
        cleanPath,
        idempotencyKey,
        keyTag,
        ruleId,
        dropResponseAfterForward: true,
      });
      return;
    }

    if (action.type === "delay") {
      const bufferedBody = bufferIncomingBody(req);
      await sleep(action.ms);
      if (closing) {
        destroySocket(req.socket, false);
        return;
      }
      forwardToTarget({
        req,
        res,
        startTime,
        cleanPath,
        idempotencyKey,
        keyTag,
        ruleId,
        dropResponseAfterForward: false,
        bufferedBody,
      });
      return;
    }

    if (action.type === "hold") {
      const bufferedBody = bufferIncomingBody(req);
      await waitForRelease;
      if (closing) {
        destroySocket(req.socket, false);
        return;
      }
      forwardToTarget({
        req,
        res,
        startTime,
        cleanPath,
        idempotencyKey,
        keyTag,
        ruleId,
        dropResponseAfterForward: false,
        bufferedBody,
      });
    }
  });

  server.on("connection", (socket) => {
    openSockets.add(socket);
    socket.on("close", () => openSockets.delete(socket));
    socket.on("error", () => {});
  });

  // WebSocket upgrade pass-through (no faults injected on WS).
  server.on("upgrade", (req, clientSocket, head) => {
    clientSocket.on("error", () => {});
    const cleanPath = stripQuery(req.url || "/");
    if (cleanPath === CONTROL_PREFIX || cleanPath.startsWith(`${CONTROL_PREFIX}/`)) {
      clientSocket.destroy();
      return;
    }

    const upstreamReq = transport.request({
      protocol: targetUrl.protocol,
      hostname: targetUrl.hostname,
      port: targetPort,
      method: req.method || "GET",
      path: buildTargetPath(targetUrl.pathname, req.url),
      headers: buildForwardHeaders(req.headers, targetUrl.host),
    });

    activeUpstreamRequests.add(upstreamReq);
    upstreamReq.on("close", () => activeUpstreamRequests.delete(upstreamReq));
    upstreamReq.on("error", () => clientSocket.destroy());

    upstreamReq.on("upgrade", (proxyRes, proxySocket, proxyHead) => {
      proxySocket.on("error", () => clientSocket.destroy());
      clientSocket.on("error", () => proxySocket.destroy());

      const statusLine = `HTTP/1.1 ${proxyRes.statusCode ?? 101} ${proxyRes.statusMessage || "Switching Protocols"}\r\n`;
      const headerLines = [];
      const rawHeaders = proxyRes.rawHeaders ?? [];
      for (let i = 0; i < rawHeaders.length; i += 2) {
        headerLines.push(`${rawHeaders[i]}: ${rawHeaders[i + 1]}\r\n`);
      }
      clientSocket.write(`${statusLine}${headerLines.join("")}\r\n`);
      if (proxyHead && proxyHead.length > 0) {
        clientSocket.write(proxyHead);
      }
      if (head && head.length > 0) {
        proxySocket.write(head);
      }
      proxySocket.pipe(clientSocket);
      clientSocket.pipe(proxySocket);
    });

    upstreamReq.on("response", (proxyRes) => {
      const statusLine = `HTTP/1.1 ${proxyRes.statusCode ?? 502} ${proxyRes.statusMessage || ""}\r\n`;
      const headerLines = [];
      const rawHeaders = proxyRes.rawHeaders ?? [];
      for (let i = 0; i < rawHeaders.length; i += 2) {
        headerLines.push(`${rawHeaders[i]}: ${rawHeaders[i + 1]}\r\n`);
      }
      clientSocket.write(`${statusLine}${headerLines.join("")}\r\n`);
      proxyRes.pipe(clientSocket);
    });

    upstreamReq.end();
  });

  const assignedPort = await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen({ port, host }, () => {
      const address = server.address();
      const boundPort = typeof address === "object" && address ? address.port : 0;
      if (!boundPort) {
        rejectListen(new Error("startFaultProxy: failed to bind a TCP port"));
        return;
      }
      resolveListen(boundPort);
    });
  });

  const proxyOrigin = buildOrigin(assignedPort, "http", host);

  async function close() {
    if (closing) return;
    closing = true;
    ruleEngine.clearRules();
    for (const upstreamReq of activeUpstreamRequests) {
      upstreamReq.destroy();
    }
    activeUpstreamRequests.clear();
    for (const socket of openSockets) {
      socket.destroy();
    }
    openSockets.clear();
    await new Promise((resolveClose) => {
      server.close(() => resolveClose());
    });
  }

  return {
    port: assignedPort,
    origin: proxyOrigin,
    close,
  };
}

function targetFromRunDir(runDir) {
  if (!runDir) return "";
  const envFile = harnessPaths(runDir).envFile;
  if (!existsSync(envFile)) return "";
  const text = readFileSync(envFile, "utf8");
  return /^API_ORIGIN=(.*)$/m.exec(text)?.[1]?.trim() ?? "";
}

/**
 * Parses CLI arguments for `node proxy.mjs --target <origin> [--port N] --log <file>`.
 */
export function parseProxyArgs(argv = [], env = process.env) {
  let target = "";
  let port = 0;
  let logFile = "";
  let runDir = "";

  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] ?? "");
    if (arg === "--target") {
      target = String(argv[++i] ?? "").trim();
    } else if (arg.startsWith("--target=")) {
      target = arg.slice("--target=".length).trim();
    } else if (arg === "--port") {
      const rawPort = String(argv[++i] ?? "").trim();
      if (!/^\d+$/.test(rawPort)) {
        throw new Error(`invalid --port "${rawPort}"`);
      }
      port = Number(rawPort);
    } else if (arg.startsWith("--port=")) {
      const rawPort = arg.slice("--port=".length).trim();
      if (!/^\d+$/.test(rawPort)) {
        throw new Error(`invalid --port "${rawPort}"`);
      }
      port = Number(rawPort);
    } else if (arg === "--log") {
      logFile = String(argv[++i] ?? "").trim();
    } else if (arg.startsWith("--log=")) {
      logFile = arg.slice("--log=".length).trim();
    } else if (arg === "--run-dir") {
      runDir = String(argv[++i] ?? "").trim();
    } else if (arg.startsWith("--run-dir=")) {
      runDir = arg.slice("--run-dir=".length).trim();
    } else {
      throw new Error(`unknown argument ${arg}`);
    }
  }

  const effectiveRunDir = runDir || env.HARNESS_RUN_DIR?.trim() || "";
  const resolvedTarget = target || targetFromRunDir(effectiveRunDir);
  const resolvedLogFile =
    logFile || (effectiveRunDir ? join(harnessPaths(effectiveRunDir).logDir, "fault-proxy.jsonl") : "");

  if (!resolvedTarget) {
    throw new Error("usage: node proxy.mjs --target <origin> [--port N] --log <file>");
  }

  return {
    target: resolvedTarget,
    port,
    logFile: resolvedLogFile || undefined,
  };
}

if (isMainModule({ moduleUrl: import.meta.url })) {
  (async () => {
    const options = parseProxyArgs(process.argv.slice(2), process.env);
    const proxy = await startFaultProxy(options);
    process.stdout.write(`FAULT_PROXY_ORIGIN=${proxy.origin}\n`);
    const shutdown = async () => {
      await proxy.close();
      process.exit(0);
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  })().catch((error) => {
    process.stderr.write(`proxy.mjs: ${error.message}\n`);
    process.exit(1);
  });
}
