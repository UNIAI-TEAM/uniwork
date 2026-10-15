#!/usr/bin/env node
/* global fetch, AbortSignal, FormData, Blob, process, console, Buffer, URL, setTimeout, clearTimeout */
// G7-04 cross-host loop driver (UNI-1386 card G7-04, lane g5-fork_ui_local).
//
// One continuous chain on ONE seeded document per fixture, on the G7-01 harness
// stack (D server + D web + the fork Electron app over CDP), recorded as one
// evidence line per (row, fixture):
//
//   node scripts/office/g5g6g7/evidence.mjs run --req G7-A01 --fixture fx-docx-report-vi \
//     --checker tester-cloud -- \
//     node scripts/office/g5g6g7/g7-04/cross-host.mjs --row G7-A01 --fixture fx-docx-report-vi
//
// Rows (receipts `docs/office/g5g6g7/acceptance.md` l.61 G5-A03, l.87 G7-A01):
//   * G5-A03 — both directions of a cross-host save land on the same version id
//     and checksum, and a dirty editor is never replaced by the incoming version.
//   * G7-A01 — the whole loop: web edit-save, opening the app from web, a desktop
//     offline edit-save, a reconnect the web sees, an AI turn plus Save; one
//     version per user Save, zero per AI turn, one checksum on both hosts.
//
// Hard rules (acceptance.md l.87, plan-G7-04):
//   * A step that cannot run is BLOCKED (exit 77) with a named blocker, NEVER
//     folded into a PASS.
//   * A fake provider (AI_PROVIDER=fake, a 503 ai_disabled, or no
//     HARNESS_ALLOW_REAL_AI_UPSTREAM=1) makes G7-A01's AI step BLOCKED with the
//     reason `real-AI upstream required, acceptance.md l.87`; it never closes
//     the row.
//   * Any checksum divergence between the hosts FAILs (exit 1), never a delay.
//   * The dirty editor row is driven through the app's own editor (CDP); when
//     that cannot be driven the row is BLOCKED, never PASS.
//   * Nothing is copied: the harness drivers (`harness/web.mjs`,
//     `harness/app.mjs`, `harness/app-steps.mjs`, `harness/lib.mjs`) and the
//     tracer helpers (`g7-10/tracer.mjs`) are imported; the CLI writes exactly
//     one artifact per (row, fixture) plus the evidence line `evidence.mjs`
//     wraps.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BLOCKED_EXIT,
  DEV_CLIENT_ID,
  HARNESS_DEPLOYMENT_ID,
  concludeAtStartGate,
  evidenceLine,
  fixtureSha256Of,
  harnessEvidenceId,
  harnessPaths,
  isMainModule,
  ledgerIdentity,
  officeDeepLink,
  readStartStatus,
  setAppApiProxyOnline,
  startGate,
} from "../harness/lib.mjs";
import {
  deliverDeepLink,
  inspectWorkingCopy,
  listAppSyncIntentFiles,
  loadPlaywrightChromium,
  parseEnvFile,
  resolveAppStepTimeoutMs,
  resolveLoopTimeoutMs,
  runBoundedAppStep,
  sleep,
  waitForDocsTabReadyToClose,
} from "../harness/app-steps.mjs";
import { connectApp, editorKindOfFormat, editorKindOfUrl } from "../harness/app.mjs";
import { documentUrl, webFrameSelectors, webLogin, webSave } from "../harness/web.mjs";
import { loadVerifiedFixture, sha256Hex } from "../harness/fixture-files.mjs";
import {
  buildEditedDocxFixtureBytes,
  buildXlsxRevenueWithXyzBytes,
  callTracerApi,
  classifyAiResponse,
  cleanupSeededOrganization,
  seedFixtureDocument,
} from "../g7-10/tracer.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = resolve(HERE, "../../../..");

/** The harness's BLOCKED exit (77), re-exported so a caller can pin it. */
export { BLOCKED_EXIT };

/** The two matrix rows this driver records. */
export const ROW_IDS = Object.freeze(["G7-A01", "G5-A03"]);
/** The two fixtures the rows declare (`acceptance-rows.json` l.129/l.888). */
export const FIXTURE_IDS = Object.freeze(["fx-xlsx-revenue-xyz", "fx-docx-report-vi"]);
/** Fixture -> the office module (web frame + editor kind). */
export const FIXTURE_KIND = Object.freeze({ "fx-xlsx-revenue-xyz": "sheets", "fx-docx-report-vi": "docs" });
/** The blocker a fake AI provider records for G7-A01.5 (acceptance.md l.87). */
export const REAL_AI_BLOCKER = "real-AI upstream required, acceptance.md l.87";
export const BLOCKED_OWNER = "g7-qa";
/** The web frame bundle is the F lane's pin (G8-19 R1 convention). */
export const WEB_FRAME_OWNER = "lead-f";
export const DEFAULT_STEP_TIMEOUT_MS = 45_000;
export const DEFAULT_POLL_MS = 250;

export const ROW_EXIT = Object.freeze({ PASS: 0, FAIL: 1, BLOCKED: BLOCKED_EXIT });

/** Every route this driver calls, pinned against the Go router by tracer.test.mjs. */
export const CROSS_HOST_API_CALLS = Object.freeze([
  "register",
  "verifyEmail",
  "createOrganization",
  "createWorkspace",
  "completeOnboarding",
  "createFileDocument",
  "mintLaunch",
  "getDocument",
  "listDocumentVersions",
  "mintOfficeFrameToken",
  "openOfficeFrameDocument",
  "getOfficeFrameDocumentContent",
  "uploadDocumentFile",
  "commitDocumentVersion",
  "lookupCommitIntent",
  "aiUniworkDocumentChatCompletions",
  "requestOrganizationDeletion",
]);

/** PASS 0, FAIL 1, BLOCKED 77; anything else is 1. */
export function exitCodeFor(status) {
  return Object.hasOwn(ROW_EXIT, status) ? ROW_EXIT[status] : ROW_EXIT.FAIL;
}

const REASON_MAX_CHARS = 2000;
/** A reason/blocker safe for an artifact: no token, ticket or credential-looking run. */
const safe = (text) => {
  let out = String(text ?? "").replace(/\s+/g, " ").trim();
  out = out.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, "<url>");
  out = out.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, (m, scheme) => `${scheme} <redacted>`);
  out = out.replace(
    /(?<=\b(?:access_token|refresh_token|id_token|token|secret|password|credential|authorization|api_?key|ticket|attempt_id|code|state)\s*[:=]\s*)[^\s,;&"']+/gi,
    "<redacted>",
  );
  out = out.replace(/[A-Za-z0-9_-]{32,}/g, "<redacted>");
  return out.length > REASON_MAX_CHARS ? `${out.slice(0, REASON_MAX_CHARS)}...` : out;
};

function assertKnownRow(row) {
  if (!ROW_IDS.includes(row)) throw new Error(`--row must be one of ${ROW_IDS.join(" | ")}, got "${row}"`);
}

function assertKnownFixture(fixture) {
  if (fixture !== "all" && !FIXTURE_IDS.includes(fixture)) {
    throw new Error(`--fixture must be one of ${FIXTURE_IDS.join(" | ")} | all, got "${fixture}"`);
  }
}

/**
 * `cross-host.mjs --row <G7-A01|G5-A03> [--fixture <id>|all] [--run-dir <dir>]
 * [--timeout-ms <ms>] [--dry-run]`. `--run-dir` defaults to `HARNESS_RUN_DIR`
 * (else `<repo>/.harness-run`, where start.sh writes ports.env).
 *
 * Under `evidence.mjs run` (`OFFICE_EVIDENCE_ID` set) exactly one fixture is
 * required: one invocation writes one ledger line, and a line standing for two
 * fixtures would be wrong.
 */
export function parseCrossHostArgs(argv, env = process.env) {
  const out = {
    row: "",
    fixture: "all",
    runDir: env.HARNESS_RUN_DIR || resolve(DEFAULT_REPO_ROOT, ".harness-run"),
    timeoutMs: null,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`${arg} needs a value`);
      i += 1;
      return value;
    };
    if (arg === "--row") out.row = next();
    else if (arg === "--fixture") out.fixture = next();
    else if (arg === "--run-dir") out.runDir = resolve(next());
    else if (arg === "--timeout-ms") out.timeoutMs = Number(next());
    else if (arg === "--dry-run") out.dryRun = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  if (!out.row) {
    throw new Error(
      `usage: --row ${ROW_IDS.join("|")} [--fixture ${FIXTURE_IDS.join("|")}|all] [--run-dir <dir>] [--timeout-ms <ms>] [--dry-run]`,
    );
  }
  assertKnownRow(out.row);
  assertKnownFixture(out.fixture);
  if (env.OFFICE_EVIDENCE_ID && out.fixture === "all") {
    throw new Error("evidence.mjs run records one fixture per evidence line; pass --fixture <id> (not all) under the runner");
  }
  return out;
}

/** The steps each row's chain must record (G7-A01 adds the AI turn and its Save). */
export const ROW_REQUIRED_STEPS = Object.freeze({
  "G5-A03": Object.freeze([
    "seed",
    "web-open",
    "web-save-1",
    "app-open",
    "app-dirty",
    "web-save-2",
    "dirty-kept",
    "app-reload",
    "app-offline-save",
    "app-reconnect",
    "web-sees",
    "final-shas",
  ]),
  "G7-A01": Object.freeze([
    "seed",
    "web-open",
    "web-save-1",
    "app-open",
    "app-dirty",
    "web-save-2",
    "dirty-kept",
    "app-reload",
    "app-offline-save",
    "app-reconnect",
    "web-sees",
    "ai-turn",
    "ai-save",
    "final-shas",
  ]),
});

