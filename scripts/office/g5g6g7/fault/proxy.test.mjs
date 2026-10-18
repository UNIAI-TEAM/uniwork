/* global process, Buffer, fetch */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { origin as buildOrigin } from "../harness/lib.mjs";
import {
  SERVER_VERSIONS_FILENAME,
  VERSIONS_ROUTE_TEMPLATE,
  collectServerVersions,
  documentVersionsPath,
  parseCollectArgs,
  writeServerVersions,
} from "./collect.mjs";
import { parseProxyArgs, startFaultProxy } from "./proxy.mjs";

const proxyScriptPath = fileURLToPath(new URL("./proxy.mjs", import.meta.url));

/**
 * Starts a local in-process upstream HTTP (+ WebSocket upgrade) test server.
 */
async function startUpstreamServer() {
  const received = [];
  const sockets = new Set();

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on("end", () => {
      const bodyBuffer = Buffer.concat(chunks);
      const record = {
        method: req.method,
        url: req.url,
        headers: { ...req.headers },
        bodyBuffer,
        bodyText: bodyBuffer.toString("utf8"),
      };
      received.push(record);

      if (req.url?.startsWith("/api/v1/documents/doc_1/versions/commit")) {
        const payload = JSON.stringify({
          document: { id: "doc_1", revision: "2", current_version: 2 },
          version: { id: "ver_2", document_id: "doc_1", version: 2 },
        });
        res.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "content-length": String(Buffer.byteLength(payload)),
        });
        res.end(payload);
        return;
      }

      if (req.url?.startsWith("/api/v1/documents/doc_1/uploads")) {
        const sha256 = crypto.createHash("sha256").update(bodyBuffer).digest("hex");
        const payload = JSON.stringify({
          upload_id: "upl_1",
          checksum_sha256: sha256,
          size_bytes: bodyBuffer.length,
        });
        res.writeHead(201, {
          "content-type": "application/json; charset=utf-8",
          "content-length": String(Buffer.byteLength(payload)),
        });
        res.end(payload);
        return;
      }

      if (req.url === "/api/v1/documents/doc_paged/versions") {
        const payload = JSON.stringify({
          versions: [{ id: "ver_2", document_id: "doc_paged", version: 2, reason: "manual" }],
          next_cursor: "cur_page_2",
        });
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(payload);
        return;
      }

      if (req.url === "/api/v1/documents/doc_paged/versions?cursor=cur_page_2") {
        const payload = JSON.stringify({
          versions: [{ id: "ver_1", document_id: "doc_paged", version: 1, reason: "upload" }],
          next_cursor: null,
        });
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(payload);
        return;
      }

      if (req.url === "/api/v1/documents/doc_archived/versions") {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ versions: [{ id: "ver_1", document_id: "doc_archived", version: 1 }], next_cursor: null }));
        return;
      }

      if (req.url === "/api/v1/documents/doc_archived") {
        res.writeHead(410, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: { code: "document_deleted" } }));
        return;
      }

      if (req.url === "/api/v1/documents/doc_paged") {
        const payload = JSON.stringify({ document: { id: "doc_paged", revision: "7" } });
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(payload);
        return;
      }

      if (req.url === "/api/v1/documents/doc_lease/office/offline-lease") {
        const payload = JSON.stringify({
          document_id: "doc_lease",
          lease_id: "lease_1",
          expires_at: "2099-01-01T00:00:00.000Z",
          state: "active",
        });
        res.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "content-length": String(Buffer.byteLength(payload)),
        });
        res.end(payload);
        return;
      }

      if (req.url === "/api/v1/documents/doc_lease/office/plain") {
        const payload = "not-json-body: lease note";
        res.writeHead(200, {
          "content-type": "text/plain; charset=utf-8",
          "content-length": String(Buffer.byteLength(payload)),
        });
        res.end(payload);
        return;
      }

      if (req.url === "/api/v1/documents/doc_lease/office/broken") {
        const payload = '{"expires_at": ';
        res.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "content-length": String(Buffer.byteLength(payload)),
        });
        res.end(payload);
        return;
      }

      const echo = JSON.stringify({
        ok: true,
        method: req.method,
        url: req.url,
        host: req.headers.host,
        bytes: bodyBuffer.length,
      });
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(echo);
    });
  });

  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  server.on("upgrade", (req, socket, head) => {
    received.push({
      method: req.method,
      url: req.url,
      headers: { ...req.headers },
      upgrade: true,
    });
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n\r\n",
    );
    if (head && head.length > 0) {
      socket.write(head);
    }
    socket.on("data", (chunk) => {
      socket.write(Buffer.from(`ws-echo:${chunk.toString("utf8")}`));
    });
  });

  const port = await new Promise((resolvePort, rejectPort) => {
    server.once("error", rejectPort);
    server.listen({ port: 0, host: "127.0.0.1" }, () => {
      const address = server.address();
      resolvePort(typeof address === "object" && address ? address.port : 0);
    });
  });

  return {
    port,
    origin: buildOrigin(port),
    received,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolveClose) => server.close(() => resolveClose()));
    },
  };
}

