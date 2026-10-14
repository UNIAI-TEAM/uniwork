/* global process, console, fetch, AbortSignal, Blob, FormData */
// The document step of the G7-01 app harness (UNI-1376, item C, priority 2):
// prove the running fork app OPENS a fixture document handed to it by the D
// server's launch link, and record it as its own evidence line.
//
// The link the two ends agree on is the fork's launch deep link
// `uniwork-office[-dev]://open?ticket=<ticket>` (fork
// apps/shell/src/main/uniwork-auth/callback.ts: isOfficeLaunchUrl, routing.ts
// startLaunch, bound at index.ts:6443). The older `uniwork://office/open?token=`
// parser is a fallback and is not used here. The dev build registers
// `uniwork-office-dev` (deployment.ts: callbackSchemeForChannel), so the D
// server is asked for the dev client's link and the deep link is addressed to
// the dev scheme.
//
// What it does, in order:
//   1. seed a user, an organization and a workspace through the H1 API,
//   2. upload one fixture document as a file document (the launch service
//      refuses page and folder documents),
//   3. mint a launch session for that document with the dev client id and the
//      deployment the app claims (POST /documents/{id}/office/sessions),
//   4. hand the deep link to the running app as a second instance with the URL
//      in argv — the way the fork's own suite delivers a link
//      (e2e/helpers.ts handoffUrlToRunningApp),
//   5. read the app's OWN record that it opened the document: the working copy
//      and binding.json under `<userData>/uniwork-documents/<deployment>/...`
//      (fork binding-store.ts) — never a screenshot.
//
// Outcomes come from documentStepOutcome (lib.mjs): a ticket but no working
// copy with no desktop session is BLOCKED (the same "no OS keyring" precondition
// the fork's own suite skips on); with a session it is a FAIL; the working copy
// naming the fixture document is a PASS. Exit codes: 0 PASS, 1 FAIL, 77 BLOCKED.
//
// Desktop mode (G7-A01 on a signed-in desktop, where the cloud VM is BLOCKED for
// want of an OS keyring): HARNESS_DOC_EMAIL + HARNESS_DOC_PASSWORD reuse an
// existing account instead of seeding one, and `--wait-signin [seconds]` prints
// the sign-in steps and waits for the server to list a live desktop session of
// the account (GET /api/v1/auth/desktop/devices) before the ticket is minted.
// No desktop session for the account is BLOCKED with that reason. The password
// of a reused account never leaves the environment; no token, ticket or password
// is printed or written into the report or the ledger (see the README).
//
// Preferred invocation (the runner owns the ledger line):
//
//   OFFICE_FORK_SHA=0d03b18 node scripts/office/g5g6g7/evidence.mjs run \
//     --req G7-A01 --fixture fx-docx-report-vi --checker tester-cloud -- \
//     node scripts/office/g5g6g7/harness/document-step.mjs --run-dir <runDir>
import { existsSync, mkdirSync, readFileSync, readdirSync, appendFileSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { API_CALLS, ApiError, apiPath, assertBodyKeys, failureInfo } from "./api-contract.mjs";
import { DEV_CLIENT_ID, activeDesktopDevice, concludeAtStartGate, describeExit, documentStepOutcome, fixtureSha256Of, handoffEnv, evidenceLine, harnessPaths, harnessEvidenceId, ledgerIdentity, officeDeepLink, parseWaitSignin, readStartStatus, startGate, ticketFromLaunchUrl, workingCopyDir, writeStepArtifact } from "./lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..", "..");
const BLOCKED = 77;
const FIXTURE_MANIFEST = join(REPO_ROOT, "docs", "office", "g5g6g7", "fixtures", "manifest.json");
/** The row the document open serves (G7-A01, the end-to-end loop) and a fixture it names. */
const DEFAULT_REQUIREMENT = "G7-A01";
const DEFAULT_FIXTURE = "fx-docx-report-vi";
/** How long to wait for the app to leave a working copy (HARNESS_DOC_WAIT_MS overrides). */
const WORKING_COPY_TIMEOUT_MS = Number(process.env.HARNESS_DOC_WAIT_MS ?? 60_000);
/** How long the deep-link handoff (the second instance) may run before it is killed. */
const HANDOFF_TIMEOUT_MS = Number(process.env.HARNESS_HANDOFF_TIMEOUT_MS ?? 30_000);