/**
 * The row's outcome from its record (pure, so the tests can pin every verdict):
 *   1. a FAILed step is a FAIL (its reason wins);
 *   2. else a BLOCKED step is a BLOCKED (exit 77) with the blockers joined;
 *   3. else a required step that did not run is a FAIL (`step X did not run`);
 *   4. a three-way checksum divergence is a FAIL (never a delay);
 *   5. a version tally other than one-per-user-Save / zero-per-AI-turn is a FAIL.
 */
export function decideCrossHostOutcome(record = {}) {
  const steps = record.steps ?? {};
  const entries = Object.entries(steps);
  const failing = ([, s]) => s?.status !== "PASS" && s?.status !== "BLOCKED";
  const failed = entries.filter(failing);
  if (failed.length > 0) {
    const owners = [...new Set(failed.map(([, s]) => s?.owner || ""))].filter(Boolean);
    return {
      status: "FAIL",
      exitCode: 1,
      reason: safe(failed.map(([name, s]) => `${name}: ${s?.reason || s?.status || "no status"}`).join("; ")),
      ...(owners.length > 0 ? { owner: owners.join(", ") } : {}),
      blocker: "",
    };
  }
  if (entries.length === 0) return { status: "FAIL", exitCode: 1, reason: "no steps ran", blocker: "" };
  const blocked = entries.filter(([, s]) => s.status === "BLOCKED");
  const required = ROW_REQUIRED_STEPS[record.row] ?? ROW_REQUIRED_STEPS["G7-A01"];
  const missing = required.filter((name) => !steps[name]);
  if (blocked.length > 0) {
    const blockers = [...new Set(blocked.map(([, s]) => s?.blocker || ""))].filter(Boolean);
    const owners = [...new Set(blocked.map(([, s]) => s?.owner || ""))].filter(Boolean);
    return {
      status: "BLOCKED",
      exitCode: BLOCKED_EXIT,
      reason: safe(blocked.map(([name, s]) => `${name}: ${s?.blocker || s?.reason || "no blocker"}`).join("; ")),
      blocker: safe(blockers.join("; ") || `BLOCKED without a named blocker (${blocked.map(([n]) => n).join(", ")})`),
      owner: owners.join(", ") || BLOCKED_OWNER,
    };
  }
  if (missing.length > 0) {
    return { status: "FAIL", exitCode: 1, reason: safe(`required step(s) did not run: ${missing.join(", ")}`), blocker: "" };
  }
  const checksums = record.checksums ?? {};
  const threeWay = [checksums.server, checksums.webContent, checksums.desktopWorkingCopy];
  if (threeWay.some((value) => typeof value !== "string" || value === "") || new Set(threeWay).size !== 1) {
    return {
      status: "FAIL",
      exitCode: 1,
      reason: safe(
        `checksum divergence between the hosts: server=${checksums.server ?? "none"}, web=${checksums.webContent ?? "none"}, desktop=${checksums.desktopWorkingCopy ?? "none"}`,
      ),
      blocker: "",
    };
  }
  const counts = record.versionCounts ?? {};
  const userSaves = record.userSaves ?? [];
  const aiTurns = record.aiTurns ?? [];
  const aiDeltas = aiTurns.map((t) => Number(t.versionsAfter) - Number(t.versionsBefore));
  if (aiDeltas.some((delta) => delta !== 0)) {
    return { status: "FAIL", exitCode: 1, reason: safe("a version was created by an AI turn (G7-A01.5: zero per AI turn)"), blocker: "" };
  }
  const expectedFinal = 1 + userSaves.length;
  if (Number(counts.final) !== expectedFinal) {
    return {
      status: "FAIL",
      exitCode: 1,
      reason: safe(`version tally ${counts.final ?? "none"} != 1 seeded + ${userSaves.length} user Save(s)`),
      blocker: "",
    };
  }
  return { status: "PASS", exitCode: 0, reason: "", blocker: "" };
}

// ---- in-page editor actions (desktop) ------------------------------------------------------

/**
 * The desktop-editor dirtying plans: product commands only, one per fixture
 * format. Cites: fork `apps/sheets/src/renderer/control.ts:4-5,63-90` (goto
 * activates a range), `apps/docs/src/renderer/control.ts:6,50` (goto a block),
 * `apps/docs/src/renderer/App.tsx:4188` (`window.__genofficeControl`); the
 * same plans drive the G8-19 rows (`g8-19/anchors.mjs` EDIT_DRIVERS).
 */
export const DIRTY_EDIT_PLANS = Object.freeze({
  sheets: {
    name: "insert-row",
    actions: [
      { type: "control", req: { cmd: "goto", target: { kind: "range", sheet: "Doanh thu Q2", range: "A7" } } },
      { type: "click", selector: "button[aria-label]", name: "^(Insert row|Chèn hàng)$" },
    ],
  },
  docs: {
    name: "split-block",
    actions: [
      { type: "control", req: { cmd: "goto", target: { kind: "block", block: 0 } } },
      { type: "key", key: "Enter", target: ".ProseMirror" },
    ],
  },
});