function parseJsonl(text) {
  return String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test("proxy forwards methods, rewrites Host to target, passes multipart intact, and never forwards control paths", async (t) => {
  const scratchDir = mkdtempSync(join(tmpdir(), "fault-proxy-test-"));
  const logFile = join(scratchDir, "proxy.jsonl");
  const upstream = await startUpstreamServer();
  const proxy = await startFaultProxy({ target: upstream.origin, logFile });

  t.after(async () => {
    await proxy.close();
    await upstream.close();
    rmSync(scratchDir, { recursive: true, force: true });
  });

  // Control endpoints are handled locally and never forwarded to upstream.
  const rulesInitRes = await fetch(`${proxy.origin}/__fault/rules`);
  assert.equal(rulesInitRes.status, 200);
  assert.deepEqual(await rulesInitRes.json(), []);
  assert.equal(upstream.received.length, 0);

  const unknownCtrlRes = await fetch(`${proxy.origin}/__fault/nonexistent`);
  assert.equal(unknownCtrlRes.status, 404);
  assert.equal(upstream.received.length, 0);

  // Multipart upload with binary bytes passes through intact and Host header matches upstream.
  const boundary = "----UniWorkFaultProxyBoundary9f8e7d";
  const binaryPayload = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0x10, 0x20, 0x7f, 0x80]);
  const multipartHead = Buffer.from(
    `--${boundary}\r\n` +
      'Content-Disposition: form-data; name="title"\r\n\r\n' +
      "Báo cáo tài chính Q4\r\n" +
      `--${boundary}\r\n` +
      'Content-Disposition: form-data; name="file"; filename="report.docx"\r\n' +
      "Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\r\n\r\n",
    "utf8",
  );
  const multipartTail = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  const multipartBody = Buffer.concat([multipartHead, binaryPayload, multipartTail]);
  const expectedSha256 = crypto.createHash("sha256").update(multipartBody).digest("hex");

  const uploadRes = await fetch(`${proxy.origin}/api/v1/documents/doc_1/uploads?sig=secret-query-token`, {
    method: "POST",
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`,
      authorization: "Bearer super-secret-jwt-token",
      cookie: "uw_refresh=secret-refresh-cookie",
      "idempotency-key": "idem-secret-key-001",
    },
    body: multipartBody,
  });
  assert.equal(uploadRes.status, 201);
  const uploadJson = await uploadRes.json();
  assert.equal(uploadJson.size_bytes, multipartBody.length);
  assert.equal(uploadJson.checksum_sha256, expectedSha256);

  assert.equal(upstream.received.length, 1);
  assert.equal(upstream.received[0].headers.host, `127.0.0.1:${upstream.port}`);
  assert.equal(Buffer.compare(upstream.received[0].bodyBuffer, multipartBody), 0);
});

test("proxy proves delay, drop_request, drop_response_after_forward, status, reset, nth, once, and hold + release", async (t) => {
  const scratchDir = mkdtempSync(join(tmpdir(), "fault-proxy-actions-"));
  const logFile = join(scratchDir, "actions.jsonl");
  const upstream = await startUpstreamServer();
  const proxy = await startFaultProxy({ target: upstream.origin, logFile });

  t.after(async () => {
    await proxy.close();
    await upstream.close();
    rmSync(scratchDir, { recursive: true, force: true });
  });

  // 1. drop_response_after_forward with once: true (timeout-after-commit):
  // Upstream sees the commit request and responds 200, but the client gets a socket error.
  const setRulesRes = await fetch(`${proxy.origin}/__fault/rules`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify([
      {
        id: "commit-drop-after-forward",
        match: { method: "POST", path: "^/api/v1/documents/doc_1/versions/commit$" },
        action: { type: "drop_response_after_forward" },
        once: true,
      },
    ]),
  });
  assert.equal(setRulesRes.status, 200);

  await assert.rejects(
    fetch(`${proxy.origin}/api/v1/documents/doc_1/versions/commit`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "idem-commit-1",
      },
      body: JSON.stringify({ upload_id: "upl_1", base_revision: "1" }),
    }),
  );
  // Upstream saw the request exactly once!
  assert.equal(upstream.received.length, 1);
  assert.equal(upstream.received[0].url, "/api/v1/documents/doc_1/versions/commit");

  // Retry with the same key succeeds because `once: true` disarmed the rule after the first hit.
  const retryRes = await fetch(`${proxy.origin}/api/v1/documents/doc_1/versions/commit`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": "idem-commit-1",
    },
    body: JSON.stringify({ upload_id: "upl_1", base_revision: "1" }),
  });
  assert.equal(retryRes.status, 200);
  assert.equal(upstream.received.length, 2);

  // 2. drop_request: never forwarded to upstream, client socket destroyed.
  await fetch(`${proxy.origin}/__fault/rules`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify([
      {
        id: "drop-before-forward",
        match: { method: "POST", path: "/drop-req$" },
        action: { type: "drop_request" },
      },
    ]),
  });
  const countBeforeDrop = upstream.received.length;
  await assert.rejects(fetch(`${proxy.origin}/api/v1/drop-req`, { method: "POST", body: "never-sent" }));
  assert.equal(upstream.received.length, countBeforeDrop);

  // 3. reset: socket reset before forwarding, upstream never sees it.
  await fetch(`${proxy.origin}/__fault/rules`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify([
      {
        id: "reset-before-forward",
        match: { method: "GET", path: "/reset-me$" },
        action: { type: "reset" },
      },
    ]),
  });
  await assert.rejects(fetch(`${proxy.origin}/api/v1/reset-me`));
  assert.equal(upstream.received.length, countBeforeDrop);

  // 4. status override + nth: only the 2nd request gets synthetic 409, 1st and 3rd pass through.
  await fetch(`${proxy.origin}/__fault/rules`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify([
      {
        id: "conflict-on-second",
        match: { method: "POST", path: "/nth-check$", nth: 2 },
        action: {
          type: "status",
          code: 409,
          body: { error: "document_version_conflict", fields: { current_revision: "9" } },
        },
      },
    ]),
  });
  const nth1 = await fetch(`${proxy.origin}/api/v1/nth-check`, { method: "POST", body: "req-1" });
  assert.equal(nth1.status, 200);
  assert.equal(upstream.received.length, countBeforeDrop + 1);

  const nth2 = await fetch(`${proxy.origin}/api/v1/nth-check`, { method: "POST", body: "req-2" });
  assert.equal(nth2.status, 409);
  assert.deepEqual(await nth2.json(), {
    error: "document_version_conflict",
    fields: { current_revision: "9" },
  });
  // Synthetic status was NOT forwarded to upstream.
  assert.equal(upstream.received.length, countBeforeDrop + 1);

  const nth3 = await fetch(`${proxy.origin}/api/v1/nth-check`, { method: "POST", body: "req-3" });
  assert.equal(nth3.status, 200);
  assert.equal(upstream.received.length, countBeforeDrop + 2);

  // 5. delay: delays before forwarding to upstream.
  await fetch(`${proxy.origin}/__fault/rules`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify([
      {
        id: "delay-60ms",
        match: { method: "GET", path: "/delayed$" },
        action: { type: "delay", ms: 60 },
      },
    ]),
  });
  const t0 = Date.now();
  const delayedRes = await fetch(`${proxy.origin}/api/v1/delayed`);
  const elapsed = Date.now() - t0;
  assert.equal(delayedRes.status, 200);
  assert.ok(elapsed >= 45, `expected delay >= 45ms, got ${elapsed}ms`);

  // 6. hold + POST /__fault/release/<ruleId>: held before forward until released.
  await fetch(`${proxy.origin}/__fault/rules`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify([
      {
        id: "hold-race",
        match: { method: "POST", path: "/cancel-race$" },
        action: { type: "hold", until: "release" },
      },
    ]),
  });

  const countBeforeHold = upstream.received.length;
  let holdFinished = false;
  const heldPromise = fetch(`${proxy.origin}/api/v1/cancel-race`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ step: "held" }),
  }).then(async (res) => {
    holdFinished = true;
    return res;
  });

  // Wait until the proxy records the request as held.
  for (let i = 0; i < 40; i += 1) {
    const rulesState = await (await fetch(`${proxy.origin}/__fault/rules`)).json();
    if (rulesState[0]?.held === 1) break;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.equal(holdFinished, false);
  assert.equal(upstream.received.length, countBeforeHold);

  const releaseRes = await fetch(`${proxy.origin}/__fault/release/hold-race`, { method: "POST" });
  assert.equal(releaseRes.status, 200);
  const releaseJson = await releaseRes.json();
  assert.equal(releaseJson.ok, true);
  assert.equal(releaseJson.ruleId, "hold-race");
  assert.equal(releaseJson.released, 1);

  const heldRes = await heldPromise;
  assert.equal(heldRes.status, 200);
  assert.equal(upstream.received.length, countBeforeHold + 1);
  assert.equal(upstream.received.at(-1).bodyText, JSON.stringify({ step: "held" }));

  // DELETE /__fault/rules clears all rules.
  const delRes = await fetch(`${proxy.origin}/__fault/rules`, { method: "DELETE" });
  assert.equal(delRes.status, 200);
  assert.deepEqual(await delRes.json(), []);
});

test("proxy log records required fields only and never logs bodies, Authorization, cookies, tokens or key values", async (t) => {
  const scratchDir = mkdtempSync(join(tmpdir(), "fault-proxy-log-"));
  const logFile = join(scratchDir, "sanitized.jsonl");
  const upstream = await startUpstreamServer();
  const proxy = await startFaultProxy({
    target: upstream.origin,
    logFile,
    rules: [
      {
        id: "synthetic-status",
        match: { method: "POST", path: "/synthetic$" },
        action: { type: "status", code: 503, body: { secret_response: "NEVER_LOG_RESPONSE_BODY" } },
      },
    ],
  });

  t.after(async () => {
    await proxy.close();
    await upstream.close();
    rmSync(scratchDir, { recursive: true, force: true });
  });

  const secretBearer = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.SECRET_BEARER_VALUE";
  const secretCookie = "uw_session=SECRET_COOKIE_VALUE";
  const secretIdemKey = "idem-key-SECRET-VALUE-9999";
  const secretIdemKey2 = "idem-key-OTHER-SECRET-VALUE-8888";
  const secretBody = JSON.stringify({ content: "SECRET_REQUEST_BODY_TEXT" });
  const secretQuery = "ticket=SECRET_QUERY_TICKET&sig=SECRET_SIGNATURE";

  const res1 = await fetch(`${proxy.origin}/api/v1/documents/doc_1/versions/commit?${secretQuery}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secretBearer}`,
      cookie: secretCookie,
      "idempotency-key": secretIdemKey,
      "content-type": "application/json",
    },
    body: secretBody,
  });
  assert.equal(res1.status, 200);

  // Second request with the same Idempotency-Key produces the same keyTag.
  const res1Replay = await fetch(`${proxy.origin}/api/v1/documents/doc_1/versions/commit?${secretQuery}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secretBearer}`,
      cookie: secretCookie,
      "idempotency-key": secretIdemKey,
      "content-type": "application/json",
    },
    body: secretBody,
  });
  assert.equal(res1Replay.status, 200);

  // Request with a different Idempotency-Key produces a different keyTag.
  const resOtherKey = await fetch(`${proxy.origin}/api/v1/documents/doc_1/versions/commit`, {
    method: "POST",
    headers: {
      "idempotency-key": secretIdemKey2,
      "content-type": "application/json",
    },
    body: secretBody,
  });
  assert.equal(resOtherKey.status, 200);

  const res2 = await fetch(`${proxy.origin}/api/v1/synthetic?${secretQuery}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secretBearer}`,
      cookie: secretCookie,
      "content-type": "application/json",
    },
    body: secretBody,
  });
  assert.equal(res2.status, 503);

  const logEndpointText = await (await fetch(`${proxy.origin}/__fault/log`)).text();
  const diskLogText = readFileSync(logFile, "utf8");
  assert.equal(logEndpointText, diskLogText);

  for (const forbidden of [
    secretBearer,
    secretCookie,
    secretIdemKey,
    secretIdemKey2,
    "SECRET_REQUEST_BODY_TEXT",
    "NEVER_LOG_RESPONSE_BODY",
    "SECRET_QUERY_TICKET",
    "SECRET_SIGNATURE",
  ]) {
    assert.equal(
      logEndpointText.includes(forbidden),
      false,
      `log leaked forbidden value: ${forbidden}`,
    );
  }

  const lines = parseJsonl(logEndpointText);
  assert.equal(lines.length, 4);

  assert.equal(lines[0].method, "POST");
  assert.equal(lines[0].path, "/api/v1/documents/doc_1/versions/commit");
  assert.equal(lines[0].status, 200);
  assert.equal(typeof lines[0].ms, "number");
  assert.equal(lines[0].idempotencyKey, true);
  assert.match(lines[0].keyTag, /^[0-9a-f]{12}$/);
  assert.equal(lines[0].ruleId, null);

  // Same key -> same 12-hex keyTag; different key -> different 12-hex keyTag.
  assert.equal(lines[1].idempotencyKey, true);
  assert.equal(lines[1].keyTag, lines[0].keyTag);

  assert.equal(lines[2].idempotencyKey, true);
  assert.match(lines[2].keyTag, /^[0-9a-f]{12}$/);
  assert.notEqual(lines[2].keyTag, lines[0].keyTag);

  assert.equal(lines[3].method, "POST");
  assert.equal(lines[3].path, "/api/v1/synthetic");
  assert.equal(lines[3].status, "synthetic");
  assert.equal(lines[3].idempotencyKey, false);
  assert.equal(lines[3].keyTag, null);
  assert.equal(lines[3].ruleId, "synthetic-status");
});

test("proxy passes WebSocket upgrade connections through and CLI prints FAULT_PROXY_ORIGIN", async (t) => {
  const scratchDir = mkdtempSync(join(tmpdir(), "fault-proxy-ws-"));
  const logFile = join(scratchDir, "ws.jsonl");
  const upstream = await startUpstreamServer();
  const proxy = await startFaultProxy({ target: upstream.origin, logFile });

  t.after(async () => {
    await proxy.close();
    await upstream.close();
    rmSync(scratchDir, { recursive: true, force: true });
  });

  // Verify WebSocket upgrade pass-through.
  const echoed = await new Promise((resolveEcho, rejectEcho) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port: proxy.port,
      path: "/api/v1/ws?workspace_slug=org/ws",
      method: "GET",
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
      },
    });
    req.on("error", rejectEcho);
    req.on("upgrade", (_res, socket) => {
      socket.once("data", (chunk) => {
        socket.destroy();
        resolveEcho(chunk.toString("utf8"));
      });
      socket.write("ping-frame");
    });
    req.end();
  });
  assert.equal(echoed, "ws-echo:ping-frame");

  // Verify parseProxyArgs and CLI startup line `FAULT_PROXY_ORIGIN=<origin>`.
  const parsedArgs = parseProxyArgs(["--target", upstream.origin, "--port", "0", "--log", logFile], {});
  assert.equal(parsedArgs.target, upstream.origin);
  assert.equal(parsedArgs.port, 0);
  assert.equal(parsedArgs.logFile, logFile);

  const cliOrigin = await new Promise((resolveLine, rejectLine) => {
    const child = spawn(
      process.execPath,
      [proxyScriptPath, "--target", upstream.origin, "--log", join(scratchDir, "cli.jsonl")],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      const match = /^FAULT_PROXY_ORIGIN=(http:\/\/127\.0\.0\.1:\d+)$/m.exec(stdout);
      if (match) {
        child.kill("SIGTERM");
        resolveLine(match[1]);
      }
    });
    child.on("error", rejectLine);
  });
  assert.match(cliOrigin, /^http:\/\/127\.0\.0\.1:\d+$/);
});

test("collect.mjs reads paginated document versions via public API, writes server-versions.json, and enforces FAULT_API_TOKEN from env only", async (t) => {
  const scratchDir = mkdtempSync(join(tmpdir(), "fault-collect-"));
  const upstream = await startUpstreamServer();

  t.after(async () => {
    await upstream.close();
    rmSync(scratchDir, { recursive: true, force: true });
  });

  assert.equal(VERSIONS_ROUTE_TEMPLATE, "/api/v1/documents/{documentID}/versions");
  assert.equal(documentVersionsPath("doc_paged", "cur_2"), "/api/v1/documents/doc_paged/versions?cursor=cur_2");

  // Token on argv is strictly rejected.
  assert.throws(
    () =>
      parseCollectArgs(
        ["--api-origin", upstream.origin, "--document-id", "doc_paged", "--token", "secret", "--out-dir", scratchDir],
        { FAULT_API_TOKEN: "env-token" },
      ),
    /refuses token on argv/,
  );

  // Missing FAULT_API_TOKEN in env is rejected.
  assert.throws(
    () =>
      parseCollectArgs(["--api-origin", upstream.origin, "--document-id", "doc_paged", "--out-dir", scratchDir], {}),
    /missing FAULT_API_TOKEN/,
  );

  const parsed = parseCollectArgs(
    ["--api-origin", upstream.origin, "--document-id", "doc_paged", "--out-dir", scratchDir],
    { FAULT_API_TOKEN: "test-bearer-token-123" },
  );
  assert.equal(parsed.apiOrigin, upstream.origin);
  assert.equal(parsed.documentId, "doc_paged");
  assert.equal(parsed.token, "test-bearer-token-123");

  const collected = await collectServerVersions(parsed);
  assert.equal(collected.document_id, "doc_paged");
  assert.equal(collected.versions.length, 2);
  assert.deepEqual(
    collected.versions.map((v) => v.version),
    [2, 1],
  );
  // matrix §4: server-versions.json is {documentId, readAt, head: {revision}, versions}
  assert.deepEqual(Object.keys(collected).sort(), ["documentId", "document_id", "head", "next_cursor", "readAt", "versions"]);
  assert.deepEqual(collected.head, { revision: "7" });
  assert.ok(!Number.isNaN(Date.parse(collected.readAt)), "readAt is a timestamp");
  // the version list is the evidence: an unreadable head is reported, never a revision and never a failed case
  const archived = await collectServerVersions({ ...parsed, documentId: "doc_archived" });
  assert.equal(archived.versions.length, 1);
  assert.equal(archived.head.revision, null);
  assert.match(archived.head.error, /410/);

  const { filePath } = await writeServerVersions(parsed);
  assert.equal(filePath, join(scratchDir, SERVER_VERSIONS_FILENAME));
  assert.equal(existsSync(filePath), true);
  const written = JSON.parse(readFileSync(filePath, "utf8"));
  assert.equal(written.versions.length, 2);
  assert.deepEqual(written.head, { revision: "7" });
  assert.equal(typeof written.readAt, "string");
  assert.equal(JSON.stringify(written).includes("test-bearer-token-123"), false);
});

test("rewrite_json patches a matched JSON response, resolves now_plus_ms, and passes non-JSON or non-matching traffic through untouched", async (t) => {
  const scratchDir = mkdtempSync(join(tmpdir(), "fault-proxy-rewrite-"));
  const logFile = join(scratchDir, "rewrite.jsonl");
  const upstream = await startUpstreamServer();
  const proxy = await startFaultProxy({ target: upstream.origin, logFile });

  t.after(async () => {
    await proxy.close();
    await upstream.close();
    rmSync(scratchDir, { recursive: true, force: true });
  });

  const setRulesRes = await fetch(`${proxy.origin}/__fault/rules`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify([
      {
        id: "lease-rewrite",
        match: {
          method: "PUT",
          path: "^/api/v1/documents/[^/]+/office/(offline-lease|plain|broken)$",
        },
        action: { type: "rewrite_json", patch: { expires_at: { now_plus_ms: 120000 } } },
      },
    ]),
  });
  assert.equal(setRulesRes.status, 200);

  // (a) matched JSON response: expires_at replaced, every other field preserved.
  const before = Date.now();
  const leaseRes = await fetch(`${proxy.origin}/api/v1/documents/doc_lease/office/offline-lease`, {
    method: "PUT",
  });
  assert.equal(leaseRes.status, 200);
  const rawBody = await leaseRes.text();
  const body = JSON.parse(rawBody);
  assert.equal(body.document_id, "doc_lease");
  assert.equal(body.lease_id, "lease_1");
  assert.equal(body.state, "active");
  assert.notEqual(body.expires_at, "2099-01-01T00:00:00.000Z");
  assert.equal(leaseRes.headers.get("content-length"), String(Buffer.byteLength(rawBody)));

  // (b) now_plus_ms resolves to a future ISO-8601 UTC timestamp with milliseconds.
  assert.match(body.expires_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  const expiresMs = Date.parse(body.expires_at);
  assert.ok(!Number.isNaN(expiresMs), `expires_at is a timestamp: ${body.expires_at}`);
  const delta = expiresMs - before;
  assert.ok(delta > 60_000 && delta < 300_000, `expected ~120s in the future, got ${delta}ms`);

  // Log entry keeps the upstream status and the ruleId.
  const logLines = parseJsonl(await (await fetch(`${proxy.origin}/__fault/log`)).text());
  assert.equal(logLines.length, 1);
  assert.equal(logLines[0].status, 200);
  assert.equal(logLines[0].ruleId, "lease-rewrite");
  assert.equal(logLines[0].path, "/api/v1/documents/doc_lease/office/offline-lease");

  // (c) a matched non-JSON body passes through byte-for-byte.
  const plainText = "not-json-body: lease note";
  const plainRes = await fetch(`${proxy.origin}/api/v1/documents/doc_lease/office/plain`, { method: "PUT" });
  assert.equal(plainRes.status, 200);
  assert.equal(await plainRes.text(), plainText);
  assert.equal(plainRes.headers.get("content-length"), String(Buffer.byteLength(plainText)));

  // (c2) a JSON content-type with an unparseable body also passes through byte-for-byte.
  const brokenText = '{"expires_at": ';
  const brokenRes = await fetch(`${proxy.origin}/api/v1/documents/doc_lease/office/broken`, { method: "PUT" });
  assert.equal(brokenRes.status, 200);
  assert.equal(await brokenRes.text(), brokenText);
  assert.equal(brokenRes.headers.get("content-length"), String(Buffer.byteLength(brokenText)));

  // (d) a non-matching request is untouched.
  const echoRes = await fetch(`${proxy.origin}/api/v1/other`);
  assert.equal(echoRes.status, 200);
  const echo = await echoRes.json();
  assert.equal(echo.ok, true);
  assert.equal(echo.url, "/api/v1/other");
});
