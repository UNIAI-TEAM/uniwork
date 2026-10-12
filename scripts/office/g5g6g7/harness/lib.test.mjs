// Pure-helper tests for the G7-01 app harness (UNI-1376, item C). The stack
// itself only runs on the cloud VM; what is cheap and worth pinning here is the
// part that decides where a run points: fresh ports and the environment handed
// to the server, the web and the app.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { BLOCKED_EXIT, DEFAULT_FORK_SHA, buildServerEnv, evidenceLine, forkCacheDir, freePorts, harnessPaths, origin, writeRunEnv } from "./lib.mjs";

test("freePorts hands out distinct ports the kernel just released", async () => {
  const ports = await freePorts(3);
  assert.equal(ports.length, 3);
  assert.equal(new Set(ports).size, 3);
  for (const port of ports) {
    assert.ok(Number.isInteger(port) && port > 0 && port < 65536, `${port} is not a port`);
  }
});

test("freePorts refuses a non-positive count", async () => {
  await assert.rejects(() => freePorts(0), /positive count/);
});

test("BLOCKED is 77 so a missing precondition is never mistaken for a pass", () => {
  assert.equal(BLOCKED_EXIT, 77);
});

test("the default fork revision is the pinned base", () => {
  assert.equal(DEFAULT_FORK_SHA, "0d03b18");
});

test("buildServerEnv puts every port-derived origin on the command line", () => {
  const env = buildServerEnv({
    apiPort: 18080,
    webPort: 13000,
    metricsPort: 19090,
    previewPort: 13001,
    databaseUrl: "postgres://u:p@localhost:5432/db?sslmode=disable",
    redisUrl: "redis://localhost:6379",
    uploadDir: "/tmp/harness-uploads",
  });
  assert.equal(env.PORT, "18080");
  assert.equal(env.FRONTEND_ORIGIN, "http://127.0.0.1:13000");
  assert.equal(env.API_PUBLIC_URL, "http://127.0.0.1:18080");
  assert.equal(env.NEXT_PUBLIC_API_URL, "http://127.0.0.1:18080");
  assert.equal(env.NEXT_PUBLIC_WS_URL, "ws://127.0.0.1:18080");
  assert.equal(env.E2E_BASE_URL, "http://127.0.0.1:13000");
  // METRICS_ADDR is the listen address, not an origin (metrics/config.go:14).
  assert.equal(env.METRICS_ADDR, "127.0.0.1:19090");
  // The server refuses a PREVIEW_ORIGIN equal to FRONTEND_ORIGIN.
  assert.equal(env.PREVIEW_ORIGIN, "http://127.0.0.1:13001");
  assert.notEqual(env.PREVIEW_ORIGIN, env.FRONTEND_ORIGIN);
  assert.equal(env.STORAGE_BACKEND, "local");
  assert.equal(env.DATABASE_URL, "postgres://u:p@localhost:5432/db?sslmode=disable");
  // A stale .env LIVEKIT_URL must not reach the harness server (main.go:203).
  assert.equal(env.LIVEKIT_URL, "");
  assert.equal(env.LIVEKIT_API_KEY, "");
  assert.equal(env.LIVEKIT_API_SECRET, "");
});

test("buildServerEnv keeps the API origin identical everywhere it is inlined", () => {
  const env = buildServerEnv({ apiPort: 12345, webPort: 12300, metricsPort: 12400, previewPort: 12301, databaseUrl: "postgres://x", redisUrl: "redis://y", uploadDir: "/tmp/u" });
  assert.equal(env.API_PUBLIC_URL, env.NEXT_PUBLIC_API_URL);
  assert.equal(env.API_PUBLIC_URL, env.LOCAL_UPLOAD_BASE_URL);
});

test("origin builds a loopback origin for a port", () => {
  assert.equal(origin(8080), "http://127.0.0.1:8080");
  assert.equal(origin(8080, "ws"), "ws://127.0.0.1:8080");
});