function argValue(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const runDir = argValue("--run-dir", process.env.HARNESS_RUN_DIR || join(REPO_ROOT, ".harness-run"));
const requirementId = argValue("--req", DEFAULT_REQUIREMENT);
const fixtureId = argValue("--fixture", DEFAULT_FIXTURE);
const paths = harnessPaths(runDir);
const reuseEmail = (process.env.HARNESS_DOC_EMAIL ?? "").trim();
const reusePassword = process.env.HARNESS_DOC_PASSWORD ?? "";
if (Boolean(reuseEmail) !== Boolean(reusePassword)) {
  console.error("document-step: HARNESS_DOC_EMAIL and HARNESS_DOC_PASSWORD go together (set both to reuse an account, neither to seed one)");
  process.exit(2);
}
const startedAt = new Date().toISOString();

/** A precondition that is absent is BLOCKED, never a PASS and never a FAIL. */
class BlockedError extends Error {}

const checks = [];
const blockers = [];
function noteBlocker(name, reason) {
  checks.push({ name, result: "BLOCKED", detail: reason });
  blockers.push(`${name}: ${reason}`);
}

function readPorts() {
  if (!existsSync(paths.envFile)) {
    console.error(`BLOCKED: no run at ${runDir} (missing ports.env); run start.sh first`);
    process.exit(BLOCKED);
  }
  return Object.fromEntries(
    readFileSync(paths.envFile, "utf8")
      .split("\n")
      .filter((line) => line.trim() && !line.startsWith("#"))
      .map((line) => {
        const at = line.indexOf("=");
        return [line.slice(0, at), line.slice(at + 1)];
      }),
  );
}

/**
 * One call of the D server API, named in api-contract.mjs (the table the node
 * test pins against the server's routes). A non-2xx answer throws an ApiError
 * naming the method, path and status; the origin and the token are not in it.
 */
async function apiCall(name, { params, token, body, form } = {}) {
  const call = API_CALLS[name];
  const path = apiPath(name, params);
  if (body !== undefined) assertBodyKeys(name, body);
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${API_ORIGIN}${path}`, {
    method: call.method,
    headers,
    body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok) throw new ApiError({ method: call.method, path, status: res.status, bodyText: text });
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

/** The fixture's path and hash from the manifest, or a BlockedError naming why. */
function fixtureFromManifest(id) {
  if (!existsSync(FIXTURE_MANIFEST)) throw new BlockedError(`no fixture manifest at ${FIXTURE_MANIFEST}`);
  const manifest = JSON.parse(readFileSync(FIXTURE_MANIFEST, "utf8"));
  const fixture = (manifest.fixtures ?? []).find((candidate) => candidate.id === id);
  if (!fixture) throw new BlockedError(`fixture ${id} is not in ${FIXTURE_MANIFEST}`);
  const path = resolve(REPO_ROOT, fixture.path);
  if (!existsSync(path)) throw new BlockedError(`fixture ${id} is missing at ${fixture.path}`);
  return { ...fixture, absPath: path };
}

/**
 * The app's own record that it opened `documentId`: any working-copy folder
 * under `<userData>/uniwork-documents/<deployment>/<account>/<key>/` whose
 * binding.json names the document. The folder key is the document id for a
 * live ticket, or `<id>@v<version>` for a version ticket (service.ts openFromServer).
 */
function bindingDocumentId(dir) {
  const binding = join(dir, "binding.json");
  if (!existsSync(binding)) return null;
  try {
    const parsed = JSON.parse(readFileSync(binding, "utf8"));
    return typeof parsed?.documentId === "string" ? parsed.documentId : null;
  } catch {
    // a torn binding is not evidence the document opened
    return null;
  }
}

function findWorkingCopyDocumentId(userDataDir, deploymentId, documentId) {
  const root = join(userDataDir, "uniwork-documents", deploymentId);
  if (!existsSync(root)) return null;
  for (const account of readdirSync(root, { withFileTypes: true })) {
    if (!account.isDirectory()) continue;
    // the live-ticket folder is named by the document id (service.ts openFromServer)
    const direct = bindingDocumentId(workingCopyDir(userDataDir, deploymentId, account.name, documentId));
    if (direct !== null) return direct;
    // a version ticket gets its own `<id>@v<version>` folder; any of them is the
    // same document opened
    const accountDir = join(root, account.name);
    for (const key of readdirSync(accountDir, { withFileTypes: true })) {
      if (!key.isDirectory() || !key.name.startsWith(`${documentId}@`)) continue;
      const seen = bindingDocumentId(join(accountDir, key.name));
      if (seen !== null) return seen;
    }
  }
  return null;
}

/**
 * Hands the deep link to the running app as a second instance (URL in argv).
 * The instance gets an allow-listed environment (lib.mjs: appEnv), never the
 * harness's own, and its own process group, which is recorded in the run's pids
 * file for as long as it lives: if it outlives the step (it became the primary
 * because the first app died, or it forked children), stop.sh still finds it.
 * It is waited on with a timeout; a timed-out instance is killed as a group.
 */
function deliverDeepLink(ports, url) {
  const env = handoffEnv(ports);
  return new Promise((resolveDelivery) => {
    let settled = false;
    let pidLine = "";
    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (pidLine && existsSync(paths.pidFile)) {
        const kept = readFileSync(paths.pidFile, "utf8").split("\n").filter((line) => line && line !== pidLine);
        writeFileSync(paths.pidFile, kept.length > 0 ? `${kept.join("\n")}\n` : "");
      }
      resolveDelivery(outcome);
    };
    const child = spawn(ports.ELECTRON_BIN, ["--no-sandbox", "--disable-gpu", ports.SHELL_APP_DIR, url], {
      env,
      detached: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 4_096) stderr += chunk;
    });
    if (child.pid && existsSync(paths.pidFile)) {
      pidLine = `handoff ${child.pid} 0`;
      appendFileSync(paths.pidFile, `${pidLine}\n`);
    }
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // already gone
      }
      finish({ status: null, error: new Error(`the second instance did not exit within ${HANDOFF_TIMEOUT_MS / 1000}s and was killed`) });
    }, HANDOFF_TIMEOUT_MS);
    child.on("error", (error) => finish({ status: null, error }));
    child.on("close", (status, signal) => finish({ status, signal, stderr }));
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const ports = readPorts();
const API_ORIGIN = ports.API_ORIGIN;

// start.sh's own outcome decides first: a start that failed is a FAIL here too,
// not "no server, so BLOCKED" (cloud round 4).
const startedGate = startGate(readStartStatus(runDir));
if (startedGate.gate !== "proceed") {
  process.exit(await concludeAtStartGate(startedGate, {
    runDir,
    requirementId,
    command: `node scripts/office/g5g6g7/harness/document-step.mjs --run-dir ${runDir} --req ${requirementId} --fixture ${fixtureId}`,
    checker: "harness:start.sh+document-step.mjs",
    fixtureId,
    startedAt,
    argv: [...process.argv],
  }));
}

// ---- preconditions: is there a run whose app can receive a link? -------------
const preconditions = [];
if (!ports.UNIWORK_USER_DATA || !ports.ELECTRON_BIN || !ports.SHELL_APP_DIR) {
  preconditions.push("this run did not start the fork app (no UNIWORK_USER_DATA/ELECTRON_BIN/SHELL_APP_DIR in ports.env); run start.sh without --skip-app");
}
if (API_ORIGIN) {
  try {
    const res = await fetch(`${API_ORIGIN}/healthz`, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) preconditions.push(`the D server answered ${res.status} on ${API_ORIGIN}/healthz`);
  } catch {
    preconditions.push(`no D server on ${API_ORIGIN} (start.sh must be run first, and it must have stayed up)`);
  }
}
let fixture = null;
try {
  fixture = fixtureFromManifest(fixtureId);
} catch (error) {
  if (error instanceof BlockedError) preconditions.push(error.message);
  else throw error;
}
if (preconditions.length > 0) {
  for (const reason of preconditions) console.error(`BLOCKED: ${reason}`);
  const stepCommand = `node scripts/office/g5g6g7/harness/document-step.mjs --run-dir ${runDir} --req ${requirementId} --fixture ${fixtureId}`;
  const record = evidenceLine({
    evidenceId: harnessEvidenceId(requirementId),
    ...(await ledgerIdentity()),
    fSha: process.env.OFFICE_FORK_SHA || ports.OFFICE_FORK_SHA || "",
    requirementId,
    fixtureId,
    fixtureSha256: fixture?.sha256 ?? (await fixtureSha256Of(fixtureId)),
    platform: `${process.platform}-${process.arch}`,
    build: `node ${process.versions.node}`,
    command: stepCommand,
    argv: [...process.argv],
    exitCode: BLOCKED,
    result: "BLOCKED",
    artifact: writeStepArtifact(runDir, requirementId, stepCommand, preconditions.map((reason) => `BLOCKED: ${reason}`)),
    checker: "harness:start.sh+document-step.mjs",
    blocker: preconditions.join("; "),
    startedAt,
    finishedAt: new Date().toISOString(),
  });
  mkdirSync(paths.userDataDir, { recursive: true });
  appendFileSync(paths.blockedFile, `${JSON.stringify(record, null, 2)}\n`);
  if (!process.env.OFFICE_EVIDENCE_ID) appendFileSync(paths.evidenceFile, `${JSON.stringify(record)}\n`);
  process.exit(BLOCKED);
}

// ---- 1. the account: seed a user, or reuse an existing one -------------------
// Cloud (default): seed a fresh throwaway user per run. Desktop: a person has an
// app signed in as THEIR account, which cannot open a document of a stranger, so
// HARNESS_DOC_EMAIL / HARNESS_DOC_PASSWORD reuse that account (login, no
// seeding) and `--wait-signin [seconds]` waits for the app's desktop session of
// the account. The password of a reused account is read from the environment
// only: it is never printed, recorded, or put in an artifact.
const deploymentId = ports.HARNESS_DEPLOYMENT_ID || "default";
const reused = Boolean(reuseEmail);
const waitSeconds = parseWaitSignin(process.argv);
// Desktop mode is either of the two inputs; the cloud run has neither and keeps
// its behaviour (BLOCKED without a keyring, no sign-in check).
const desktopMode = reused || waitSeconds !== null;

let documentId = null;
let launchUrl = null;
let ticket = null;
let mintError = null;
let email = reuseEmail;
let password = reusePassword;
let token = "";
/** null = not checked (cloud), true = the server lists a live desktop session for the account, false = it does not. */
let desktopSession = null;
/** What this run created and may therefore remove, by id (never a pattern over the VM's data). */
const seeded = { org: null, userId: null };

async function login() {
  const session = await apiCall("login", { body: { email, password } });
  token = session.access_token;
  return session;
}

try {
  let session;
  if (reused) {
    session = await login();
  } else {
    email = `g7-01-harness-${Date.now()}@example.com`;
    // A waited sign-in is done by a person, so the seeded account gets its own
    // random password, kept in a 0600 file in the run dir and never printed;
    // the unattended cloud run keeps its fixed throwaway one.
    password = waitSeconds !== null ? randomBytes(15).toString("base64url") : "password123";
    session = await apiCall("register", {
      body: { email, password, display_name: "G7-01 harness" },
    });
    token = session.access_token;
    seeded.userId = typeof session.user?.id === "string" ? session.user.id : null;
    await apiCall("verifyEmail", { token, body: { code: "123456" } });
    if (waitSeconds !== null) {
      mkdirSync(runDir, { recursive: true });
      writeFileSync(paths.docUser, `${JSON.stringify({ email, password })}\n`, { mode: 0o600 });
    }
  }
  const slug = `g7-01-${Date.now().toString(36)}`;
  const org = await apiCall("createOrganization", {
    token,
    body: { name: "G7-01 harness", slug: `o-${slug}` },
  });
  seeded.org = { id: org.organization.id, slug: org.organization.slug };
  const workspace = await apiCall("createWorkspace", {
    // {org} of this route is the organization ID (the slug answers 403: not a member of an org called that)
    params: { org: org.organization.id },
    token,
    body: { name: "G7-01 harness", slug: `w-${slug}` },
  });
  const form = new FormData();
  form.append("file", new Blob([readFileSync(fixture.absPath)], { type: fixture.mime ?? "application/octet-stream" }), fixture.path.split("/").pop());
  form.append("title", fixture.path.split("/").pop());
  const created = await apiCall("createFileDocument", { params: { workspaceID: workspace.workspace.id }, token, form });
  documentId = created.document.id;
  checks.push({ name: "the D server created a file document from the fixture", result: "PASS", detail: documentId });
} catch (error) {
  mintError = error.message;
  checks.push({ name: "the D server created the account and the fixture document", result: "FAIL", detail: mintError, failure: failureInfo(error) });
}

// ---- 2. desktop mode: is the app signed in as this account? ------------------
// The server lists an account's native device sessions
// (GET /api/v1/auth/desktop/devices); a live one for the dev client and this
// deployment is the server's own record of the app's sign-in.
/**
 * The sign-in instructions go to stdout and, best effort, to the controlling
 * terminal: under the evidence runner stdout is captured into the artifact and
 * would only be read after the wait it explains.
 */
function tell(line) {
  console.log(line);
  try {
    appendFileSync("/dev/tty", `${line}\n`);
  } catch {
    // no controlling terminal (CI, cloud): stdout is all there is
  }
}

async function desktopSessionLive() {
  try {
    const list = await apiCall("desktopDevices", { token });
    return activeDesktopDevice(list?.devices, { clientId: DEV_CLIENT_ID, deploymentId }) !== null;
  } catch (error) {
    // an expired access token is the one expected failure over a long wait
    if (/-> 401/.test(error.message) && password) {
      try {
        await login();
      } catch {
        // the next poll reports it
      }
    }
    return false;
  }
}

if (!mintError && desktopMode) {
  if (waitSeconds !== null) {
    tell(`document step: waiting up to ${waitSeconds}s for a desktop sign-in as ${email}`);
    tell(`  1. in the app window${ports.DISPLAY ? ` (display ${ports.DISPLAY})` : ""} choose Sign in; the browser opens the consent page of ${ports.WEB_ORIGIN}`);
    tell(`  2. sign in there as ${email}${reused ? " (your own password)" : ` (the throwaway account's password is in ${paths.docUser}, mode 0600)`} and approve the desktop consent`);
    tell("  3. leave the app running; this step carries on by itself once the sign-in shows");
    const deadline = Date.now() + waitSeconds * 1_000;
    desktopSession = await desktopSessionLive();
    while (!desktopSession && Date.now() < deadline) {
      await sleep(2_000);
      desktopSession = await desktopSessionLive();
    }
  } else {
    desktopSession = await desktopSessionLive();
  }
  if (desktopSession) {
    checks.push({ name: "the server lists a live desktop session for the account", result: "PASS", detail: `${DEV_CLIENT_ID} on deployment ${deploymentId}` });
  } else {
    noteBlocker(
      "the app is signed in as the account",
      `no live ${DEV_CLIENT_ID} desktop session for ${email} on deployment ${deploymentId}${waitSeconds !== null ? ` within ${waitSeconds}s` : " (pass --wait-signin to wait for a sign-in)"}`,
    );
  }
}

// ---- 3. mint the launch session ----------------------------------------------
// After any wait, so the ticket is fresh when it is delivered.
if (!mintError && !(desktopMode && !desktopSession)) {
  try {
    const launch = await apiCall("mintLaunch", {
      params: { documentID: documentId },
      token,
      body: { operation: "edit", deployment_id: deploymentId, client_id: DEV_CLIENT_ID, return_hint: "office" },
    });
    launchUrl = launch.launch_url;
    // The link the server returns is the one the app must receive: the dev
    // scheme, host `open`, query `ticket`. Read the ticket out of it rather than
    // assuming the shape, and check the server built exactly that link.
    ticket = ticketFromLaunchUrl(launchUrl);
    if (!launchUrl || !ticket) {
      throw new Error(`the server returned no dev launch link (launch_url=${JSON.stringify(launchUrl)})`);
    }
    if (launchUrl !== officeDeepLink(DEV_CLIENT_ID, ticket) || ticket !== launch.launch_ticket) {
      throw new Error(`the server's launch link is not the dev deep link for its own ticket (${launchUrl.replace(/ticket=[^&]+/, "ticket=<redacted>")})`);
    }
    checks.push({ name: "the D server minted a dev-channel launch link", result: "PASS", detail: launchUrl.replace(/ticket=[^&]+/, "ticket=<redacted>") });
  } catch (error) {
    mintError = error.message;
    checks.push({ name: "the D server minted a launch session for the fixture document", result: "FAIL", detail: mintError, failure: failureInfo(error) });
  }
}

