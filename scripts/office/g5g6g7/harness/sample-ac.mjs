/* global process, console, fetch, AbortSignal */
// One sample acceptance case for G7-01 (UNI-1376, item C): prove the three
// pieces of the Office stack run together on one machine, on this run's ports,
// and record it in the evidence runner's JSON line shape.
//
// The case is G7-A05's runtime-manifest half, kept to what a dev build can
// actually show on a runner VM:
//
//   1. the D server answers /healthz and /readyz on this run's API port,
//   2. GET /api/v1/config names this run's API origin as office_api_origin
//      (the origin the web hands to the desktop app),
//   3. the D web answers on this run's web port and calls that same API origin —
//      the rule e2e/api-url.ts pins: a headless Chromium opens /login and the
//      first /api/v1/ request is read off the page (falling back to reading the
//      origin inlined in the served build). NEXT_PUBLIC_API_URL is baked in at
//      build time, so a mismatch means the run is testing a stale build — a warm
//      VM's old :8080 server,
//   4. the running Electron app resolved that origin: it persists
//      UNIWORK_API_ORIGIN into userData/app-settings.json
//      (fork apps/shell/src/main/office-bridge-host.ts:84, called at
//      apps/shell/src/main/index.ts:5248),
//   5. the runtime manifest (D SHA, fork SHA, pin bundle) reproduces.
//
// A precondition that is absent (no stack on this run's ports, no fork checkout,
// no app settings file) is BLOCKED with the reason, never PASS — a partial run
// cannot be mistaken for a passing one. A stack that answers but says the wrong
// thing (another origin, a stale build) is a FAIL: the harness ran, the claim
// did not hold. Exit codes: 0 PASS, 1 FAIL, 77 BLOCKED.
//
// Preferred invocation (records one line in the runner's ledger, with the
// fixture hash guard and the lane's out dir):
//
//   OFFICE_FORK_SHA=0d03b18 node scripts/office/g5g6g7/evidence.mjs run \
//     --req G7-A05 --fixture fx-md-notes-vi --checker tester-cloud -- \
//     node scripts/office/g5g6g7/harness/sample-ac.mjs
//
// Run directly, it writes the same JSON line into the run dir instead.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { concludeAtStartGate, evidenceLine, harnessEvidenceId, harnessPaths, ledgerIdentity, loopbackOriginsIn, readStartStatus, startGate } from "./lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..", "..");
const BLOCKED = 77;
/** The fixture G7-A05 declares in the acceptance rows: the line a start gate writes names it. */
const FIXTURE_ID = "fx-md-notes-vi";

function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const runDir = argValue("--run-dir", process.env.HARNESS_RUN_DIR || join(REPO_ROOT, ".harness-run"));
// The same layout start.sh and lib.mjs write, so a path here can never drift
// from the path a run actually produced.
const paths = harnessPaths(runDir);
const portsFile = paths.envFile;
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

// start.sh's own outcome decides first: a start that failed is a FAIL here too,
// not "no server, so BLOCKED" (cloud round 4).
const gate = startGate(readStartStatus(runDir));
if (gate.gate !== "proceed") {
  process.exit(await concludeAtStartGate(gate, {
    runDir,
    requirementId: "G7-A05",
    fixtureId: FIXTURE_ID,
    command: `node scripts/office/g5g6g7/harness/sample-ac.mjs --run-dir ${runDir}`,
    checker: "harness:start.sh+sample-ac.mjs",
    startedAt,
    argv: [...process.argv],
  }));
}
const checks = [];
const blockers = [];

/** A precondition that is absent inside a check: BLOCKED, not FAIL and not PASS. */
class BlockedError extends Error {}

/** Records one check; a thrown error is a FAIL, a BlockedError is BLOCKED, never a pass. */
async function check(name, run) {
  try {
    const detail = await run();
    checks.push({ name, result: "PASS", detail: detail ?? "" });
    return true;
  } catch (error) {
    if (error instanceof BlockedError) {
      noteBlocker(name, error.message);
      return false;
    }
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

// ---- preconditions: is there a stack to check at all? ------------------------
// Absent pieces are BLOCKED. They are separated from the assertions below so a
// stack that is simply not up never reads as "the claim was false".
async function reachable(url, timeoutMs = 5000) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: "manual" });
    return res.status;
  } catch {
    return 0;
  }
}