test("harnessPaths keeps every run artifact inside the run dir", () => {
  const paths = harnessPaths("/tmp/run");
  for (const value of Object.values(paths)) assert.ok(value.startsWith("/tmp/run"), value);
  assert.equal(paths.envFile, "/tmp/run/ports.env");
  assert.equal(paths.pidFile, "/tmp/run/pids");
  assert.equal(paths.evidenceFile, "/tmp/run/evidence.jsonl");
});

test("forkCacheDir is keyed by the revision so two SHAs never share a checkout", () => {
  assert.equal(forkCacheDir("/cache", "0d03b18"), "/cache/uniwork-office-0d03b18");
  assert.notEqual(forkCacheDir("/cache", "aaaaaaa"), forkCacheDir("/cache", "bbbbbbb"));
});

test("evidenceLine carries every field the runner contract checks, empty when unknown", () => {
  const line = evidenceLine({ requirementId: "G7-A05", result: "PASS", exitCode: 0, dSha: "abc", fSha: "0d03b18" });
  for (const key of ["evidenceId", "requirementId", "dSha", "fSha", "pin", "platform", "build", "fixtureId", "fixtureSha256", "command", "exitCode", "result", "artifact", "checker", "blocker", "startedAt", "finishedAt"]) {
    assert.ok(key in line, `missing ${key}`);
  }
  assert.equal(line.result, "PASS");
  assert.equal(line.exitCode, 0);
  assert.equal(line.pin, "");
});

test("evidenceLine defaults to BLOCKED, never to PASS", () => {
  assert.equal(evidenceLine({}).result, "BLOCKED");
  assert.equal(evidenceLine({}).exitCode, -1);
});

test("evidenceLine keeps a fixture hash and a blocker out of a PASS", () => {
  // The runner's verify refuses a PASS that carries a blocker or a non-zero exit;
  // the writer here must not produce one in the first place.
  const blocked = evidenceLine({ result: "BLOCKED", blocker: "no D server on http://127.0.0.1:1", exitCode: 77 });
  assert.equal(blocked.result, "BLOCKED");
  assert.ok(blocked.blocker.length > 0);
  assert.notEqual(blocked.exitCode, 0);
});

test("writeRunEnv writes a ports file and a server env bash can source", async () => {
  const runDir = mkdtempSync(join(tmpdir(), "harness-lib-"));
  const previous = { DATABASE_URL: process.env.DATABASE_URL, REDIS_URL: process.env.REDIS_URL };
  process.env.DATABASE_URL = "postgres://u:p@localhost:5432/db?sslmode=disable";
  process.env.REDIS_URL = "redis://localhost:6379/0";
  try {
    const ports = await writeRunEnv(runDir, { forkSha: "0d03b18", dSha: "deadbeef" });
    assert.ok(ports.apiPort > 0 && ports.webPort > 0 && ports.metricsPort > 0 && ports.previewPort > 0);
    assert.equal(new Set([ports.apiPort, ports.webPort, ports.metricsPort, ports.previewPort]).size, 4);

    const portsFile = readFileSync(join(runDir, "ports.env"), "utf8");
    assert.match(portsFile, new RegExp(`API_ORIGIN=${ports.apiOrigin.replace(/\./g, "\\.")}`));
    assert.match(portsFile, /OFFICE_FORK_SHA=0d03b18/);
    assert.match(portsFile, /D_SHA=deadbeef/);

    // The env file is sourced by start.sh, so prove bash agrees with it — a URL
    // with a query string is the case that breaks an unquoted writer.
    const sourced = execFileSync("bash", ["-c", `. "${join(runDir, "server.env")}"; printf '%s|%s|%s' "$PORT" "$NEXT_PUBLIC_API_URL" "$DATABASE_URL"`], { encoding: "utf8" });
    assert.equal(sourced, `${ports.apiPort}|${ports.apiOrigin}|postgres://u:p@localhost:5432/db?sslmode=disable`);
  } finally {
    if (previous.DATABASE_URL === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous.DATABASE_URL;
    if (previous.REDIS_URL === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = previous.REDIS_URL;
  }
});