// ---- 4-5. deliver the link, read the app's working copy ----------------------
let signedIn = false;
let workingCopyDocumentId = null;
if (!mintError && ticket && launchUrl) {
  // The app keeps the desktop session encrypted in userData; no file means no
  // session (a Linux VM without a Secret Service selects safeStorage's
  // `basic_text` backend, which the app refuses by contract — credentials.ts).
  signedIn = existsSync(join(ports.UNIWORK_USER_DATA, "uniwork-auth", "session.bin"));
  const delivered = await deliverDeepLink(ports, launchUrl);
  if (delivered.error || delivered.status !== 0) {
    checks.push({
      name: "the app received the deep link as a second instance",
      result: "FAIL",
      detail: delivered.error ? delivered.error.message : `the second instance ${describeExit(delivered.status, delivered.signal)}: ${(delivered.stderr ?? "").slice(0, 200)}`,
    });
  } else {
    checks.push({ name: "the app received the deep link as a second instance", result: "PASS", detail: "the handoff exited 0" });
    // Only a signed-in app can redeem the ticket and leave a copy; without a
    // session the outcome is BLOCKED whatever we wait for, so skip the wait.
    if (signedIn) {
      const deadline = Date.now() + WORKING_COPY_TIMEOUT_MS;
      while (Date.now() < deadline && workingCopyDocumentId === null) {
        workingCopyDocumentId = findWorkingCopyDocumentId(ports.UNIWORK_USER_DATA, deploymentId, documentId);
        if (workingCopyDocumentId === null) await sleep(1_000);
      }
    }
  }
}