const appSettingsPath = paths.appSettings;
const preconditions = [];
const healthStatus = await reachable(`${API_ORIGIN}/healthz`);
if (healthStatus === 0) preconditions.push(`no D server on ${API_ORIGIN} (start.sh must be run first, and it must have stayed up)`);
const webStatus = await reachable(`${WEB_ORIGIN}/login`, 30_000);
if (webStatus === 0) preconditions.push(`no D web on ${WEB_ORIGIN} (start.sh must be run first, and it must have stayed up)`);
if (!existsSync(appSettingsPath)) preconditions.push(`the app has not written ${appSettingsPath}; the fork app was not started or has not reached ready`);
if (preconditions.length > 0) {
  for (const reason of preconditions) console.error(`BLOCKED: ${reason}`);
  const record = evidenceLine({
    evidenceId: harnessEvidenceId("G7-A05"),
    ...(await ledgerIdentity()),
    fSha: process.env.OFFICE_FORK_SHA || ports.OFFICE_FORK_SHA || "",
    requirementId: "G7-A05",
    platform: `${process.platform}-${process.arch}`,
    build: `node ${process.versions.node}`,
    command: `node scripts/office/g5g6g7/harness/sample-ac.mjs --run-dir ${runDir}`,
    // the exact command that ran, not an empty vector: verify reports [] as an
    // empty required field (reviewer_be r2 N1)
    argv: [...process.argv],
    exitCode: BLOCKED,
    result: "BLOCKED",
    checker: "harness:start.sh+sample-ac.mjs",
    blocker: preconditions.join("; "),
    startedAt,
    finishedAt: new Date().toISOString(),
  });
  mkdirSync(paths.userDataDir, { recursive: true });
  appendFileSync(paths.blockedFile, `${JSON.stringify(record, null, 2)}\n`);
  if (!process.env.OFFICE_EVIDENCE_ID) appendFileSync(paths.evidenceFile, `${JSON.stringify(record)}\n`);
  process.exit(BLOCKED);
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

// ---- 3. the web serves, and the build it serves inlines this run's API -------
let loginHtml = "";
await check("D web answers on this run's web port", async () => {
  const res = await fetch(`${WEB_ORIGIN}/login`, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`GET ${WEB_ORIGIN}/login -> ${res.status}`);
  loginHtml = await res.text();
  if (!loginHtml.includes("<")) throw new Error("the web answered with an empty body");
  return `${res.status}, ${loginHtml.length} bytes`;
});

/**
 * The API origin the web actually calls. Two ways to see it, best first:
 *
 *  1. a headless Chromium opens /login and the first /api/v1/ request is read
 *     off the page — exactly what e2e/api-url.ts asserts for the spec suite, and
 *     the only way to see the origin the app really uses at runtime;
 *  2. the served client chunks are fetched and searched for a loopback origin
 *     (as the build spells it, `localhost` like API_ORIGIN), when Playwright is
 *     not installed on this VM.
 *
 * Three outcomes, each recorded as itself: this run's origin (PASS), a different
 * origin (FAIL — a stale build), or nothing that can be read (BLOCKED — a check
 * that proves nothing is not a pass).
 */
async function apiOriginFromBrowser() {
  const require = createRequire(join(REPO_ROOT, "e2e", "package.json"));
  let chromium;
  try {
    ({ chromium } = require("@playwright/test"));
  } catch {
    return { origin: null, how: "playwright is not installed in this checkout" };
  }
  // A browser that will not launch (no Chromium binary on the VM) is a missing
  // precondition, not a failed claim: fall through to the chunk scan.
  let browser;
  try {
    browser = await chromium.launch();
  } catch (error) {
    return { origin: null, how: `headless Chromium did not launch (${error.message.split("\n")[0]})` };
  }
  try {
    const page = await browser.newPage();
    const request = page.waitForRequest((r) => new URL(r.url()).pathname.startsWith("/api/v1/"), { timeout: 30_000 });
    await page.goto(`${WEB_ORIGIN}/login`);
    const seen = await request.catch(() => null);
    if (!seen) return { origin: null, how: `the web at ${WEB_ORIGIN} made no /api/v1/ request within 30 s` };
    return { origin: new URL(seen.url()).origin, how: `first /api/v1/ request from the page (${new URL(seen.url()).pathname})` };
  } finally {
    await browser.close();
  }
}

async function apiOriginFromChunks(html) {
  const srcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]).slice(0, 40);
  const found = new Set();
  let fetched = 0;
  for (const src of srcs) {
    const url = new URL(src, WEB_ORIGIN).toString();
    if (new URL(url).origin !== new URL(WEB_ORIGIN).origin) continue;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) continue;
      fetched += 1;
      const body = await res.text();
      for (const origin of loopbackOriginsIn(body)) found.add(origin);
    } catch {
      // a chunk that does not load is not evidence either way
    }
  }
  return { found: [...found], fetched };
}

