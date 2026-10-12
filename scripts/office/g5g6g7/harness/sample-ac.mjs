/* global process, console, fetch */
// One sample acceptance case for G7-01 (UNI-1376, item C): prove the three
// pieces run together, on this run's ports, and record it in the evidence
// runner's JSON line shape.
//
// The case is G7-A05's runtime-manifest half, kept to what a dev build can
// actually show on a runner VM:
//
//   1. the D server answers /healthz and /readyz on this run's API port,
//   2. GET /api/v1/config names this run's API origin as office_api_origin
//      (the origin the web hands to the desktop app),
//   3. the web responds on this run's web port and its first /api/v1/ request
//      goes to that same origin (e2e/api-url.ts's rule: NEXT_PUBLIC_API_URL is
//      inlined at build time, so a mismatch means the run tests a stale build),
//   4. the running Electron app resolved that origin — it persists
//      UNIWORK_API_ORIGIN into userData/app-settings.json
//      (fork apps/shell/src/main/office-bridge-host.ts:84, called at
//      apps/shell/src/main/index.ts:5248),
//   5. the fork and pin revisions in the manifest match what was asked for.
//
// Steps 1-3 need only the server and the web; steps 4-5 are reported as BLOCKED
// (never PASS) when the app or the fork is not up, so a partial run cannot be
// mistaken for a passing one.
//
// Usage: node scripts/office/g5g6g7/harness/sample-ac.mjs [--run-dir <dir>]
// Exit: 0 PASS, 1 FAIL, 77 BLOCKED.
import { existsSync, readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { evidenceLine } from "./lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..", "..");
const BLOCKED = 77;

function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const runDir = argValue("--run-dir", process.env.HARNESS_RUN_DIR || join(REPO_ROOT, ".harness-run"));
const portsFile = join(runDir, "ports.env");
if (!existsSync(portsFile)) {
  console.error(`BLOCKED: no run at ${runDir} (missing ports.env); run start.sh first`);
  process.exit(BLOCKED);
}

const ports = Object.fromEntries(
  readFileSync(portsFile, "utf8")
    .split("\n")
    .filter((line) => line.trim() && !line.startsWith("#"))
    .map((line) => {
      const at = line.indexOf("=");
      return [line.slice(0, at), line.slice(at + 1)];
    }),
);

const API_ORIGIN = ports.API_ORIGIN;
const WEB_ORIGIN = ports.WEB_ORIGIN;
const startedAt = new Date().toISOString();
const checks = [];
const blockers = [];

/** Records one check; a thrown error is a FAIL, never a pass. */
async function check(name, run) {
  try {
    const detail = await run();
    checks.push({ name, result: "PASS", detail: detail ?? "" });
    return true;
  } catch (error) {
    checks.push({ name, result: "FAIL", detail: error.message });
    return false;
  }
}

function noteBlocker(name, reason) {
  checks.push({ name, result: "BLOCKED", detail: reason });
  blockers.push(`${name}: ${reason}`);
}

async function getJson(url, timeoutMs = 10_000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.json();
}

// ---- 1. the D server ---------------------------------------------------------
await check("D server answers /healthz", async () => {
  const body = await getJson(`${API_ORIGIN}/healthz`);
  if (body.status !== "ok") throw new Error(`status=${body.status}`);
  return "status=ok";
});