/** Text of the S6 new-version bar (`docs/office/g5g6g7/ux/EXPERIENCE.md:957-958`), vi + en. */
const REMOTE_NEWER_TEXT = /(phiên bản mới hơn trên UniWork|newer version (?:is )?on UniWork)/i;
const REMOTE_NEWER_VERSION = /(?:phiên bản|version)\s*\(?\s*(\d+)/i;
/** The bar's reload action (`uwRemoteReload`). */
const REMOTE_NEWER_RELOAD = /(Tải lại bản mới nhất|Reload latest)/i;
const CONFIRM_ACTION = /^(Tải lại|Reload|Đồng ý|Xác nhận|Có|OK|Continue)$/i;

/**
 * One editor-page action (self-contained: Playwright serializes it), the shape
 * `g8-19/anchors.mjs` pageAction established: `control` calls the editor's own
 * `window.__genofficeControl`, `click` finds a product control by CSS +
 * accessible name, `key` dispatches keydown/keyup to a target (the editors'
 * own keymaps handle it). Resolves `{status:"ok"|"error"}`.
 */
export function appPageAction(action) {
  const wait = (ms) => new Promise((done) => setTimeout(done, ms));
  const labelOf = (el) => (el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim();
  if (action.type === "control") {
    for (let i = 0; i < 40; i += 1) {
      const fn = window.__genofficeControl;
      const reply = typeof fn === "function" ? fn(action.req) : null;
      if (reply && reply.status !== "not_ready") {
        return reply.status === "ok"
          ? { status: "ok", result: reply.result ?? null }
          : { status: "error", reason: JSON.stringify(reply.error ?? reply) };
      }
      wait(250);
    }
    return { status: "error", reason: "__genofficeControl stayed not_ready" };
  }
  if (action.type === "click") {
    const re = action.name ? new RegExp(action.name, "i") : null;
    let el = null;
    for (let i = 0; i < 20 && !el; i += 1) {
      el = [...document.querySelectorAll(action.selector || "button")].find((node) => !re || re.test(labelOf(node))) ?? null;
      if (!el) wait(250);
    }
    if (!el) return { status: "error", reason: `no element ${action.selector || "button"}${action.name ? ` named /${action.name}/` : ""}` };
    if (el.disabled || el.getAttribute("aria-disabled") === "true") return { status: "error", reason: `${labelOf(el) || action.selector} is disabled` };
    el.click();
    return { status: "ok", label: labelOf(el).slice(0, 80) };
  }
  if (action.type === "key") {
    const target = action.target ? document.querySelector(action.target) : document.activeElement || document.body;
    if (!target) return { status: "error", reason: `no ${action.target}` };
    const init = { key: action.key, code: action.code ?? action.key, bubbles: true, cancelable: true };
    target.dispatchEvent(new KeyboardEvent("keydown", init));
    target.dispatchEvent(new KeyboardEvent("keyup", init));
    return { status: "ok" };
  }
  return { status: "error", reason: `unknown page action ${action.type}` };
}

/**
 * The S6 surface on one app page: any element whose text carries the
 * new-version bar message, the version number it names, and its reload action.
 * Read-only; the click is a second pass over the same matcher.
 */
export function readRemoteNewerSurface({ version = null } = {}) {
  const seen = [];
  for (const el of document.querySelectorAll("div,section,aside,header,p,span,li")) {
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!text || text.length > 400 || !REMOTE_NEWER_TEXT.test(text)) continue;
    const named = REMOTE_NEWER_VERSION.exec(text);
    seen.push({ text, version: named ? Number(named[1]) : null });
  }
  const actions = [...document.querySelectorAll("button,a,[role='button']")].filter((el) =>
    REMOTE_NEWER_RELOAD.test((el.textContent ?? "").trim()),
  );
  const best = seen.find((s) => (version === null ? true : s.version === version)) ?? seen[0] ?? null;
  return {
    visible: seen.length > 0 && actions.length > 0,
    text: best?.text ?? "",
    version: best?.version ?? null,
    actionFound: actions.length > 0,
  };
}

// ---- small polling helper ------------------------------------------------------------------

async function pollUntil(fn, pred, { boundMs = DEFAULT_STEP_TIMEOUT_MS, intervalMs = DEFAULT_POLL_MS, sleepFn = sleep, now = Date.now } = {}) {
  const started = now();
  let value;
  for (;;) {
    value = await fn();
    if (pred(value)) return { value, ok: true, elapsedMs: now() - started };
    if (now() - started >= boundMs) return { value, ok: false, elapsedMs: now() - started };
    await sleepFn(Math.min(intervalMs, Math.max(1, boundMs - (now() - started))));
  }
}

// ---- the real web host controller (D web page + the pinned frame) ---------------------------

const FRAME_OPEN_PATH = /^\/api\/v1\/office-frame\/documents\/[^/]+$/;

/**
 * The web half on Playwright: signs the seeded account in at `/login`, opens
 * the document URL the D Inbox builds, waits for the Office frame host
 * (`data-state="ready"`), edits the frame the way the D e2e does
 * (`e2e/office-modules-web.spec.ts` sheets/html cases) and saves with
 * `harness/web.mjs` `webSave` (the frame's own Ctrl+S commit answer).
 *
 * What the host told the frame is captured by wrapping
 * `Window.prototype.postMessage` before any page script runs: the D vendored
 * host posts `{kind:"event", type:"doc.remoteVersion", payload:{version_id,…}}`
 * to the frame's window once the handshake is done
 * (`packages/core/office/docs-frame-host.ts:370-390`), so a captured event is
 * the web's own S6 notice, and its `version_id` is the version the frame was
 * told about. The frame's reload is read from its own `api.open` answer (the
 * `GET /office-frame/documents/{id}` response: `file.version_id`).
 */
async function createPlaywrightWebCtrl({
  webOrigin,
  runDir,
  repoRoot,
  documentId,
  kind,
  orgSlug,
  wsSlug,
  user,
  stepTimeoutMs = DEFAULT_STEP_TIMEOUT_MS,
  pollMs = DEFAULT_POLL_MS,
  apiOrigin,
  fetchImpl = fetch,
  token,
}) {
  const unavailable = (reason, status = "BLOCKED", owner = BLOCKED_OWNER) => {
    const err = new Error(reason);
    err.webUnavailable = { status, reason, owner };
    return err;
  };
  if (!webOrigin) throw unavailable(`no live WEB_ORIGIN for the web half of the loop (missing from ${join(runDir, "ports.env")})`);
  // The web page is part of the harness stack: an origin that does not answer is
  // a step that cannot run (BLOCKED), never a product FAIL (the tracer's own
  // rule for a WEB_ORIGIN that is not live).
  try {
    const probe = await fetchImpl(`${webOrigin}/login`, { signal: AbortSignal.timeout(5_000) });
    if (!probe.ok) throw unavailable(`no live WEB_ORIGIN: ${webOrigin}/login answered ${probe.status}`);
  } catch (err) {
    if (err?.webUnavailable) throw err;
    throw unavailable(`no live WEB_ORIGIN: ${webOrigin}/login is unreachable (${err.message})`);
  }
  const chromium = loadPlaywrightChromium(repoRoot);
  if (!chromium) throw unavailable("Playwright chromium is not loadable in this checkout; the web half of the loop cannot run");

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (err) {
    throw unavailable(`could not launch chromium: ${err.message}`);
  }
  let web;
  const opens = [];
  const close = async () => {
    await browser?.close().catch(() => {});
  };
  try {
    web = await webLogin(browser, user, { webOrigin, locale: "en", timeoutMs: stepTimeoutMs });
    await web.context.addInitScript(() => {
      const original = Window.prototype.postMessage;
      const list = [];
      Object.defineProperty(window, "__crossHostFrameMessages", { value: list, configurable: true });
      Window.prototype.postMessage = function patched(message, targetOrigin, transfer) {
        try {
          if (message && typeof message === "object" && message.kind === "event" && typeof message.type === "string") {
            const payload = message.payload ?? {};
            list.push({
              type: message.type,
              versionId: payload.version_id ?? null,
              version: payload.version ?? null,
              revision: payload.revision ?? null,
              reason: payload.reason ?? null,
              at: Date.now(),
            });
          }
        } catch {
          // observing must never break the frame protocol
        }
        return transfer !== undefined
          ? original.call(this, message, targetOrigin, transfer)
          : original.call(this, message, targetOrigin);
      };
    });
    web.page.on("response", (response) => {
      try {
        const url = new URL(response.url());
        if (response.request().method() !== "GET" || !FRAME_OPEN_PATH.test(url.pathname)) return;
        if (!url.pathname.includes(documentId)) return;
        const at = Date.now();
        response
          .json()
          .then((body) => {
            opens.push({
              at,
              versionId: body?.file?.version_id ?? null,
              version: body?.file?.version ?? null,
              checksum: body?.file?.checksum_sha256 ?? null,
              revision: body?.revision ?? null,
            });
          })
          .catch(() => {
            opens.push({ at, versionId: null, version: null, checksum: null, revision: null });
          });
      } catch {
        // a malformed URL is not a frame open
      }
    });
    await web.page.goto(documentUrl({ webOrigin, org: orgSlug, ws: wsSlug, documentId }), {
      waitUntil: "domcontentloaded",
      timeout: stepTimeoutMs,
    });
    const sel = webFrameSelectors(kind);
    try {
      await web.page.waitForSelector(sel.ready, { state: "visible", timeout: stepTimeoutMs });
    } catch (err) {
      const failure = await web.page
        .evaluate(() => {
          const failed = document.querySelector('[data-testid="office-docs-frame-failed"]');
          if (failed) return { kind: failed.getAttribute("data-failure-kind") ?? "failed" };
          const host = document.querySelector("[data-office-docs-frame]");
          return { kind: host ? `state=${host.getAttribute("data-state")}` : "no host element" };
        })
        .catch(() => ({ kind: "no page answer" }));
      await close();
      throw unavailable(
        `the web ${kind} frame did not reach data-state="ready" within ${stepTimeoutMs} ms (${failure.kind}); the pinned frame bundle must be installed in the web build`,
        "BLOCKED",
        WEB_FRAME_OWNER,
      );
    }

    const hostReady = () => web.page.waitForSelector(sel.ready, { state: "visible", timeout: stepTimeoutMs }).then(() => true).catch(() => false);

    const editFrame = async (marker) => {
      const frame = web.page.frameLocator(sel.iframe);
      try {
        if (kind === "sheets") {
          await frame.locator('canvas[id^="univer-sheet-main-canvas"]').first().click({ position: { x: 300, y: 200 }, timeout: stepTimeoutMs });
          const nameBox = frame.locator('[data-u-comp="defined-name"] input').first();
          await nameBox.click({ timeout: stepTimeoutMs });
          await nameBox.fill("A1");
          await nameBox.press("Enter");
          await web.page.waitForTimeout(300);
          await web.page.keyboard.type(String(marker));
          await web.page.keyboard.press("Enter");
        } else {
          const editor = frame.locator(".ProseMirror").first();
          await editor.click({ timeout: stepTimeoutMs });
          await web.page.keyboard.press("End");
          await web.page.keyboard.type(` ${marker}`);
        }
      } catch (err) {
        return { ok: false, drivable: false, reason: `the ${kind} frame editor could not be driven: ${err.message}` };
      }
      const deadline = Date.now() + Math.min(stepTimeoutMs, 10_000);
      while (Date.now() < deadline) {
        const dirty = await web.page
          .evaluate((hostSel) => document.querySelector(hostSel)?.hasAttribute("data-dirty") ?? null, sel.host)
          .catch(() => null);
        if (dirty === true) return { ok: true, dirtyObserved: true };
        if (dirty === null) return { ok: true, dirtyObserved: null };
        await sleep(pollMs);
      }
      return { ok: true, dirtyObserved: false };
    };

    return {
      async open() {
        return { opened: true, status: "ready" };
      },
      async editAndSave({ marker }) {
        const edited = await editFrame(marker);
        if (!edited.ok) {
          return { saved: false, drivable: false, reason: edited.reason };
        }
        const saved = await webSave(web.page, { kind, timeoutMs: stepTimeoutMs });
        if (saved.status !== "saved") {
          return { saved: false, drivable: true, reason: saved.reason, dirtyObserved: edited.dirtyObserved };
        }
        if (!(await hostReady())) {
          return { saved: false, drivable: true, reason: `the ${kind} frame left data-state="ready" after the save` };
        }
        return {
          saved: true,
          drivable: true,
          dirtyObserved: edited.dirtyObserved,
          versionId: saved.versionId,
          version: saved.version ?? null,
          revision: saved.revision ?? null,
        };
      },
      async announcements({ sinceMs = 0 } = {}) {
        const messages = await web.page
          .evaluate(() =>
            (window.__crossHostFrameMessages ?? []).map((m) => ({
              type: m.type,
              versionId: m.versionId,
              version: m.version,
              revision: m.revision,
              reason: m.reason,
              at: m.at,
            })),
          )
          .catch(() => []);
        return messages.filter((m) => m.type === "doc.remoteVersion" && m.at >= sinceMs);
      },
      async waitForReload({ versionId, timeoutMs = stepTimeoutMs }) {
        const startedAt = Date.now();
        const settled = await pollUntil(
          async () => opens.filter((o) => o.at >= startedAt - 1),
          (list) => list.some((o) => o.versionId === versionId),
          { boundMs: timeoutMs, intervalMs: pollMs },
        );
        const hit = (settled.value ?? []).find((o) => o.versionId === versionId) ?? null;
        if (!hit) {
          return {
            reloaded: false,
            elapsedMs: settled.elapsedMs,
            reason: `the web frame made no fresh office-frame open for ${versionId} within ${timeoutMs} ms`,
          };
        }
        return { reloaded: true, versionId: hit.versionId, version: hit.version, checksum: hit.checksum, revision: hit.revision, elapsedMs: settled.elapsedMs };
      },
      async fetchHeadViaFrameRoute() {
        return readFrameHeadViaProtocol({ apiOrigin, fetchImpl, documentId, token, withBytes: true });
      },
      async close() {
        await close();
      },
    };
  } catch (err) {
    await close();
    throw err;
  }
}

// ---- the real desktop app controller (CDP + the harness TCP proxy) --------------------------

/**
 * The app half on `harness/app.mjs` `connectApp` (CDP) plus the harness's own
 * primitives: the deep-link handoff (`openDocumentV1`'s recipe in the tracer),
 * the app's own Save (`aiOffice.uniworkSave`), the proxy cut
 * (`setAppApiProxyOnline`), the forced sync pass (`aiOffice.accountRetry`, the
 * tracer's `waitForFeedReloadV2`), the editor dirtying plans above, and the
 * docs tab close dance (`waitForDocsTabReadyToClose`).
 */
async function createCdpAppCtrl({
  portsEnv,
  runDir,
  apiOrigin,
  fetchImpl = fetch,
  repoRoot,
  user,
  documentId,
  kind,
  stepTimeoutMs = DEFAULT_STEP_TIMEOUT_MS,
  pollMs = DEFAULT_POLL_MS,
  deepLinkDeliverer = deliverDeepLink,
}) {
  const deploymentId = portsEnv.HARNESS_DEPLOYMENT_ID || HARNESS_DEPLOYMENT_ID;
  const unavailableCtrl = ({ status, reason, owner = BLOCKED_OWNER }) => ({
    signedIn: false,
    driven: false,
    signInFailureReason: status === "FAIL" ? reason : "",
    blockerReason: status === "BLOCKED" ? reason : "",
    blockerOwner: owner,
    close: async () => {},
  });
  let ctrl;
  try {
    ctrl = await connectApp({ portsEnv, runDir, apiOrigin, fetchImpl, repoRoot, timeoutMs: stepTimeoutMs, deepLinkDeliverer });
  } catch (err) {
    const availability = err?.appUnavailable;
    if (availability) return unavailableCtrl(availability);
    throw err;
  }

  let signedIn = false;
  let signInFailureReason = "";
  let blockerReason = "";
  try {
    const signed = await ctrl.signIn(user);
    const state = signed?.status?.state;
    const sessionBin = existsSync(join(portsEnv.UNIWORK_USER_DATA, "uniwork-auth", "session.bin"));
    signedIn = (state === "signed-in" || signed?.status?.loggedIn === true) && sessionBin;
    if (!signedIn) {
      if (state === "keyring-unavailable" || state === "keystore-locked") {
        blockerReason = `the app is not signed in (accountStatus.state=${state}; a headless VM without an unlocked OS keyring cannot keep a desktop session)`;
      } else {
        signInFailureReason = `desktop app sign-in did not reach accountStatus.state="signed-in" with session.bin on disk (got state="${state ?? "unknown"}")`;
      }
    }
  } catch (err) {
    if (err?.isAppStepTimeout) throw err;
    signInFailureReason = `desktop app sign-in failed while the OS keyring was available: ${err.message}`;
  }
  if (!signedIn) {
    await ctrl.close().catch(() => {});
    return { ...unavailableCtrl({ status: blockerReason ? "BLOCKED" : "FAIL", reason: blockerReason || signInFailureReason }), ctrl: null };
  }

  const userDataDir = portsEnv.UNIWORK_USER_DATA;
  const evalShell = (call, fn, arg) => runBoundedAppStep(call, () => ctrl.shellPage.evaluate(fn, arg), { timeoutMs: stepTimeoutMs, portsEnv, runDir, userDataDir, deploymentId, documentId, expectedUserId: user.id });
  const workingCopy = () => {
    const wc = inspectWorkingCopy({ userDataDir, deploymentId, documentId, expectedUserId: user.id });
    if (!wc.workingCopyFilePath || !existsSync(wc.workingCopyFilePath)) return { ...wc, sha256: "", bytes: null };
    const bytes = readFileSync(wc.workingCopyFilePath);
    return { ...wc, sha256: sha256Hex(bytes), bytes };
  };
  const appPages = () => {
    const pages = [];
    for (const ctx of ctrl.browser?.contexts?.() ?? []) {
      for (const page of ctx.pages?.() ?? []) pages.push(page);
    }
    return pages;
  };
  /** The page that carries the S6 bar (probed with readRemoteNewerSurface). */
  const findRemoteNewerPage = async (version) => {
    for (const page of appPages()) {
      const probe = await runBoundedAppStep("readRemoteNewerSurface", () => page.evaluate(readRemoteNewerSurface, { version }), {
        timeoutMs: stepTimeoutMs,
        portsEnv,
        runDir,
        userDataDir,
        deploymentId,
        documentId,
        expectedUserId: user.id,
      }).catch((err) => {
        if (err?.isAppStepTimeout) throw err;
        return null;
      });
      if (probe?.visible) return { page, probe };
    }
    return { page: null, probe: null };
  };
  /** Closes the open tab of `filePath` the way the tracer does (readiness first), so a later Save takes the coordinator path. */
  const closeOpenTab = async (filePath) => {
    const tabs = await evalShell(
      "aiOfficeTabs.list",
      async (targetPath) => {
        if (!window.aiOfficeTabs?.list || !window.aiOfficeTabs?.close) return [];
        const list = await window.aiOfficeTabs.list();
        const items = Array.isArray(list?.tabs) ? list.tabs : Array.isArray(list) ? list : [];
        return items.filter((t) => t && t.filePath === targetPath && t.id).map((t) => ({ id: t.id, kind: t.kind ?? null, filePath: t.filePath }));
      },
      filePath,
    ).catch((err) => {
      if (err?.isAppStepTimeout) throw err;
      return [];
    });
    for (const tab of tabs ?? []) {
      const isDocsTab = tab.kind === "docs" || (!tab.kind && /\.docx$/i.test(String(tab.filePath)));
      if (isDocsTab) {
        await waitForDocsTabReadyToClose({
          browser: ctrl.browser,
          shellPage: ctrl.shellPage,
          filePath: tab.filePath,
          timeoutMs: stepTimeoutMs,
          portsEnv,
          runDir,
          userDataDir,
          deploymentId,
          documentId,
          expectedUserId: user.id,
        });
      }
      await evalShell("aiOfficeTabs.close", async (tabId) => window.aiOfficeTabs.close(tabId), tab.id).catch((err) => {
        if (err?.isAppStepTimeout) throw err;
      });
    }
  };
  const accountRetry = () =>
    evalShell("aiOffice.accountRetry", () => window.aiOffice.accountRetry?.(), undefined).catch((err) => {
      if (err?.isAppStepTimeout) throw err;
    });

  return {
    signedIn: true,
    driven: true,
    signInFailureReason: "",
    blockerReason: "",
    userDataDir,
    workingCopy,
    intents: () => listAppSyncIntentFiles(userDataDir, deploymentId, user.id),
    async openDocument({ launchUrl }) {
      const handoff = deepLinkDeliverer(portsEnv, launchUrl);
      if (handoff?.error || (typeof handoff?.status === "number" && handoff.status !== 0)) {
        return { opened: false, drivable: false, reason: `deep-link handoff failed (exit ${handoff?.status ?? "err"})` };
      }
      const settled = await pollUntil(
        async () => workingCopy(),
        (wc) => wc.bindingPresent && wc.filePresent,
        { boundMs: stepTimeoutMs, intervalMs: pollMs },
      );
      const wc = settled.value ?? workingCopy();
      if (!wc.bindingPresent || !wc.filePresent) {
        return { opened: false, drivable: true, reason: `the app left no working copy for ${documentId} within ${stepTimeoutMs} ms` };
      }
      return { opened: true, path: wc.workingCopyFilePath, kind: editorKindOfFormat(wc.binding?.format) ?? kind, binding: wc.binding, sha256: wc.sha256 };
    },
    async makeDirty({ path }) {
      const plan = DIRTY_EDIT_PLANS[kind];
      let page;
      try {
        page = await ctrl.editorPage(kind, { path, documentId });
      } catch (err) {
        if (err?.isAppStepTimeout) throw err;
        return { edited: false, source: "none", reason: `no ${kind} editor page for the working copy: ${err.message}` };
      }
      for (const action of plan.actions) {
        const res = await ctrl.evalBounded(page, appPageAction, action, `edit:${action.type}`).catch((err) => {
          if (err?.isAppStepTimeout) throw err;
          return { status: "error", reason: err.message };
        });
        if (res?.status !== "ok") {
          return { edited: false, source: "none", reason: `the ${kind} editor refused the ${plan.name} plan: ${res?.reason ?? "no answer"}` };
        }
      }
      return { edited: true, source: "app-ui", plan: plan.name };
    },
    async remoteNewerBar({ version }) {
      const { page, probe } = await findRemoteNewerPage(version);
      if (!page) return { visible: false, reason: `no new-version bar naming version ${version} on any app page` };
      return { visible: true, version: probe.version, text: probe.text, where: editorKindOfUrl(page.url()) ?? "shell" };
    },
    async clickReload() {
      const { page, probe } = await findRemoteNewerPage(null);
      if (!page) return { clicked: false, reason: "no new-version bar on any app page" };
      const clicked = await ctrl
        .evalBounded(
          page,
          () => {
            const reload = [...document.querySelectorAll("button,a,[role='button']")].find((el) =>
              /(Tải lại bản mới nhất|Reload latest)/i.test((el.textContent ?? "").trim()),
            );
            if (!reload) return { clicked: false, reason: "the bar carries no reload action" };
            reload.click();
            return { clicked: true };
          },
          undefined,
          "click:remoteNewerReload",
        )
        .catch((err) => {
          if (err?.isAppStepTimeout) throw err;
          return { clicked: false, reason: err.message };
        });
      if (!clicked?.clicked) return { clicked: false, reason: clicked?.reason ?? "no reload action" };
      // a dirty document may be confirmed first (the bar's own confirm, when it shows one)
      await sleep(Math.min(pollMs * 2, 1000));
      await ctrl
        .evalBounded(
          page,
          () => {
            const confirm = [...document.querySelectorAll("button,[role='button']")].find((el) =>
              /^(Tải lại|Reload|Đồng ý|Xác nhận|Có|OK|Continue)$/i.test((el.textContent ?? "").trim()),
            );
            if (confirm && !confirm.getAttribute("aria-disabled")) confirm.click();
            return true;
          },
          undefined,
          "click:remoteNewerConfirm",
        )
        .catch(() => {});
      return { clicked: true, text: probe?.text ?? "" };
    },
    async cutLink() {
      setAppApiProxyOnline(runDir, false);
      return { cut: true };
    },
    async restoreLink() {
      setAppApiProxyOnline(runDir, true);
      return { restored: true };
    },
    /** A forced sync pass (the tracer's waitForFeedReloadV2 recipe): cut, retry, restore, retry. */
    async nudgeSync() {
      setAppApiProxyOnline(runDir, false);
      await accountRetry();
      setAppApiProxyOnline(runDir, true);
      await accountRetry();
      return { nudged: true };
    },
    /** The app's own Save; `standInBytes` first writes the fallback bytes (tab closed) like the tracer. */
    async save({ path, offline = false, standInBytes = null }) {
      if (standInBytes) {
        await closeOpenTab(path);
        writeFileSync(path, standInBytes);
      }
      if (offline) setAppApiProxyOnline(runDir, false);
      await ctrl.save(path);
      return { requested: true, closedTab: Boolean(standInBytes), offline };
    },
    async close() {
      setAppApiProxyOnline(runDir, true);
      await ctrl.close().catch(() => {});
    },
  };
}

// ---- protocol reads ------------------------------------------------------------------------

/** The office-frame head (the same route the web frame opens through) + its content bytes. */
async function readFrameHeadViaProtocol({ apiOrigin, fetchImpl = fetch, documentId, token, withBytes = false }) {
  const tokenRes = await callTracerApi({ apiOrigin, fetchImpl, name: "mintOfficeFrameToken", params: { documentID: documentId }, token });
  const frameToken = tokenRes.data?.token;
  if (!frameToken) throw new Error("mintOfficeFrameToken returned no token");
  const openRes = await callTracerApi({ apiOrigin, fetchImpl, name: "openOfficeFrameDocument", params: { documentID: documentId }, token: frameToken });
  const file = openRes.data?.file ?? {};
  let sha256 = "";
  if (withBytes) {
    const contentRes = await callTracerApi({ apiOrigin, fetchImpl, name: "getOfficeFrameDocumentContent", params: { documentID: documentId }, token: frameToken, expectBinary: true });
    sha256 = sha256Hex(contentRes.bytes);
  }
  return {
    versionId: file.version_id ?? null,
    version: file.version ?? null,
    checksum: file.checksum_sha256 ?? null,
    revision: openRes.data?.revision ?? null,
    sha256,
  };
}

async function listVersions({ apiOrigin, fetchImpl = fetch, documentId, token }) {
  const res = await callTracerApi({ apiOrigin, fetchImpl, name: "listDocumentVersions", params: { documentID: documentId }, token });
  return res.data?.versions?.length ?? 0;
}

// ---- the chain -----------------------------------------------------------------------------

function emptyRecord({ row, fixture, kind }) {
  return {
    row,
    fixture,
    kind,
    module: "cross-host",
    status: "FAIL",
    exitCode: 1,
    reason: "",
    blocker: "",
    owner: "",
    steps: {},
    versionCounts: {},
    versionIds: {},
    checksums: {},
    userSaves: [],
    aiTurns: [],
    notes: [],
    details: {},
    log: [],
  };
}

/**
 * Runs the whole cross-host chain for one (row, fixture) and returns
 * `{ status, exitCode, reason, blocker, owner, record, artifactPath }`.
 * `webFactory`/`appFactory` are the injection points the tests use; the CLI
 * uses the real Playwright / CDP controllers above.
 */
export async function runCrossHostRow({
  row,
  fixture,
  runDir,
  repoRoot = DEFAULT_REPO_ROOT,
  fetchImpl = fetch,
  stepTimeoutMs = null,
  pollMs = DEFAULT_POLL_MS,
  rowTimeoutMs = null,
  dryRun = false,
  webFactory = createPlaywrightWebCtrl,
  appFactory = createCdpAppCtrl,
  deepLinkDeliverer = deliverDeepLink,
  hooks = null,
  env = process.env,
}) {
  assertKnownRow(row);
  assertKnownFixture(fixture);
  if (fixture === "all") throw new Error("runCrossHostRow runs one fixture; pass a fixture id");
  const artifactPath = crossHostArtifactPath(runDir, row, fixture);
  const startedAt = new Date().toISOString();
  const record = emptyRecord({ row, fixture, kind: FIXTURE_KIND[fixture] });
  const paths = harnessPaths(runDir);
  const portsText = existsSync(paths.envFile) ? readFileSync(paths.envFile, "utf8") : "";
  const portsEnv = parseEnvFile(portsText);
  record.forkSha = env.OFFICE_FORK_SHA || portsEnv.OFFICE_FORK_SHA || "";

  const finish = (outcome) => {
    Object.assign(record, {
      status: outcome.status,
      exitCode: exitCodeFor(outcome.status),
      reason: safe(outcome.reason ?? ""),
      blocker: safe(outcome.blocker ?? ""),
      owner: outcome.owner ?? "",
    });
    record.startedAt = startedAt;
    record.finishedAt = new Date().toISOString();
    // a dry run proves nothing, so it writes no artifact for a reader to mistake for a run
    if (!dryRun) {
      mkdirSync(dirname(artifactPath), { recursive: true });
      writeFileSync(artifactPath, `${JSON.stringify(record, null, 2)}\n`);
    }
    return { status: record.status, exitCode: record.exitCode, reason: record.reason, blocker: record.blocker, owner: record.owner, record, artifactPath };
  };

  // 1. the start gate (a failed start is a FAIL, a blocked start is BLOCKED)
  const gate = startGate(readStartStatus(runDir));
  if (gate.gate !== "proceed") {
    return finish(
      gate.gate === "blocked"
        ? { status: "BLOCKED", reason: gate.reason, blocker: gate.reason, owner: BLOCKED_OWNER }
        : { status: "FAIL", reason: gate.reason },
    );
  }
  if (!portsText) return finish({ status: "FAIL", reason: `no ports.env in ${runDir} (run scripts/office/g5g6g7/harness/start.sh first)` });
  const apiOrigin = portsEnv.API_ORIGIN;
  if (!apiOrigin) return finish({ status: "FAIL", reason: `API_ORIGIN missing from ${paths.envFile}` });

  const plan = {
    mode: dryRun ? "dry-run" : "run",
    row,
    fixture,
    kind: record.kind,
    apiOrigin,
    webOrigin: portsEnv.WEB_ORIGIN ?? "",
    appStarted: Boolean(portsEnv.UNIWORK_USER_DATA && portsEnv.ELECTRON_BIN && portsEnv.SHELL_APP_DIR),
    plannedSteps: [...ROW_REQUIRED_STEPS[row]],
  };
  if (dryRun) {
    record.plan = plan;
    record.details.plan = plan;
    return {
      ...finish({ status: "PASS", reason: `dry-run: ${ROW_REQUIRED_STEPS[row].length} step(s) planned on the stack of ${runDir}` }),
      plan,
    };
  }

  const now = Date.now;
  let currentStep = "";
  let app = null;
  let web = null;
  let seeded = null;
  const stepTimeout = resolveAppStepTimeoutMs(stepTimeoutMs, portsEnv);
  const bound = resolveLoopTimeoutMs(rowTimeoutMs, portsEnv);

  /** Runs one step and records it; a thrown error is a FAIL with its reason. */
  const step = async (name, source, fn) => {
    currentStep = name;
    const began = now();
    let result;
    try {
      const out = await fn();
      result = { status: "PASS", ...(out && typeof out === "object" ? out : {}) };
    } catch (err) {
      if (err?.isAppStepTimeout) {
        result = { status: "FAIL", reason: err.message, details: { appStepTimeout: err.appStepTimeout } };
      } else if (err?.webUnavailable) {
        result = { status: err.webUnavailable.status, blocker: err.webUnavailable.reason, reason: err.webUnavailable.reason, owner: err.webUnavailable.owner };
      } else {
        result = { status: "FAIL", reason: err instanceof Error ? err.message : String(err) };
      }
    }
    for (const key of ["reason", "blocker", "note"]) if (result[key] !== undefined) result[key] = safe(result[key]);
    record.steps[name] = { source, ...result, elapsedMs: now() - began };
    currentStep = "";
    return record.steps[name];
  };
  const stop = (name) => {
    const s = record.steps[name];
    return s.status !== "PASS";
  };

  const runChain = async () => {
    // --- seed one document for this fixture --------------------------------
    const seed = await step("seed", "protocol", async () => {
      seeded = await seedFixtureDocument({ apiOrigin, runDir, fetchImpl, fixtureId: fixture, repoRoot });
      const fixtureFile = loadVerifiedFixture(fixture, repoRoot);
      record.details.documentId = seeded.documentId;
      record.details.workspaceId = seeded.workspaceId;
      record.details.filename = seeded.filename;
      record.details.v1Sha256 = fixtureFile.sha256;
      record.versionIds.v1 = `fixture-${fixtureFile.sha256.slice(0, 12)}`;
      record.versionCounts.v1 = 1;
      return { sha256: fixtureFile.sha256, documentId: seeded.documentId };
    });
    if (stop("seed")) return;
    const { token, email, password, userId, organizationSlug, workspaceSlug, documentId } = seeded;
    const kind = FIXTURE_KIND[fixture];
    const user = { key: "cross-host-seeded", id: userId, email, password, token };
    const wc0 = () => app?.workingCopy?.() ?? null;

    // --- 1. web edit + Save (G7-A01.1 / G5-A03.1 source) --------------------
    const webOpen = await step("web-open", "web", async () => {
      web = await webFactory({
        webOrigin: portsEnv.WEB_ORIGIN ?? "",
        apiOrigin,
        runDir,
        repoRoot,
        portsEnv,
        fetchImpl,
        documentId,
        kind,
        orgSlug: organizationSlug,
        wsSlug: workspaceSlug,
        user,
        token,
        stepTimeoutMs: stepTimeout,
        pollMs,
      });
      const opened = await web.open();
      if (!opened?.opened) {
        return { status: opened?.status === "blocked" ? "BLOCKED" : "FAIL", blocker: opened?.blocker ?? "", reason: opened?.reason ?? "the web page did not open" };
      }
      return { where: portsEnv.WEB_ORIGIN };
    });
    if (stop("web-open")) return;

    const webSave1 = await step("web-save-1", "web", async () => {
      const saved = await web.editAndSave({ marker: `web-1-${Date.now().toString(36)}` });
      if (!saved.saved) {
        return saved.drivable === false
          ? { status: "BLOCKED", blocker: saved.reason, owner: BLOCKED_OWNER }
          : { status: "FAIL", reason: saved.reason ?? "the web frame did not save the edit" };
      }
      const head = await readFrameHeadViaProtocol({ apiOrigin, fetchImpl, documentId, token, withBytes: true });
      if (head.version !== 2 || head.versionId !== saved.versionId || head.sha256 !== head.checksum) {
        return {
          status: "FAIL",
          reason: `the web Save did not land as version 2 of the same bytes (version=${head.version}, id=${head.versionId}, saved=${saved.versionId})`,
        };
      }
      record.versionIds.v2 = head.versionId;
      record.versionCounts.afterWebSave1 = head.version;
      record.checksums.webAfterWebSave1 = head.sha256;
      record.details.webSaveAt = now();
      record.userSaves.push({ version: head.version, versionId: head.versionId, checksum: head.checksum, source: "web" });
      hooks?.afterWebSave?.({ version: head.version, versionId: head.versionId, revision: head.revision, checksum: head.checksum, source: "web" });
      return { versionId: head.versionId, version: head.version, checksum: head.checksum, dirtyObserved: saved.dirtyObserved ?? null };
    });
    if (stop("web-save-1")) return;

    // --- 2. open in the app from web (deep link) ----------------------------
    const appOpen = await step("app-open", "app", async () => {
      app = await appFactory({
        portsEnv,
        runDir,
        apiOrigin,
        fetchImpl,
        repoRoot,
        user,
        documentId,
        kind,
        stepTimeoutMs: stepTimeout,
        pollMs,
        deepLinkDeliverer,
      });
      if (!app?.signedIn) {
        return {
          status: app?.blockerReason ? "BLOCKED" : "FAIL",
          blocker: app?.blockerReason ?? "",
          reason: app?.signInFailureReason ?? "the app could not be driven",
        };
      }
      // the web page's own "Open in app" call mints the launch ticket for this document
      const launchRes = await callTracerApi({
        apiOrigin,
        fetchImpl,
        name: "mintLaunch",
        params: { documentID: documentId },
        token,
        body: { operation: "edit", deployment_id: HARNESS_DEPLOYMENT_ID, client_id: DEV_CLIENT_ID, return_hint: "" },
      });
      const ticket = launchRes.data?.ticket ?? launchRes.data?.launch_ticket ?? "";
      if (!ticket) return { status: "FAIL", reason: "mintLaunch returned no ticket for the fixture document" };
      const opened = await app.openDocument({ documentId, launchUrl: officeDeepLink(DEV_CLIENT_ID, ticket) });
      if (!opened?.opened) {
        return opened?.drivable === false
          ? { status: "BLOCKED", blocker: opened.reason, owner: BLOCKED_OWNER }
          : { status: "FAIL", reason: opened?.reason ?? "the app did not open the document" };
      }
      const wc = wc0();
      const problems = [];
      if (Number(wc?.binding?.baseVersion ?? 0) !== 2) problems.push(`the app bound v${wc?.binding?.baseVersion ?? "none"}, want v2`);
      if (wc?.binding?.baseVersionId !== record.versionIds.v2) problems.push(`the app bound version id ${wc?.binding?.baseVersionId ?? "none"}, want ${record.versionIds.v2}`);
      if (wc?.binding?.baseChecksum !== record.checksums.webAfterWebSave1) problems.push("the app bound a different checksum than the web Save committed");
      if (wc?.sha256 !== record.checksums.webAfterWebSave1) problems.push(`the working copy sha256 ${wc?.sha256 ?? "none"} != server checksum ${record.checksums.webAfterWebSave1}`);
      if (problems.length > 0) return { status: "FAIL", reason: problems.join("; ") };
      record.details.appPath = opened.path;
      return { versionId: wc.binding.baseVersionId, version: wc.binding.baseVersion, checksum: wc.binding.baseChecksum };
    });
    if (stop("app-open")) return;

    // --- 3. the app is dirty, a web Save lands (G5-A03.3) -------------------
    const appDirty = await step("app-dirty", "app-ui", async () => {
      const dirty = await app.makeDirty({ path: record.details.appPath, documentId });
      if (!dirty?.edited) {
        return { status: "BLOCKED", blocker: dirty?.reason ?? "the app document could not be made dirty through CDP", owner: BLOCKED_OWNER };
      }
      if (dirty.source !== "app-ui") {
        return { status: "FAIL", reason: "the dirty edit was not driven through the app's own editor (CDP)" };
      }
      const wc = wc0();
      record.details.dirtyEdit = { source: dirty.source, plan: dirty.plan ?? "" };
      record.details.dirtyEditSha = wc?.sha256 ?? "";
      return { source: dirty.source, plan: dirty.plan ?? "", workingCopySha256: wc?.sha256 ?? "" };
    });
    if (stop("app-dirty")) return;

    const webSave2 = await step("web-save-2", "web", async () => {
      const saved = await web.editAndSave({ marker: `web-2-${Date.now().toString(36)}` });
      if (!saved.saved) {
        return saved.drivable === false
          ? { status: "BLOCKED", blocker: saved.reason, owner: BLOCKED_OWNER }
          : { status: "FAIL", reason: saved.reason ?? "the second web Save did not happen" };
      }
      const head = await readFrameHeadViaProtocol({ apiOrigin, fetchImpl, documentId, token, withBytes: true });
      if (head.version !== 3 || head.versionId !== saved.versionId) {
        return { status: "FAIL", reason: `the second web Save did not land as version 3 (version=${head.version}, id=${head.versionId})` };
      }
      record.versionIds.v3 = head.versionId;
      record.versionCounts.afterWebSave2 = head.version;
      record.checksums.webAfterWebSave2 = head.sha256;
      record.details.webSaveAt = now();
      record.userSaves.push({ version: head.version, versionId: head.versionId, checksum: head.checksum, source: "web" });
      hooks?.afterWebSave?.({ version: head.version, versionId: head.versionId, revision: head.revision, checksum: head.checksum, source: "web" });
      return { versionId: head.versionId, version: head.version };
    });
    if (stop("web-save-2")) return;

    const dirtyKept = await step("dirty-kept", "app", async () => {
      await app.nudgeSync?.();
      const noticed = await pollUntil(async () => app.remoteNewerBar({ version: 3 }), (r) => r?.visible === true, {
        boundMs: stepTimeout,
        intervalMs: pollMs,
      });
      const wc = wc0();
      const problems = [];
      if (wc?.sha256 !== record.details.dirtyEditSha) {
        problems.push(`the app replaced its local bytes (working copy ${wc?.sha256 ?? "none"} != ${record.details.dirtyEditSha})`);
      }
      if (Number(wc?.binding?.baseVersion ?? 0) !== 2) {
        problems.push(`the app reloaded the incoming version (binding v${wc?.binding?.baseVersion ?? "none"})`);
      }
      if (noticed.value?.visible !== true) {
        problems.push(`the S6 new-version bar was not visible: ${noticed.value?.reason ?? "no probe answer"}`);
      }
      if (problems.length > 0) return { status: "FAIL", reason: problems.join("; ") };
      record.details.remoteNewerBar = noticed.value;
      return { bar: noticed.value, workingCopySha256: wc.sha256 };
    });
    if (stop("dirty-kept")) return;

    // --- discard/reload the dirty edit to continue --------------------------
    const appReload = await step("app-reload", "app-ui", async () => {
      const clicked = await app.clickReload();
      if (!clicked?.clicked) {
        return { status: "BLOCKED", blocker: `the S6 reload action could not be driven: ${clicked?.reason ?? "unknown"}`, owner: BLOCKED_OWNER };
      }
      const settled = await pollUntil(async () => app.workingCopy(), (wc) => Number(wc?.binding?.baseVersion) === 3 && wc.sha256 === record.checksums.webAfterWebSave2, {
        boundMs: stepTimeout,
        intervalMs: pollMs,
      });
      if (!settled.ok) {
        const wc = settled.value ?? {};
        return {
          status: "FAIL",
          reason: `the app did not settle on v3 after the reload (binding v${wc.binding?.baseVersion ?? "none"}, working copy ${wc.sha256 ?? "none"})`,
        };
      }
      return { versionId: settled.value.binding.baseVersionId, version: 3 };
    });
    if (stop("app-reload")) return;

    // --- 4. desktop offline edit + Save (G7-A01.3) --------------------------
    const offlineSave = await step("app-offline-save", "app-ui", async () => {
      await app.cutLink();
      const dirty = await app.makeDirty({ path: record.details.appPath, documentId });
      const uiEdit = Boolean(dirty?.edited && dirty.source === "app-ui");
      const standIn = uiEdit
        ? null
        : kind === "sheets"
          ? buildXlsxRevenueWithXyzBytes(repoRoot).bytes
          : buildEditedDocxFixtureBytes(repoRoot).v2Bytes;
      if (!uiEdit) {
        record.notes.push(
          `the offline Save's edit was written by the harness as the format's deterministic stand-in (a working-copy write), not typed in the editor: ${dirty?.reason ?? "the editor plan did not run"} — this is not a UI edit`,
        );
      }
      const saved = await app.save({ path: record.details.appPath, offline: true, standInBytes: standIn });
      if (saved?.reason) return { status: "FAIL", reason: saved.reason };
      const versions = await listVersions({ apiOrigin, fetchImpl, documentId, token });
      const intents = app.intents();
      const wc = app.workingCopy();
      const problems = [];
      if (versions !== 3) problems.push(`the server created a version while the app was offline (${versions})`);
      if (intents.length === 0 && !["offline", "paused_offline"].includes(String(wc?.binding?.state))) {
        problems.push("the app held no save intent and no offline state for the offline Save");
      }
      if (Number(wc?.binding?.baseVersion ?? 0) !== 3) problems.push(`the offline Save moved the app base (v${wc?.binding?.baseVersion ?? "none"})`);
      if (problems.length > 0) return { status: "FAIL", reason: problems.join("; ") };
      record.versionCounts.whileCut = versions;
      record.details.offlineEdit = { source: uiEdit ? "app-ui" : "harness-working-copy-write", plan: dirty?.plan ?? "" };
      return { editSource: uiEdit ? "app-ui" : "harness-working-copy-write", intentFiles: intents.length, versionsWhileCut: versions };
    });
    if (stop("app-offline-save")) return;

    // --- 5. reconnect -> commit -> the web sees the version ------------------
    const reconnect = await step("app-reconnect", "app", async () => {
      await app.restoreLink();
      await app.nudgeSync?.();
      await app.save({ path: record.details.appPath, offline: false });
      const settled = await pollUntil(
        async () => app.workingCopy(),
        (wc) => wc?.binding?.state === "saved" && Number(wc?.binding?.baseVersion) === 4 && wc.sha256 === wc.binding?.baseChecksum,
        { boundMs: stepTimeout, intervalMs: pollMs },
      );
      if (!settled.ok) {
        const wc = settled.value ?? {};
        return {
          status: "FAIL",
          reason: `the app did not settle on a saved v4 receipt after reconnect (state=${wc.binding?.state ?? "none"}, baseVersion=${wc.binding?.baseVersion ?? "none"}, intents=${app.intents().length})`,
        };
      }
      const versions = await listVersions({ apiOrigin, fetchImpl, documentId, token });
      if (versions !== 4) return { status: "FAIL", reason: `expected 4 server versions after the reconnect commit, got ${versions}` };
      const head = await readFrameHeadViaProtocol({ apiOrigin, fetchImpl, documentId, token });
      if (head.versionId !== settled.value.binding.baseVersionId || head.checksum !== settled.value.sha256) {
        return { status: "FAIL", reason: "the app's committed version does not match the server head the web would load" };
      }
      record.versionIds.v4 = head.versionId;
      record.versionCounts.afterReconnect = head.version;
      record.checksums.desktopAfterReconnect = head.checksum;
      record.userSaves.push({ version: head.version, versionId: head.versionId, checksum: head.checksum, source: "app" });
      hooks?.afterAppCommit?.({ version: head.version, versionId: head.versionId, revision: head.revision, checksum: head.checksum, source: "app" });
      return { versionId: head.versionId, version: head.version, checksum: head.checksum, intentsRemaining: app.intents().length };
    });
    if (stop("app-reconnect")) return;

    const webSees = await step("web-sees", "web", async () => {
      const since = (record.details.webSaveAt ?? 0) - 1;
      const announced = await pollUntil(
        async () => web.announcements({ sinceMs: Math.max(0, since) }),
        (list) => Array.isArray(list) && list.some((m) => m.versionId === record.versionIds.v4),
        { boundMs: stepTimeout, intervalMs: pollMs },
      );
      const match = (announced.value ?? []).find((m) => m.versionId === record.versionIds.v4) ?? null;
      if (!match) {
        return {
          status: "FAIL",
          reason: `the web host announced no doc.remoteVersion for ${record.versionIds.v4} within ${stepTimeout} ms (the web S6 path is off without office_sync_feed; nothing was captured)`,
        };
      }
      const reload = await web.waitForReload({ versionId: record.versionIds.v4, timeoutMs: stepTimeout });
      if (!reload?.reloaded) {
        return { status: "FAIL", reason: `the web frame did not reload the announced version: ${reload?.reason ?? "no reload"}` };
      }
      const head = await web.fetchHeadViaFrameRoute();
      if (head.sha256 !== record.checksums.desktopAfterReconnect || head.versionId !== record.versionIds.v4) {
        return {
          status: "FAIL",
          reason: `the web content checksum is not the desktop's committed checksum (web ${head.sha256} v${head.versionId}, desktop ${record.checksums.desktopAfterReconnect} v${record.versionIds.v4})`,
        };
      }
      record.checksums.webContent = head.sha256;
      record.details.webSees = { announced: match, reload: { versionId: reload.versionId, version: reload.version }, webContentSha256: head.sha256 };
      return { versionId: reload.versionId, announcedVersionId: match.versionId, webContentSha256: head.sha256 };
    });
    if (stop("web-sees")) return;

    // --- 6. AI turn + Save (G7-A01.5, G7-A01 only) ---------------------------
    if (row === "G7-A01") {
      const aiTurn = await step("ai-turn", "protocol", async () => {
        const before = await listVersions({ apiOrigin, fetchImpl, documentId, token });
        const docBefore = await callTracerApi({ apiOrigin, fetchImpl, name: "getDocument", params: { documentID: documentId }, token });
        const revisionBefore = docBefore.data?.document?.revision;
        const prompt =
          kind === "sheets"
            ? "Tính cột X (Tổng Q1+Q2), Y (Chênh lệch Q2-Q1), Z (Tỷ lệ tăng trưởng Y/Q1) cho bảng Doanh thu."
            : "Bổ sung mục 3 Kết luận cho Báo cáo tiến độ quý III bằng tiếng Việt.";
        const aiRes = await callTracerApi({
          apiOrigin,
          fetchImpl,
          name: "aiUniworkDocumentChatCompletions",
          params: { documentID: documentId },
          token,
          body: { messages: [{ role: "user", content: prompt }] },
          allowStatuses: [403, 503],
        });
        const after = await listVersions({ apiOrigin, fetchImpl, documentId, token });
        const docAfter = await callTracerApi({ apiOrigin, fetchImpl, name: "getDocument", params: { documentID: documentId }, token });
        const revisionAfter = docAfter.data?.document?.revision;
        record.aiTurns.push({ versionsBefore: before, versionsAfter: after, httpStatus: aiRes.status, at: now() });
        record.versionCounts.afterAiTurn = after;
        if (after !== before || revisionAfter !== revisionBefore) {
          return {
            status: "FAIL",
            reason: `G6-A03 violation: the AI turn created a server version or moved the revision (${before} -> ${after}, revision ${revisionBefore} -> ${revisionAfter})`,
          };
        }
        const segment = classifyAiResponse(aiRes, null, {
          allowRealUpstream: Boolean(fetchImpl?.allowRealAiUpstream || env.HARNESS_ALLOW_REAL_AI_UPSTREAM === "1"),
        });
        record.details.aiSegment = segment;
        if (segment.status !== "PASS") {
          return {
            status: "BLOCKED",
            blocker: REAL_AI_BLOCKER,
            owner: BLOCKED_OWNER,
            details: { aiSegment: segment, versionsBefore: before, versionsAfter: after },
          };
        }
        return { httpStatus: aiRes.status, provider: aiRes.data?.provider ?? "", versionsBefore: before, versionsAfter: after };
      });
      // A BLOCKED AI turn (fake provider) still drives the Save after it: the
      // deterministic mechanics (0 versions on the turn, 1 on the Save) are what
      // the row records, while the AI segment itself can never close the row
      // (acceptance.md l.87). Only a FAILed turn stops the chain.
      if (aiTurn.status === "FAIL") return;

      const aiSave = await step("ai-save", "app", async () => {
        const standIn = kind === "sheets" ? buildXlsxRevenueWithXyzBytes(repoRoot).bytes : buildEditedDocxFixtureBytes(repoRoot).v2Bytes;
        record.notes.push(
          "the AI turn is a document-route protocol call (contract-p0 A10); the Save after it stores the format's deterministic stand-in bytes for the AI edit — the fork's AI-panel wiring is not driven by this harness",
        );
        const saved = await app.save({ path: record.details.appPath, offline: false, standInBytes: standIn });
        if (saved?.reason) return { status: "FAIL", reason: saved.reason };
        const head = await readFrameHeadViaProtocol({ apiOrigin, fetchImpl, documentId, token });
        const wc = app.workingCopy();
        if (head.version !== 5 || Number(wc?.binding?.baseVersion) !== 5 || wc.sha256 !== head.checksum) {
          return {
            status: "FAIL",
            reason: `the Save after the AI turn did not create exactly one version (server v${head.version}, app v${wc?.binding?.baseVersion ?? "none"})`,
          };
        }
        record.versionIds.v5 = head.versionId;
        record.versionCounts.afterAiSave = head.version;
        record.userSaves.push({ version: head.version, versionId: head.versionId, checksum: head.checksum, source: "app" });
        return { versionId: head.versionId, version: head.version, checksum: head.checksum };
      });
      if (stop("ai-save")) return;
    }

    // --- 7. both hosts on the same result (G7-A01.6 / G5-A03.2) -------------
    await step("final-shas", "protocol", async () => {
      const head = await readFrameHeadViaProtocol({ apiOrigin, fetchImpl, documentId, token, withBytes: true });
      const wc = app.workingCopy();
      const webHead = await web.fetchHeadViaFrameRoute();
      const versions = await listVersions({ apiOrigin, fetchImpl, documentId, token });
      // the three checksums the row asserts on, beside the per-step ones already recorded
      record.checksums = {
        ...record.checksums,
        server: head.checksum,
        webContent: webHead.sha256,
        desktopWorkingCopy: wc?.sha256 ?? "",
      };
      record.versionCounts.final = versions;
      const problems = [];
      if (head.sha256 !== head.checksum) problems.push("the server's own content bytes do not match its checksum");
      if (wc?.sha256 !== head.checksum) problems.push(`the desktop working copy sha256 ${wc?.sha256 ?? "none"} != the server checksum ${head.checksum}`);
      if (webHead.sha256 !== head.checksum || webHead.versionId !== head.versionId) {
        problems.push(`the web content (${webHead.sha256} v${webHead.versionId}) != the server head (${head.checksum} v${head.versionId})`);
      }
      if (wc?.binding?.baseChecksum !== head.checksum) problems.push("the app binding's checksum is not the server head checksum");
      const expectedFinal = 1 + record.userSaves.length;
      if (versions !== expectedFinal) problems.push(`the version tally ${versions} != 1 seeded + ${record.userSaves.length} user Save(s)`);
      if (problems.length > 0) return { status: "FAIL", reason: problems.join("; ") };
      return { serverSha256: head.sha256, webSha256: webHead.sha256, desktopSha256: wc.sha256, versions };
    });
  };

  let timer = null;
  let watchdog = null;
  try {
    watchdog = new Promise((resolveWatchdog) => {
      timer = setTimeout(() => {
        const active = currentStep || "chain";
        record.steps[active] = {
          ...(record.steps[active] ?? { source: "protocol" }),
          status: "FAIL",
          reason: "row watchdog",
        };
        resolveWatchdog({ watchdog: true });
      }, bound);
    });
    await Promise.race([runChain().then(() => ({ done: true })), watchdog]);
  } catch (err) {
    if (err?.isAppStepTimeout) {
      record.steps[currentStep || "chain"] = {
        source: "app",
        status: "FAIL",
        reason: safe(err.message),
        details: { appStepTimeout: err.appStepTimeout },
      };
    } else {
      record.steps[currentStep || "chain"] = { source: "protocol", status: "FAIL", reason: safe(err instanceof Error ? err.message : String(err)) };
    }
  } finally {
    if (timer !== null) clearTimeout(timer);
    if (app?.close) await Promise.resolve(app.close()).catch(() => {});
    if (web?.close) await Promise.resolve(web.close()).catch(() => {});
    setAppApiProxyOnline(runDir, true);
    if (seeded) await cleanupSeededOrganization({ apiOrigin, fetchImpl, seeded, runDir }).catch(() => {});
  }
  const decision = decideCrossHostOutcome(record);
  return finish(decision);
}

/** `<runDir>/reports/g7-qa/<row lower-case>/<fixture>.json`, truncated at the start of every run. */
export function crossHostArtifactPath(runDir, row, fixture) {
  if (!ROW_IDS.includes(String(row))) throw new Error(`row must be one of ${ROW_IDS.join(", ")}, got ${row}`);
  if (!FIXTURE_IDS.includes(String(fixture))) throw new Error(`fixture must be a fixture id, got ${fixture}`);
  return join(runDir, "reports", "g7-qa", String(row).toLowerCase(), `${fixture}.json`);
}

// ---- CLI -----------------------------------------------------------------------------------

function printUsage(stream = console.error) {
  stream.write(
    `usage: cross-host.mjs --row ${ROW_IDS.join("|")} [--fixture ${FIXTURE_IDS.join("|")}|all] [--run-dir <dir>] [--timeout-ms <ms>] [--dry-run]\n`,
  );
}

/**
 * The CLI: one invocation per (row, fixture) — the unit evidence.mjs records.
 * `--fixture all` runs both fixtures and exits with the worst outcome (FAIL >
 * BLOCKED > PASS); it is refused under the evidence runner, which records one
 * fixture per line.
 */
export async function main(argv = process.argv.slice(2), env = process.env) {
  const startedAt = new Date().toISOString();
  let args;
  try {
    args = parseCrossHostArgs(argv, env);
  } catch (err) {
    console.error(`cross-host.mjs: ${err.message}`);
    printUsage();
    return 2;
  }
  const fixtures = args.fixture === "all" ? [...FIXTURE_IDS] : [args.fixture];
  const results = [];
  for (const fixture of fixtures) {
    const artifactPath = crossHostArtifactPath(args.runDir, args.row, fixture);
    rmSync(artifactPath, { force: true });
    const result = await runCrossHostRow({ ...args, fixture, env });
    results.push(result);
    console.log(JSON.stringify(result.record, null, 2));
    if (!args.dryRun) {
      console.log(`${args.row} ${fixture} ${result.status}${result.reason ? `: ${result.reason}` : ""} (${result.artifactPath})`);
    } else {
      console.log(`${args.row} ${fixture} dry-run ${result.status}${result.reason ? `: ${result.reason}` : ""}`);
    }
    if (!args.dryRun && !env.OFFICE_EVIDENCE_ID) {
      const command = `node scripts/office/g5g6g7/g7-04/cross-host.mjs --row ${args.row} --fixture ${fixture} --run-dir ${args.runDir}`;
      const paths = harnessPaths(args.runDir);
      const line = evidenceLine({
        evidenceId: harnessEvidenceId(args.row),
        ...(await ledgerIdentity(env)),
        requirementId: args.row,
        fixtureId: fixture,
        fixtureSha256: await fixtureSha256Of(fixture),
        fSha: env.OFFICE_FORK_SHA || result.record.forkSha || "",
        platform: `${process.platform}-${process.arch}`,
        build: `node ${process.versions.node}`,
        command,
        argv: [...process.argv],
        exitCode: result.exitCode,
        result: result.status,
        artifact: result.artifactPath,
        checker: "harness:g7-04/cross-host.mjs",
        blocker: result.status === "BLOCKED" ? result.blocker : "",
        startedAt,
        finishedAt: new Date().toISOString(),
      });
      mkdirSync(paths.runDir, { recursive: true });
      appendFileSync(paths.evidenceFile, `${JSON.stringify(line)}\n`);
    }
    if (!args.dryRun) {
      if (result.status === "BLOCKED") console.error(`BLOCKED: ${result.blocker || result.reason}`);
      else if (result.status !== "PASS") console.error(`FAILED: ${result.reason}`);
    }
  }
  if (results.length === 0) return 2;
  if (results.some((r) => r.status === "FAIL")) return 1;
  if (results.some((r) => r.status === "BLOCKED")) return BLOCKED_EXIT;
  return 0;
}

// The start gate's own evidence line (a step that never ran): the harness
// convention (`concludeAtStartGate`), kept out of `main` so a dry run never
// writes a ledger line.
export async function concludeAtGate({ runDir, row, fixture, argv, env = process.env }) {
  const gate = startGate(readStartStatus(runDir));
  if (gate.gate === "proceed") return null;
  const command = `node scripts/office/g5g6g7/g7-04/cross-host.mjs --row ${row} --fixture ${fixture} --run-dir ${runDir}`;
  const exitCode = await concludeAtStartGate(gate, {
    runDir,
    requirementId: row,
    fixtureId: fixture,
    command,
    checker: "harness:g7-04/cross-host.mjs",
    startedAt: new Date().toISOString(),
    argv: argv ?? [...process.argv],
  });
  return { exitCode, gate };
}

/**
 * The CLI's exit: the code is set and the loop is left to drain (the harness's
 * HTTP keep-alive sockets close on their own). A hard `process.exit` while a
 * socket is mid-close trips a libuv assertion on Windows; the 1 s unref'd guard
 * below still bounds a leaked handle, so a runner can never hang on one.
 */
function finishProcess(code) {
  process.exitCode = code;
  setTimeout(() => process.exit(code), 1_000).unref();
}

if (isMainModule({ moduleUrl: import.meta.url })) {
  main()
    .then((code) => finishProcess(code))
    .catch((err) => {
      console.error(`cross-host.mjs: ${err.message}`);
      finishProcess(1);
    });
}