await check("the web calls this run's API origin", async () => {
  if (!loginHtml) throw new Error("the web did not answer, so the build cannot be checked");
  const observed = await apiOriginFromBrowser();
  if (observed.origin === API_ORIGIN) return `${API_ORIGIN} — ${observed.how}`;
  if (observed.origin) {
    throw new Error(`the page calls ${observed.origin}, not ${API_ORIGIN}: this is a stale build from an earlier run`);
  }
  // No browser: fall back to reading the build's inlined value out of its chunks.
  const { found, fetched } = await apiOriginFromChunks(loginHtml);
  if (found.includes(API_ORIGIN)) return `${API_ORIGIN} (inlined in the served build)`;
  if (found.length > 0) throw new Error(`the served build inlines ${found.join(", ")}, not ${API_ORIGIN}: this is a stale build from an earlier run`);
  throw new BlockedError(`${observed.how}; read ${fetched} chunk(s) and found no loopback API origin either`);
});

// ---- 4. the running app resolved the same origin -----------------------------
await check("the Electron app persisted the D server origin", async () => {
  const settings = JSON.parse(readFileSync(appSettingsPath, "utf8"));
  if (settings.uniworkApiOrigin !== API_ORIGIN) {
    throw new Error(`uniworkApiOrigin=${JSON.stringify(settings.uniworkApiOrigin)} but this run is ${API_ORIGIN}`);
  }
  return `uniworkApiOrigin=${settings.uniworkApiOrigin}`;
});

// ---- 5. the runtime manifest: D SHA, fork SHA, pin bundle ---------------------
function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

const dSha = git(["rev-parse", "HEAD"], REPO_ROOT);
const forkSha = process.env.OFFICE_FORK_SHA || ports.OFFICE_FORK_SHA;
const forkCache = process.env.OFFICE_FORK_CACHE || join(process.env.HOME ?? "/root", ".cache", "uniwork-office-harness");
const forkDir = join(forkCache, `uniwork-office-${forkSha}`);
const pinPath = join(REPO_ROOT, "apps/web/platform/office-frame/docs.pin.json");
const pin = existsSync(pinPath) ? JSON.parse(readFileSync(pinPath, "utf8")) : null;

if (!pin) noteBlocker("the docs frame pin is readable", `no ${pinPath}`);
if (!existsSync(join(forkDir, ".git"))) {
  noteBlocker("the fork is checked out at the pinned SHA", `no fork checkout at ${forkDir}`);
} else {
  await check("the fork is checked out at the pinned SHA", async () => {
    const head = git(["rev-parse", "HEAD"], forkDir);
    if (!head.startsWith(forkSha)) throw new Error(`fork HEAD ${head} is not ${forkSha}`);
    return `fork ${head}`;
  });
}

const manifest = {
  schemaVersion: 1,
  kind: "uniwork-office-g5g6g7-runtime-manifest",
  requirementId: "G7-A05",
  dSha,
  fSha: forkSha,
  pin: pin ? { module: "docs", version: pin.version, gitSha: pin.gitSha, manifestSha256: pin.manifestSha256 } : null,
  apiOrigin: API_ORIGIN,
  webOrigin: WEB_ORIGIN,
  display: ports.DISPLAY ?? "",
  platform: `${process.platform}-${process.arch}`,
  node: process.versions.node,
  checks,
  blockers,
};

const failed = checks.filter((c) => c.result === "FAIL");
const result = failed.length > 0 ? "FAIL" : blockers.length > 0 ? "BLOCKED" : "PASS";
const exitCode = result === "PASS" ? 0 : result === "BLOCKED" ? BLOCKED : 1;

mkdirSync(runDir, { recursive: true });
const manifestPath = join(runDir, "sample-ac.json");
appendFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

// Under the evidence runner (OFFICE_EVIDENCE_ID is set) the runner owns the
// ledger line, so writing another one here would double-count the check.
const command = `node scripts/office/g5g6g7/harness/sample-ac.mjs --run-dir ${runDir}`;
if (!process.env.OFFICE_EVIDENCE_ID) {
  const line = evidenceLine({
    evidenceId: `g7-01-harness-${Date.now()}`,
    requirementId: "G7-A05",
    dSha,
    fSha: forkSha,
    pin: pin?.version ?? "",
    platform: manifest.platform,
    build: `node ${process.versions.node}`,
    command,
    argv: [...process.argv],
    exitCode,
    result,
    artifact: manifestPath,
    checker: "harness:start.sh+sample-ac.mjs",
    blocker: blockers.join("; "),
    startedAt,
    finishedAt: new Date().toISOString(),
  });
  appendFileSync(paths.evidenceFile, `${JSON.stringify(line)}\n`);
}

for (const c of checks) console.log(`  ${c.result.padEnd(7)} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
console.log(`sample AC: ${result}`);
if (result === "BLOCKED") for (const b of blockers) console.error(`  blocked: ${b}`);
console.log(`runtime manifest: ${manifestPath}`);
process.exit(exitCode);