// No outcome when a seeding or mint failure already failed the step (its check
// carries the request that failed) or a desktop precondition blocked it: nothing
// was delivered, so there is no working copy to judge.
if (!mintError && !(desktopMode && !desktopSession)) {
  const outcome = documentStepOutcome({ launchUrl, ticket, workingCopyDocumentId, documentId, signedIn });
  checks.push({
    name: outcome.result === "PASS" ? "the app opened the fixture document" : "the app's working copy names the fixture document",
    result: outcome.result,
    detail: outcome.detail,
  });
  if (outcome.blocker) blockers.push(outcome.blocker);
}

// ---- clean up what this run seeded (reviewer_be H1-5) -------------------------
// The VM's database is shared and the harness never resets it, so a run removes
// what it made, by the ids it was handed. The product erases an organization
// asynchronously: POST /orgs/{orgID}/privacy/deletion only queues it (202) and
// the server's job erases it after 5 days. Until then the seeded account is
// still the organization's owner, and POST /me/delete refuses an owner with 409
// (AuthService.DeleteAccount: owner_must_transfer), so the account is not
// deleted in this run when an organization was seeded: it is a documented
// leftover (id and email below, no secret) that goes with the organization's
// erasure. Without a seeded organization the account is deleted right away.
// A reused account is a person's own and is never touched. A cleanup that
// fails or is deferred is reported in document-step.json and on stdout and
// never changes the result: it says nothing about the claim under test.
const cleanup = { skipped: reused ? "the account is reused, not seeded" : null, steps: [], leftovers: [] };
async function cleanupStep(name, run) {
  try {
    await run();
    cleanup.steps.push({ name, ok: true });
    return true;
  } catch (error) {
    cleanup.steps.push({ name, ok: false, detail: error.message });
    return false;
  }
}
if (!reused && token) {
  if (seeded.org) {
    const requested = await cleanupStep("request deletion of the seeded organization", () =>
      apiCall("requestOrganizationDeletion", { params: { orgID: seeded.org.id }, token, body: { confirm_slug: seeded.org.slug } }),
    );
    cleanup.leftovers.push({
      what: "organization",
      id: seeded.org.id,
      slug: seeded.org.slug,
      reason: requested ? "erasure is queued; the server's job removes it after its grace period (5 days)" : "the deletion request failed (see steps); it stays until someone removes it",
    });
    cleanup.leftovers.push({
      what: "account",
      id: seeded.userId,
      email,
      reason: "still the owner of the organization above, so POST /me/delete answers 409 until the organization is erased",
    });
  } else {
    await cleanupStep("delete the seeded account", () => apiCall("deleteAccount", { token, body: { password } }));
  }
  rmSync(paths.docUser, { force: true });
}