await check("D server /readyz reports its dependencies", async () => {
  const res = await fetch(`${API_ORIGIN}/readyz`, { signal: AbortSignal.timeout(10_000) });
  const body = await res.json().catch(() => ({}));
  if (res.status !== 200) throw new Error(`readyz -> ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
  return "readyz 200";
});

// ---- 2. the server names this run's origin for the desktop app ---------------
await check("GET /api/v1/config names this run's API origin", async () => {
  const config = await getJson(`${API_ORIGIN}/api/v1/config`);
  if (config.office_api_origin !== API_ORIGIN) {
    throw new Error(`office_api_origin=${JSON.stringify(config.office_api_origin)} but this run is ${API_ORIGIN}`);
  }
  return `office_api_origin=${config.office_api_origin} office_deployment_id=${config.office_deployment_id}`;
});

// ---- 3. the web serves and calls this run's API ------------------------------
await check("D web answers on this run's web port", async () => {
  const res = await fetch(`${WEB_ORIGIN}/login`, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`GET ${WEB_ORIGIN}/login -> ${res.status}`);
  const html = await res.text();
  if (!html.includes("<")) throw new Error("the web answered with an empty body");
  return `${res.status}, ${html.length} bytes`;
});

// The same rule e2e/api-url.ts pins, applied without a browser: the API origin
// the web build was given must be the one the server serves. A build with a
// different NEXT_PUBLIC_API_URL is the failure this check exists for.
await check("the web was built against this run's API origin", async () => {
  const html = await (await fetch(`${WEB_ORIGIN}/login`, { signal: AbortSignal.timeout(30_000) })).text();
  const seen = new Set(html.match(/https?:\/\/127\.0\.0\.1:\d+/g) ?? []);
  if (seen.size === 0) throw new Error("no absolute API origin in the served HTML; cannot prove which API the build inlines");
  if (!seen.has(API_ORIGIN)) throw new Error(`the page names ${[...seen].join(", ")}, this run is ${API_ORIGIN}`);
  return [...seen].join(", ");
});

// ---- 4. the running app resolved the same origin -----------------------------
const appSettings = join(runDir, "userdata", "app-settings.json");
if (!existsSync(appSettings)) {
  noteBlocker("the Electron app persisted the D server origin", `no ${appSettings} yet (start.sh may have skipped the app)`);
} else {
  await check("the Electron app persisted the D server origin", async () => {
    const settings = JSON.parse(readFileSync(appSettings, "utf8"));
    if (settings.uniworkApiOrigin !== API_ORIGIN) {
      throw new Error(`uniworkApiOrigin=${JSON.stringify(settings.uniworkApiOrigin)} but this run is ${API_ORIGIN}`);
    }
    return `uniworkApiOrigin=${settings.uniworkApiOrigin}`;
  });
}

// ---- 5. the manifest: D SHA, fork SHA, pin bundle -----------------------------
function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

const dSha = git(["rev-parse", "HEAD"], REPO_ROOT);
const forkDir = join(process.env.OFFICE_FORK_CACHE || join(process.env.HOME ?? "/root", ".cache", "uniwork-office-harness"), `uniwork-office-${ports.OFFICE_FORK_SHA}`);
const pinPath = join(REPO_ROOT, "apps/web/platform/office-frame/docs.pin.json");
const pin = existsSync(pinPath) ? JSON.parse(readFileSync(pinPath, "utf8")) : null;

if (!pin) noteBlocker("the docs frame pin is readable", `no ${pinPath}`);
if (!existsSync(join(forkDir, ".git"))) {
  noteBlocker("the fork is checked out at the pinned SHA", `no fork checkout at ${forkDir}`);
} else {
  await check("the fork is checked out at the pinned SHA", async () => {
    const head = git(["rev-parse", "HEAD"], forkDir);
    if (!head.startsWith(ports.OFFICE_FORK_SHA)) throw new Error(`fork HEAD ${head} is not ${ports.OFFICE_FORK_SHA}`);
    return `fork ${head}`;
  });
}

const manifest = {
  schemaVersion: 1,
  kind: "uniwork-office-g5g6g7-runtime-manifest",
  requirementId: "G7-A05",
  dSha,
  fSha: ports.OFFICE_FORK_SHA,
  pin: pin ? { module: "docs", version: pin.version, gitSha: pin.gitSha, manifestSha256: pin.manifestSha256 } : null,
  apiOrigin: API_ORIGIN,
  webOrigin: WEB_ORIGIN,
  display: ports.DISPLAY ?? "",
  platform: `${process.platform}-${process.arch}`,
  node: process.versions.node,
};

const failed = checks.filter((c) => c.result === "FAIL");
const result = failed.length > 0 ? "FAIL" : blockers.length > 0 ? "BLOCKED" : "PASS";

const artifactPath = join(runDir, "sample-ac.json");
mkdirSync(runDir, { recursive: true });
appendFileSync(artifactPath, `${JSON.stringify({ ...manifest, checks, blockers }, null, 2)}\n`);

const line = evidenceLine({
  evidenceId: `g7-01-harness-${Date.now()}`,
  requirementId: "G7-A05",
  dSha,
  fSha: ports.OFFICE_FORK_SHA,
  pin: pin?.version ?? "",
  platform: `${process.platform}-${process.arch}`,
  build: `node ${process.versions.node}`,
  command: `node scripts/office/g5g6g7/harness/sample-ac.mjs --run-dir ${runDir}`,
  exitCode: result === "PASS" ? 0 : result === "BLOCKED" ? BLOCKED : 1,
  result,
  artifact: artifactPath,
  checker: "harness:start.sh+sample-ac.mjs",
  blocker: blockers.join("; "),
  startedAt,
  finishedAt: new Date().toISOString(),
});
appendFileSync(join(runDir, "evidence.jsonl"), `${JSON.stringify(line)}\n`);

for (const c of checks) console.log(`  ${c.result.padEnd(7)} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
console.log(`sample AC: ${result}`);
if (result === "BLOCKED") for (const b of blockers) console.error(`  blocked: ${b}`);
console.log(`evidence line: ${join(runDir, "evidence.jsonl")}`);

process.exit(result === "PASS" ? 0 : result === "BLOCKED" ? BLOCKED : 1);