// ---- evidence line (the runner owns it under OFFICE_EVIDENCE_ID) -------------
const failed = checks.filter((c) => c.result === "FAIL");
const result = failed.length > 0 ? "FAIL" : blockers.length > 0 ? "BLOCKED" : "PASS";
const exitCode = result === "PASS" ? 0 : result === "BLOCKED" ? BLOCKED : 1;

const forkSha = process.env.OFFICE_FORK_SHA || ports.OFFICE_FORK_SHA || "";
const command = `node scripts/office/g5g6g7/harness/document-step.mjs --run-dir ${runDir} --req ${requirementId} --fixture ${fixtureId}`;
mkdirSync(runDir, { recursive: true });
const artifactPath = join(runDir, "document-step.json");
const failures = failed.map((check) => ({ check: check.name, ...(check.failure ?? { reason: check.detail }) }));
const report = { schemaVersion: 1, kind: "uniwork-office-g5g6g7-document-step", requirementId, fixtureId, documentId, deploymentId, checks, blockers, failures, cleanup, result };
appendFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`);

if (!process.env.OFFICE_EVIDENCE_ID) {
  const line = evidenceLine({
    evidenceId: harnessEvidenceId(requirementId),
    ...(await ledgerIdentity()),
    requirementId,
    fixtureId,
    fixtureSha256: fixture.sha256,
    fSha: forkSha,
    platform: `${process.platform}-${process.arch}`,
    build: `node ${process.versions.node}`,
    command,
    argv: [...process.argv],
    exitCode,
    result,
    artifact: artifactPath,
    checker: "harness:start.sh+document-step.mjs",
    blocker: blockers.join("; "),
    startedAt,
    finishedAt: new Date().toISOString(),
  });
  appendFileSync(paths.evidenceFile, `${JSON.stringify(line)}\n`);
}

for (const c of checks) console.log(`  ${c.result.padEnd(7)} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
for (const step of cleanup.steps) console.log(`  cleanup ${step.ok ? "ok     " : "FAILED "} ${step.name}${step.ok ? "" : ` — ${step.detail}`}`);
for (const left of cleanup.leftovers) console.log(`  cleanup left   ${left.what} ${left.id ?? left.email ?? ""} — ${left.reason}`);
if (cleanup.skipped) console.log(`  cleanup skipped: ${cleanup.skipped}`);
console.log(`document step: ${result}`);
for (const b of blockers) console.error(`  blocked: ${b}`);
// A FAIL says why on stderr too: under the evidence runner the output goes to the
// artifact, and the runner echoes a failing step's output into the round log.
for (const f of failures) console.error(`  FAILED: ${f.check} — ${f.reason}${f.request ? ` [request ${f.request.method} ${f.request.path} -> ${f.request.status}]` : ""}`);
console.log(`document step artifact: ${artifactPath}`);
process.exit(exitCode);
