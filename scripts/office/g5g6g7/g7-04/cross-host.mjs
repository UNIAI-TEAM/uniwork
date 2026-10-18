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
//   * The dirty editor is driven through the app's own editor (CDP) in the
//     G5-A03 chain only; when that cannot be driven the row is BLOCKED, never
//     PASS.
//   * Reuse, not copies (BE-704-05): the harness drivers (`harness/web.mjs`,
//     `harness/app.mjs`, `harness/app-steps.mjs`, `harness/lib.mjs`), the tracer
//     helpers (`g7-10/tracer.mjs`) and the G8-19 desktop helpers
//     (`g8-19/anchors.mjs`: the `runEditPlan` editor-action driver and its
//     `EDIT_DRIVERS` plans) are imported; the driver's only redactor is
//     `redactSignInError` from `harness/app-steps.mjs`. What stays local is the
//     plan NAMES the record prints (`DIRTY_EDIT_PLANS`: insert-row /
//     split-block) and this driver's own record fields. The CLI writes exactly
//     one artifact per (row, fixture) plus the evidence line `evidence.mjs`
//     wraps.
//   * The dirty-editor half of the chain is G5-A03.3 ONLY (D1-04): the G7-A01
//     chain runs no `app-dirty` / `web-save-2` / `dirty-kept` / `app-reload` step.
//   * A BLOCKED step stops only the steps that consume its result (they are
//     recorded SKIPPED); a FAILed step always stops the chain and wins over
//     BLOCKED (see `STEP_DEPENDENCIES`).
//   * A BLOCKED step with no named blocker is a FAIL (BE-704-10).
//   * `uiEdits` on the record says, per edit step (dirty, offlineSave, aiSave),
//     whether the run drove that edit through the app's own editor UI (`real`)
//     or not (`standin`: a harness stand-in write, or the step did not run)
//     (BE-704-08).
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BLOCKED_EXIT,
  DEV_CLIENT_ID,
  HARNESS_DEPLOYMENT_ID,
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
  redactSignInError,
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
// The desktop editor action + the per-format structural edit plans (G8-19).
// `runEditPlan` drives `EDIT_DRIVERS`' actions through the shared `pageAction`,
// the awaited implementation the old local `appPageAction` copied (BE-704-07:
// the copy dropped the `await` on `wait(250)`, so its 40 x 250 ms retry budget
// collapsed to one microtask turn). Both are imported, never re-declared.
import { EDIT_DRIVERS, runEditPlan } from "../g8-19/anchors.mjs";

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
/**
 * How many times `dirty-kept` may run the tracer's feed-nudge recipe while it
 * waits for the S6 bar (the first nudge is immediate, the rest are spread over
 * the step bound). The app only learns about a newer version on a feed pass,
 * and one nudge can land while the proxy is still cut (D2-04).
 */
export const FEED_NUDGE_LIMIT = 4;

/**
 * How long ONE document's frame-message read may take before it is a measured
 * miss (BE-704-304). `pollUntil` only checks its elapsed bound AFTER the polled
 * function resolves, so an unbounded `frame.evaluate(readFrameMessages)` could
 * pin the row past its step bound; every read is bounded by the smaller of this
 * and the remaining step budget, and a read that expires is counted in the audit
 * the miss reason prints (`summarizeFrameRecordings` `readErrors`).
 */
export const FRAME_READ_TIMEOUT_MS = 10_000;

/**
 * What the `web-sees` waits (the announce poll and the reload wait) hold back from their step
 * budget so the miss diagnostics can still run (BE-704-502): a FAIL that cannot say what the frames
 * held is not actionable, and round 5's per-read budgets made exactly that evidence cost a second
 * and third step bound. The step keeps ONE deadline — the waits stop this much before it and the
 * diagnostics (`frameAudit`, `frameSurface`, `frameEvidence`) read on what is left, inside it. One
 * hung frame-read wave's worth, never more than half a short step bound.
 */
export const MISS_DIAGNOSTIC_RESERVE_MS = 10_000;

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
/**
 * A reason/blocker safe for an artifact: no token, ticket or credential-looking
 * run. This is `harness/app-steps.mjs` `redactSignInError` (the same function
 * `revoke.mjs`, `harness/world.mjs` and `harness/api.mjs` redact with) with the
 * driver's own 2000-char cap; the driver keeps no second copy of the rules
 * (BE-704-05).
 */
const safe = (text) => redactSignInError(text, { maxChars: REASON_MAX_CHARS });

/**
 * A long digest in a form the artifact's redactor leaves alone (BE-704-305): an unbroken 32+ char
 * run of `[A-Za-z0-9_-]` is a credential-shaped token to `redactSignInError`
 * (`SIGN_IN_ERROR_OPAQUE`), so a raw sha256 printed in a reason is recorded as `<redacted>` and
 * the measurement the reader needs is lost (cloud D4's `working copy <redacted>`). Grouped with a
 * `.` every 8 characters, every run stays short enough to survive, and the value is still the
 * full measured checksum (strip the dots to compare).
 */
function digestForReason(hex) {
  const text = String(hex ?? "");
  if (!text) return "none";
  return text.length > 8 ? text.match(/.{1,8}/g).join(".") : text;
}

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
  // G7-A01 runs NO dirty-editor step: the dirty editor belongs to G5-A03.3 only
  // (D1-04). The row is web -> app -> offline desktop save -> reconnect -> web
  // sees -> AI turn + Save -> final; a BLOCKED `app-dirty` cannot stop it
  // because it is not in this list at all.
  "G7-A01": Object.freeze([
    "seed",
    "web-open",
    "web-save-1",
    "app-open",
    "app-offline-save",
    "app-reconnect",
    "web-sees",
    "ai-turn",
    "ai-save",
    "final-shas",
  ]),
});

/**
 * Which step's RESULT each later step consumes (D1-04), written producer ->
 * consumers. A BLOCKED producer therefore skips exactly its consumers, and the
 * skip is transitive (a consumer of a skipped step is skipped too), so a BLOCKED
 * dirty step in the G5-A03 chain skips `web-save-2` (a web Save landing on a
 * dirty app proves nothing without the dirty app), `dirty-kept` (it asserts the
 * dirty bytes survived) and `app-reload` (it discards the dirty edit) while the
 * INDEPENDENT desktop half still runs: `app-offline-save` -> `app-reconnect` ->
 * `web-sees` -> `final-shas` (G5-A03.2). Skipping the whole dirty cluster is also
 * what keeps the version accounting honest: a second web Save with no reload
 * after it would leave the app bound one version behind the server, and
 * `app-offline-save` would FAIL on its `baseVersion` check instead of the row
 * ending BLOCKED (77) with the named blocker, as D1-04 requires. A FAILed step
 * is different: it always stops the chain, because a FAIL is a product
 * divergence, not a missing precondition.
 *
 * The rule in one line: a BLOCKED step stops the chain only for the steps that
 * depend on its result; a FAIL always stops it; a PASS never does.
 */
export const STEP_DEPENDENCIES = Object.freeze({
  seed: Object.freeze(["web-open", "web-save-1", "app-open"]),
  "web-open": Object.freeze(["web-save-1", "web-save-2", "web-sees"]),
  "web-save-1": Object.freeze(["app-open"]),
  "app-open": Object.freeze(["app-dirty", "app-offline-save", "app-reload", "ai-save"]),
  "app-dirty": Object.freeze(["web-save-2", "dirty-kept", "app-reload"]),
  "web-save-2": Object.freeze(["dirty-kept", "app-reload"]),
  "dirty-kept": Object.freeze([]),
  "app-reload": Object.freeze([]),
  "app-offline-save": Object.freeze(["app-reconnect"]),
  "app-reconnect": Object.freeze(["web-sees", "final-shas"]),
  "web-sees": Object.freeze(["final-shas"]),
  // `ai-turn` has NO consumer: the Save after a BLOCKED AI turn still runs (the
  // harness writes the stand-in bytes for the AI edit), so the deterministic
  // "one version per user Save, zero per AI turn" mechanics are still recorded
  // while the row can never close on a fake provider (acceptance.md l.87).
  "ai-turn": Object.freeze([]),
  "ai-save": Object.freeze(["final-shas"]),
});

/**
 * The steps of `row` a BLOCKED `step` makes unrunnable: its consumers, and the
 * consumers of those, in chain order. Empty when nothing consumes the step's
 * result, which is what makes a BLOCKED step harmless to the rest of the chain.
 */
export function dependentSteps(row, step) {
  const required = ROW_REQUIRED_STEPS[row] ?? ROW_REQUIRED_STEPS["G7-A01"];
  // consumes[Z] = the producers Z reads the result of
  const consumes = new Map(required.map((name) => [name, new Set()]));
  for (const [producer, consumers] of Object.entries(STEP_DEPENDENCIES)) {
    for (const consumer of consumers) consumes.get(consumer)?.add(producer);
  }
  const skip = new Set([step]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const name of required) {
      if (skip.has(name)) continue;
      if ([...consumes.get(name)].some((input) => skip.has(input))) {
        skip.add(name);
        grew = true;
      }
    }
  }
  skip.delete(step);
  return required.filter((name) => skip.has(name));
}

export function decideCrossHostOutcome(record = {}) {
  const steps = record.steps ?? {};
  const entries = Object.entries(steps);
  // SKIPPED (a step whose input a BLOCKED step never produced) is "did not run",
  // not a FAIL: the BLOCKED branch below owns the verdict (D1-04).
  const failing = ([, s]) => s?.status !== "PASS" && s?.status !== "BLOCKED" && s?.status !== "SKIPPED";
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
  const missing = required.filter((name) => !steps[name] || steps[name].status === "SKIPPED");
  // BE-704-10: a BLOCKED step with no named blocker cannot be attributed to an
  // owner, so it is a FAIL, not a BLOCKED (the README and acceptance.md l.87
  // require BLOCKED to carry a named blocker).
  const unattributed = blocked.filter(([, s]) => !String(s?.blocker ?? "").trim());
  if (unattributed.length > 0) {
    return {
      status: "FAIL",
      exitCode: 1,
      reason: safe(
        `BLOCKED without a named blocker: ${unattributed.map(([name]) => name).join(", ")} (a BLOCKED step must name its blocker)`,
      ),
      blocker: "",
    };
  }
  if (blocked.length > 0) {
    // every BLOCKED step here names its blocker: an unnamed one already FAILed above
    const blockers = [...new Set(blocked.map(([, s]) => s.blocker))];
    const owners = [...new Set(blocked.map(([, s]) => s?.owner || ""))].filter(Boolean);
    return {
      status: "BLOCKED",
      exitCode: BLOCKED_EXIT,
      reason: safe(blocked.map(([name, s]) => `${name}: ${s.blocker || s.reason || "no blocker"}`).join("; ")),
      blocker: safe(blockers.join("; ")),
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
 * The dirtying plans this driver records, one per fixture format, with the
 * editor's own control request shapes. The ACTIONS are the imported G8-19
 * `EDIT_DRIVERS.shift` plans (the same product commands the G8-A02 row drives),
 * so a fork UI change is applied in one place (BE-704-05); this map only NAMES
 * them for the record and pins the `req` shape against the fork control handler:
 *   * docs  - `handleDocsControl` (`apps/docs/src/renderer/control.ts:29-56`)
 *     takes `{ cmd: "goto", target: { kind: string; block?: number } }`, and a
 *     block is valid only when `0 <= block < doc.childCount`; `EDIT_DRIVERS.docx.shift`
 *     sends `goto({ kind: "block", block: 0 })`, in range for the fixture
 *     (`apps/docs/src/renderer/App.tsx` exposes `window.__genofficeControl`).
 *   * sheets - `handleSheetsControl` (`apps/sheets/src/renderer/control.ts:38-92`)
 *     takes `{ cmd: "goto", target: { kind: string; sheet?: string; range?: string } }`
 *     and splits `range` with `splitSheetRange`, so `"A7"` and
 *     `"Doanh thu Q2!A7"` are both accepted; `EDIT_DRIVERS.xlsx.shift` sends
 *     `{ kind: "range", sheet: "Doanh thu Q2", range: "A7" }` (the sheet named in
 *     `target.sheet` and the bare range in `target.range`), which resolves to the
 *     same worksheet. Both handlers answer `{ status: "not_ready" }` while the
 *     editor boots, which is why `pageAction` retries (with an awaited wait).
 */
export const DIRTY_EDIT_PLANS = Object.freeze({
  sheets: Object.freeze({ name: "insert-row", actions: EDIT_DRIVERS.xlsx.shift }),
  docs: Object.freeze({ name: "split-block", actions: EDIT_DRIVERS.docx.shift }),
});

/**
 * Drives the format's dirty-edit plan through the editor page the CDP controller
 * picked: `{ edited: true, source: "app-ui", plan }` when the editor's own
 * controls made the edit, else `{ edited: false, source: "none", reason }`.
 *
 * The plan's actions are the shared G8-19 `EDIT_DRIVERS` ones and they run
 * through the shared `runEditPlan` (anchors.mjs), so this file owns only the plan
 * NAMES (BE-704-05) and the awaited 250 ms retry budget of the editor control is
 * the shared `pageAction`'s (BE-704-07). Exported so a test can drive exactly the
 * code path the CDP controller runs.
 */
export async function makeAppDirty({ ctrl, kind, path = null, documentId = null }) {
  const plan = DIRTY_EDIT_PLANS[kind];
  let page;
  try {
    page = await ctrl.editorPage(kind, { path, documentId });
  } catch (err) {
    if (err?.isAppStepTimeout) throw err;
    return { edited: false, source: "none", reason: `no ${kind} editor page for the working copy: ${err.message}` };
  }
  let ran;
  try {
    ran = await runEditPlan(ctrl, page, plan.actions);
  } catch (err) {
    if (err?.isAppStepTimeout) throw err;
    ran = { status: "error", reason: err.message };
  }
  if (ran?.status !== "ok") {
    return { edited: false, source: "none", reason: `the ${kind} editor refused the ${plan.name} plan: ${ran?.reason ?? "no answer"}` };
  }
  return { edited: true, source: "app-ui", plan: plan.name };
}

/**
 * The fork's S6 new-version bar, page-side: the wording it renders for a DIRTY
 * document (`apps/shell/src/renderer/src/uniwork-docs-model.ts:538-552`,
 * message key `uwRemoteNewerDirty`; strings `i18n/sync/vi.ts:311-312` /
 * `en.ts:315-316`: "Có phiên bản mới hơn trên UniWork (phiên bản N). …" / "A
 * newer version is on UniWork (version N). …"), the version it names, and its
 * reload action (`uwRemoteReload`, model l.487; vi.ts:319 / en.ts:324).
 *
 * The three wordings live INSIDE the function body (D3-02). This function is
 * serialized into an app page (`page.evaluate(readRemoteNewerSurface, …)`) and
 * Playwright builds the page-side copy from the function's own source alone
 * (`new Function("return (" + fn + ")")`), so a module-scope constant is simply
 * not there. Cloud D2/D3 measured it: the round-2 fix only restored the
 * constants at module scope, so the Node path worked while every page probe threw
 * `ReferenceError: REMOTE_NEWER_TEXT is not defined` (the G5-A03 xlsx
 * `dirty-kept` row, whose FAIL then read as a product miss). Keep this function
 * self-contained: no free variables, module scope included.
 */
export function readRemoteNewerSurface({ version = null } = {}) {
  const newerText = /(phiên bản mới hơn trên UniWork|newer version (?:is )?on UniWork)/i;
  const newerVersion = /(?:phiên bản|version)\s*\(?\s*(\d+)/i;
  const newerReload = /(Tải lại bản mới nhất|Reload latest)/i;
  const seen = [];
  for (const el of document.querySelectorAll("div,section,aside,header,p,span,li")) {
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!text || text.length > 400 || !newerText.test(text)) continue;
    const named = newerVersion.exec(text);
    seen.push({ text, version: named ? Number(named[1]) : null });
  }
  const actions = [...document.querySelectorAll("button,a,[role='button']")].filter((el) =>
    newerReload.test((el.textContent ?? "").trim()),
  );
  // BE-704-303: when a version is asked for, ONLY a bar naming that version is this
  // step's bar. The old `?? seen[0]` fallback accepted any other page's bar for an
  // older version and reported the requested version as observed.
  const best = version === null ? seen[0] ?? null : seen.find((s) => s.version === version) ?? null;
  return {
    visible: best !== null && actions.length > 0,
    text: best?.text ?? "",
    version: best?.version ?? null,
    actionFound: actions.length > 0,
  };
}

/**
 * The reason `remoteNewerBar`/`clickReload` report when no page carries the bar.
 * A probe that THREW is never reported as "no new-version bar" (D2-04, D3-02): a
 * crash inside the page-side probe used to be swallowed into a plain miss, which
 * reads as a product gap (or a slow feed) instead of the harness bug it was.
 */
export function remoteNewerMissReason(version, probeErrors = []) {
  const first = (probeErrors ?? []).find(Boolean);
  if (first) return `the new-version probe could not run: ${first}`;
  return version === null ? "no new-version bar on any app page" : `no new-version bar naming version ${version} on any app page`;
}

/**
 * `remoteNewerBar`'s answer for one `findRemoteNewerPage` search: the page that
 * carries the bar, or the miss reason — which says whether the probe even ran.
 */
export function newerBarReport(found, version) {
  const { page, probe, probeErrors } = found ?? {};
  if (!page) return { visible: false, reason: remoteNewerMissReason(version, probeErrors) };
  // BE-704-303: the page's bar must name the version this step asked for. The probe
  // above already refuses a mismatched bar; this keeps the caller honest too, so a
  // page pair can never smuggle another version's bar through.
  if (version !== null && probe?.version !== version) {
    return { visible: false, reason: remoteNewerMissReason(version, probeErrors) };
  }
  return { visible: true, version: probe.version, text: probe.text, where: editorKindOfUrl(page.url()) ?? "shell" };
}

// ---- small polling helper ------------------------------------------------------------------

/**
 * Poll `fn` until `pred` accepts its value, or `boundMs` elapses. `fn` is called with the poll's
 * own DEADLINE (`started + boundMs`, an absolute timestamp) so a poll whose work is itself bounded
 * — every frame read in `frameReports`, BE-704-405 — uses what is LEFT of this poll's budget
 * instead of a fresh one; a caller that ignores the argument is unaffected.
 */
async function pollUntil(fn, pred, { boundMs = DEFAULT_STEP_TIMEOUT_MS, intervalMs = DEFAULT_POLL_MS, sleepFn = sleep, now = Date.now } = {}) {
  const started = now();
  const deadlineMs = started + boundMs;
  let value;
  for (;;) {
    value = await fn(deadlineMs);
    if (pred(value)) return { value, ok: true, elapsedMs: now() - started };
    if (now() - started >= boundMs) return { value, ok: false, elapsedMs: now() - started };
    await sleepFn(Math.min(intervalMs, Math.max(1, boundMs - (now() - started))));
  }
}

// ---- the app's own receipt for a Save (D2-01) -----------------------------------------------

/**
 * The binding states that mean the app parked the Save instead of sending it:
 * `offline` and `paused_offline`, both accepted binding states
 * (`apps/shell/src/main/uniwork-docs/binding-store.ts:197-217`) and what the
 * save coordinator writes for an offline verdict
 * (`apps/shell/src/main/uniwork-docs/save-coordinator.ts:483-491` — verdict
 * `offline` -> intent state `paused_offline` — committed to the binding at
 * l.518).
 */
export const OFFLINE_SAVE_STATES = Object.freeze(["offline", "paused_offline"]);

/**
 * The name the fork's durable store gives THIS document's intent record (BE-704-404). The store
 * names a record after the hash of its key — `recordFileName(key) = sha256(key) + ".rec"`
 * (`apps/shell/src/main/uniwork-sync/store/paths.ts:13-15`, used by `layer.ts`
 * `recordPath(root, scope, store, key)` — `uniwork-sync/store/layer.ts`) — and the intent key IS
 * the document key: the coordinator writes `intents.put(doc.key, …)`
 * (`uniwork-docs/save-coordinator.ts:492`, the same key at l.688) and `doc.key` is the
 * working-copy folder segment (`uniwork-docs/binding-store.ts:88-91`, `lookup` at l.335-345),
 * which the docs service builds with the DOCUMENT ID itself
 * (`uniwork-docs/service.ts:1456-1461` `boundDocFor` -> `dirFor(identity.deploymentId,
 * identity.accountId, documentId)`, and the same call for the open paths at l.3493/l.3571).
 *
 * The record's own META carries `documentId` too (`uniwork-sync/queue/record.ts:52-75`
 * `IntentRecordV2.documentId`, and the v1 `PendingIntentRecord`), but the record is sealed
 * AES-256-GCM on disk — `store/codec.ts` writes `UWS1` + a plaintext header + IV + tag +
 * ciphertext, and the key is wrapped by Electron safeStorage (`uniwork-docs/wiring.ts`
 * `createSyncStoreLayer`) — so the driver cannot read that field without the account's store key.
 * The FILE NAME is therefore the document identity the harness can read, and it is the fork's own
 * derivation, not a guess; the binding state beside this document's working copy is the other,
 * per-document half of the receipt. A same-document re-Save OVERWRITES the same record name, which
 * is why the step also accepts this document's own offline / paused_offline binding state.
 */
export function appIntentRecordName(documentId) {
  const id = documentId === null || documentId === undefined ? "" : String(documentId);
  return id ? `${sha256Hex(id)}.rec` : "";
}

/**
 * One read of the app's own receipt for a Save (D2-01): the `.rec` intent files
 * its durable store holds (the `listAppSyncIntentFiles` location —
 * `<userData>/uniwork-sync/store/<deploymentId>/<accountId>/intents`, the layer
 * root `apps/shell/src/main/uniwork-docs/wiring.ts:336-347` builds and the
 * `intents` registration names, `uniwork-sync/store/paths.ts` +
 * `uniwork-sync/intent-store.ts`) plus the binding snapshot beside the working
 * copy.
 *
 * The fork writes BOTH asynchronously after `aiOffice.uniworkSave` resolves:
 * the service asks the module to write and returns at once
 * (`uniwork-docs/service.ts:3642`; `uniwork-docs/module-save.ts:56/l.60` only
 * sends `menu:command save`), and the module's own Save is what calls
 * `onUserSave` (`service.ts:2936-2965`) -> the coordinator mints the intent and
 * parks the binding (`save-coordinator.ts:477-518`). A single read right after
 * the Save can therefore still be empty — exactly how D2-01 failed all four
 * rows in 986-1521 ms — so a step polls this instead.
 */
export function readAppSaveReceipt(app, baseline = null, { documentId = null } = {}) {
  const workingCopy = app.workingCopy();
  const intentFiles = app.intents();
  const names = Array.isArray(intentFiles) ? intentFiles : [];
  // The set the step captured before it fired the Save: an intent this row must not
  // mistake for its own is one that was already there (BE-704-302).
  const previous = baseline === null || baseline === undefined ? null : new Set(Array.isArray(baseline) ? baseline : baseline.names ?? []);
  // …and one that belongs to ANOTHER document is never this document's receipt either
  // (BE-704-404): the store keys one record per document, named by the hash of that key
  // (`appIntentRecordName`), so a new `.rec` of another document cannot satisfy this row.
  const documentRecord = appIntentRecordName(documentId);
  const mine = documentRecord ? names.filter((name) => name === documentRecord) : names;
  return {
    workingCopy,
    documentRecord,
    // the user-level counts stay on the receipt (they are the evidence a miss prints)…
    intentFiles: names.length,
    // …and these are THIS document's own
    documentIntentFiles: mine.length,
    newIntentFiles: previous === null ? mine.length : mine.filter((name) => !previous.has(name)).length,
    state: String(workingCopy?.binding?.state ?? workingCopy?.bindingState ?? "none"),
    baseVersion: Number(workingCopy?.binding?.baseVersion ?? 0),
  };
}

// ---- the real web host controller (D web page + the pinned frame) ---------------------------

/**
 * A GET under one document's office-frame route. The 90 s reload poll used to insist on the
 * EXACT open path (`/documents/{id}` with nothing after it, `FRAME_OPEN_PATH`), so a frame that
 * reloaded through another route of the same document (`/versions?…` first, a
 * `versionChanged` retry, a content read) was recorded as "no open at all" — a driver miss that
 * reads as a product miss (D4-01). Every GET of the document's route is recorded with its
 * pathname now, and the poll still requires the ANNOUNCED version id for a hit.
 */
const FRAME_DOC_GET_PATH = /\/api\/v1\/office-frame\/documents\/[^/]+/;

/**
 * The frame-message recorder, installed by `addInitScript` in EVERY document of
 * the web page's context (the page, and the Office frame inside it) before any
 * page script runs: it records the protocol envelopes that document RECEIVES.
 *
 * Receiving is the side to watch (D3-01). The D host posts `doc.remoteVersion`
 * to the FRAME's window — `packages/core/office/docs-frame-endpoint.ts:238`
 * (`peer.postMessage`), whose peer is `iframe.contentWindow`
 * (`use-docs-frame-session.ts:216`) — so the round-2 capture, which patched
 * `postMessage` and then read `window.__crossHostFrameMessages` in the TOP page,
 * could never see it: the announce is recorded where it is delivered. Reading
 * (`readFrameMessages` in every document and merging with
 * `summarizeFrameRecordings` sees it whichever realm the call resolved in.
 *
 * Since D5-01 a record carries what a GUARD comparison needs, measured rather
 * than guessed: the receiving realm (`href`), whether the parent window sent the
 * message (`fromParent`) and its `origin`, the envelope's `ns` / `v`, the
 * announce's own `document_id` / `revision` / `version_id` / `saved_at` with the
 * JS `typeof` each one arrived as, and the `file` a host `open` push or a
 * frame-visible `api.open` / `api.save` / `api.saveAs` reply carried
 * (`fileId`, `versionId`, `revision`, `etag`). That file is the frame's own held
 * copy: the pin derives `host.current()` from it
 * (`web/modules/shared/remote-version.ts:617` -> `revisionOf`,
 * `web/modules/shared/conflict-dialog.ts:135-140`), so the driver can name the
 * guard that dropped an announce instead of asserting one (the round-5 wording
 * "the frame's own guard needs a DECIMAL revision" was never measured).
 *
 * This function is serialized into the page: keep it self-contained (no
 * module-scope constants), the way `readRemoteNewerSurface` now is.
 */
export function installFrameRecorder(target = window) {
  const list = [];
  // the newest 1000 envelopes: a run's frame traffic is far below it, and the document is
  // replaced when the frame reloads
  const limit = 1000;
  const realm = (() => {
    try {
      return target?.location?.href ?? null;
    } catch {
      return null;
    }
  })();
  const parentWindow = (() => {
    try {
      return target?.parent ?? null;
    } catch {
      return null;
    }
  })();
  // the file meta a frame-visible envelope carried, in the pin's own field names
  // (`web/docs/protocol/types.ts:326-346`: the wire `FileMeta` is camelCase)
  const fileOf = (payload) => {
    const raw = payload?.save?.file ?? payload?.file;
    if (!raw || typeof raw !== "object" || typeof raw.fileId !== "string") return null;
    return {
      fileId: raw.fileId,
      versionId: typeof raw.versionId === "string" ? raw.versionId : null,
      revision: typeof raw.revision === "string" ? raw.revision : null,
      etag: typeof raw.etag === "string" ? raw.etag : null,
    };
  };
  Object.defineProperty(target, "__crossHostFrameMessages", { value: list, configurable: true });
  target.addEventListener("message", (event) => {
    try {
      const data = event?.data;
      if (!data || typeof data !== "object" || typeof data.type !== "string") return;
      const payload = data.payload ?? {};
      const seen = (key) => (key in payload ? payload[key] : null);
      list.push({
        kind: typeof data.kind === "string" ? data.kind : null,
        type: data.type,
        ns: typeof data.ns === "string" ? data.ns : null,
        v: typeof data.v === "number" ? data.v : null,
        versionId: seen("version_id"),
        versionIdType: typeof payload.version_id,
        version: seen("version"),
        revision: seen("revision"),
        revisionType: typeof payload.revision,
        documentId: seen("document_id"),
        documentIdType: typeof payload.document_id,
        savedAt: seen("saved_at"),
        savedAtType: typeof payload.saved_at,
        reason: seen("reason"),
        file: fileOf(payload),
        href: realm,
        origin: typeof event?.origin === "string" ? event.origin : null,
        // a synthetic event (a unit test's fake) has no `source`: unmeasured, never "not the parent"
        fromParent: event != null && "source" in event ? event.source === parentWindow : null,
        at: Date.now(),
      });
      if (list.length > limit) list.shift();
    } catch {
      // observing must never break the frame protocol
    }
  });
}

/** One document's recorded envelopes, or null when the recorder never ran there (a measured fact). */
export function readFrameMessages(target = window) {
  const list = target?.__crossHostFrameMessages;
  return Array.isArray(list) ? list : null;
}

/**
 * One page function off ONE frame, bounded (BE-704-304). Playwright's `frame.evaluate` has no
 * driver-level timeout here (`harness/web.mjs` sets none on the context), so every frame read
 * the driver makes goes through this: a renderer that is busy or gone costs at most `timeoutMs`
 * and answers a measured `{ ok: false, error }` instead of pinning the step past its bound.
 */
export async function evalFrameBounded(frame, fn, { timeoutMs = FRAME_READ_TIMEOUT_MS, arg = undefined } = {}) {
  const boundMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.floor(timeoutMs) : FRAME_READ_TIMEOUT_MS;
  const expired = { readExpired: true };
  let timer = null;
  const bound = new Promise((resolve) => {
    timer = setTimeout(() => resolve(expired), boundMs);
  });
  try {
    const value = await Promise.race([
      frame.evaluate(fn, arg).catch((err) => ({ readError: err?.message ?? String(err) })),
      bound,
    ]);
    if (value === expired) return { ok: false, error: `the frame read timed out after ${boundMs} ms`, value: null };
    if (value && value.readError) return { ok: false, error: `the frame read failed: ${value.readError}`, value: null };
    return { ok: true, error: "", value: value ?? null };
  } finally {
    clearTimeout(timer);
  }
}

/** The named miss for a frame read that was never started because the step's budget was spent. */
export const FRAME_READ_NO_BUDGET = "the frame read was not started: the step's remaining budget was 0 ms";

/**
 * Every document's one read, off the SAME step budget (BE-704-405). `pollUntil` only checks its
 * elapsed bound after the polled function resolves, so a poll that read N frames one after another
 * could pin the step N x the per-read bound past it (each read is bounded on its own, BE-704-304,
 * but nothing bounded the aggregate). Here the reads:
 *
 *   * start TOGETHER (one concurrent wave, so a hung renderer costs ONE bound, not N), in frame
 *     order so `frameRemoteState`'s `isTop: index 0` stays right;
 *   * take the SMALLER of the per-read bound and what is left of `deadlineMs` (the poll's own
 *     deadline, passed down by the caller), so one wave can never overrun the step;
 *   * are not started at all once no budget remains — the frame is still accounted for, with
 *     {@link FRAME_READ_NO_BUDGET} as its `readError`, because "the read never ran" and "the frame
 *     carried no recorder" must not read the same in a miss;
 *   * keep each frame's own `readError` (a timeout, a detached frame, a no-budget skip).
 *
 * `read` is the page function each frame is asked (`readFrameMessages`, or the surface probe).
 * A report carries `value` (whatever the read answered), `messages` (that value when it is an
 * envelope list, null otherwise — what the recorder merge reads) and the frame's own `readError`.
 */
export async function readFrameReports({
  frames = [],
  read = readFrameMessages,
  deadlineMs = Number.POSITIVE_INFINITY,
  perReadTimeoutMs = FRAME_READ_TIMEOUT_MS,
  now = Date.now,
} = {}) {
  const reports = new Array(frames.length);
  const urlOf = (frame) => {
    try {
      return typeof frame?.url === "function" ? frame.url() : null;
    } catch {
      return null;
    }
  };
  const wave = [];
  frames.forEach((frame, index) => {
    const remaining = Number.isFinite(deadlineMs) ? deadlineMs - now() : perReadTimeoutMs;
    if (!(remaining > 0)) {
      reports[index] = { url: urlOf(frame), value: null, messages: null, readError: FRAME_READ_NO_BUDGET };
      return;
    }
    wave.push(
      evalFrameBounded(frame, read, { timeoutMs: Math.min(perReadTimeoutMs, remaining) }).then((result) => {
        reports[index] = {
          url: urlOf(frame),
          value: result.ok ? result.value : null,
          messages: result.ok && Array.isArray(result.value) ? result.value : null,
          readError: result.ok ? "" : result.error,
        };
      }),
    );
  });
  await Promise.all(wave);
  return reports;
}

/**
 * The web frame's own S6 surface, read from INSIDE the frame (D4-01): the warn bar's text and its
 * action buttons, whether the conflict dialog is up and which choices it offers. This function is
 * serialized into the frame, so it stays self-contained (no module scope). The docs host's own
 * `data-dirty` / `data-state` live on the TOP page's host element, not here (`harness/web.mjs`
 * `webFrameSelectors`), so they are read by {@link readFrameHostState} instead. A reload miss then
 * says what the FRAME showed — a bar nobody clicked, a dialog waiting, no bar at all.
 */
export function readFrameRemoteSurface() {
  const bar = document.querySelector("section.uw-remote-bar");
  const actions = [...document.querySelectorAll("section.uw-remote-bar button.uw-remote-link")].map((el) => ({
    action: el.getAttribute("data-action"),
    label: (el.textContent ?? "").trim(),
  }));
  const dialog = document.querySelector('[data-office-web="conflict"]');
  const choices = dialog
    ? [...dialog.querySelectorAll("button[data-choice]")].map((el) => ({
        choice: el.getAttribute("data-choice"),
        label: (el.textContent ?? "").trim(),
      }))
    : [];
  return {
    bar: bar ? (bar.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 300) : "",
    actions,
    dialog: Boolean(dialog),
    choices,
  };
}

/** The web host element's own state, read from the TOP page (the frame cannot see its host). */
export function readFrameHostState() {
  const host = document.querySelector("[data-office-docs-frame]");
  return {
    state: host ? host.getAttribute("data-state") : null,
    dirty: host ? host.hasAttribute("data-dirty") : null,
    saveState: host ? host.getAttribute("data-save-state") : null,
  };
}

/**
 * The web host's own announcements, merged from every document's recorder, plus
 * the shape of what was read: how many documents the page had, how many carried
 * the recorder, and which protocol envelopes appeared at all (D3-01). Reading
 * the top page alone reported "nothing was captured" whether or not the host
 * announced; these numbers say which of the two it was.
 */
export function summarizeFrameRecordings(reports = [], sinceMs = 0) {
  const announcements = [];
  const types = new Map();
  const readErrorReasons = [];
  let recorders = 0;
  let events = 0;
  for (const report of reports ?? []) {
    const messages = Array.isArray(report?.messages) ? report.messages : null;
    if (messages) recorders += 1;
    // a read that expired or threw is a measured miss, counted and named rather
    // than silently read as "this document carried no recorder" (BE-704-304)
    if (typeof report?.readError === "string" && report.readError) readErrorReasons.push(report.readError);
    for (const message of messages ?? []) {
      if (!message || typeof message !== "object") continue;
      const key = `${message.kind ?? "?"}:${message.type ?? "?"}`;
      types.set(key, (types.get(key) ?? 0) + 1);
      if (message.kind !== "event") continue;
      events += 1;
      if (message.type === "doc.remoteVersion" && Number(message.at ?? 0) >= sinceMs) announcements.push(message);
    }
  }
  announcements.sort((a, b) => Number(a.at ?? 0) - Number(b.at ?? 0));
  // one logical announce can be recorded twice (the sender's document and the receiver's)
  const seen = new Set();
  const unique = announcements.filter((message) => {
    const key = `${message.versionId ?? ""}@${message.at ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    announcements: unique,
    frames: (reports ?? []).length,
    recorders,
    events,
    readErrors: readErrorReasons.length,
    readErrorReasons,
    types: [...types.entries()].map(([key, count]) => `${key} x${count}`),
  };
}

/** The docs frame protocol's namespace and version, as the INSTALLED pin defines them
 * (`web/docs/protocol/types.ts:25-27` at the frame pin): a mismatch drops the envelope as
 * `foreign` / `version_mismatch` before any handler runs. */
export const FRAME_PROTOCOL_NS = "uniwork.office.docs";
export const FRAME_PROTOCOL_VERSION = 1;

/**
 * The pin's decimal-revision predicate (`web/docs/protocol/types.ts:521-523`): `revision` is a
 * decimal STRING on this wire, never a JSON number. Mirrored here so the driver can measure
 * whether an announce would survive the guard instead of asserting which guard dropped it.
 */
export function isDecimalRevisionText(x) {
  return typeof x === "string" && x.length <= 20 && /^(0|[1-9][0-9]*)$/.test(x);
}

/**
 * `revisionOf` of the pinned frame (`web/modules/shared/conflict-dialog.ts:135-140`): the file's
 * own `revision` when that is a decimal, else an `etag` that is one (quotes stripped), else null.
 * This is what `host.current().revision` returns for the frame's held copy
 * (`web/docs/bridge/webapi.ts:616-617`), and therefore what the announce guards compare against.
 */
export function revisionOfFile(file) {
  if (!file) return null;
  if (isDecimalRevisionText(file.revision)) return file.revision;
  const etag = typeof file.etag === "string" ? file.etag.replace(/^"|"$/g, "") : null;
  return isDecimalRevisionText(etag) ? etag : null;
}

/**
 * What the web frame itself held and heard, measured inside its own realm (D5-01): the announce
 * envelope it received with the JS type of every field, the realm that recorded it, and the last
 * `file` a host `open` push or an `api.open` / `api.save` / `api.saveAs` reply carried — the
 * frame's held copy, which `revisionOfFile` turns into the `revision` the guards compare with.
 *
 * Playwright lists the main frame FIRST (`page.frames()`), so `isTop: true` on the first report is
 * the page and every other one is an embedded document: an announce recorded in the top page was
 * never delivered to the frame at all.
 */
export function frameRemoteState(reports = [], { versionId = null } = {}) {
  const docs = (reports ?? []).map((report, index) => ({
    url: report?.url ?? null,
    isTop: index === 0,
    messages: Array.isArray(report?.messages) ? report.messages : null,
    readError: typeof report?.readError === "string" ? report.readError : "",
  }));
  const announcesIn = (doc) =>
    (doc.messages ?? []).filter(
      (m) => m && m.kind === "event" && m.type === "doc.remoteVersion" && (versionId === null || m.versionId === versionId),
    );
  const lastFileIn = (doc) => {
    const files = (doc.messages ?? []).filter((m) => m?.file && typeof m.file.fileId === "string");
    return files.length > 0 ? files[files.length - 1] : null;
  };
  const realm = docs.find((doc) => announcesIn(doc).length > 0) ?? null;
  const holder = realm ?? docs.find((doc) => lastFileIn(doc) !== null) ?? null;
  const announce = realm ? announcesIn(realm).at(-1) : null;
  const file = holder ? lastFileIn(holder) : null;
  return {
    announce: announce ?? null,
    announceRealm: realm ? { url: realm.url, isTop: realm.isTop } : null,
    held: file
      ? { ...file.file, revisionOf: revisionOfFile(file.file), at: file.at, envelope: `${file.kind}:${file.type}` }
      : null,
    heldRealm: holder ? { url: holder.url, isTop: holder.isTop } : null,
    documents: docs.map((doc) => ({
      url: doc.url,
      isTop: doc.isTop,
      recorder: doc.messages !== null,
      messages: (doc.messages ?? []).length,
      readError: doc.readError,
    })),
  };
}

/**
 * Which of the pin's guards drops the announce, EVALUATED over measured values (D5-01) — the
 * guard is named (with its file:line) only when the values actually fail it; `guard: null` means
 * no guard explains the drop and the remaining surface is the delivery/handler wiring. The order
 * is the pin's own: the envelope reaches a handler only after
 * `web/docs/protocol/endpoint.ts:264-293` (origin, source, `parseEnvelope`), then
 * `web/docs/protocol/client.ts:489-493` filters by document, then the handler's chain at
 * `web/modules/shared/remote-version.ts:442-452`.
 */
export function announceGuardVerdict({ announce = null, held = null, announceRealm = null, heldRealm = null } = {}) {
  const described = (value, type) => `${JSON.stringify(value)} (${type ?? (typeof value)})`;
  if (!announce) return { guard: null, detail: "no doc.remoteVersion envelope was recorded in any document of the page" };
  const values = `document_id ${described(announce.documentId, announce.documentIdType)}, revision ${described(
    announce.revision,
    announce.revisionType,
  )}, version_id ${described(announce.versionId, announce.versionIdType)}`;
  const where = announceRealm ? `${announceRealm.isTop ? "the top page" : "a frame"}` : "an unrecorded document";
  if (announceRealm?.isTop) {
    return {
      guard: "the D host's post target (packages/core/office/docs-frame-endpoint.ts:236-238, peer = iframe.contentWindow)",
      detail: `the announce was recorded in ${where} and never in the frame, so no frame handler could run: ${values}`,
    };
  }
  if (announce.fromParent === false) {
    return {
      guard: "the frame endpoint's source/origin check (web/docs/protocol/endpoint.ts:264-275)",
      detail: `the announce reached ${where} but not from the parent window (origin ${JSON.stringify(
        announce.origin,
      )}, fromParent false): ${values}`,
    };
  }
  if (announce.ns !== FRAME_PROTOCOL_NS) {
    return {
      guard: "parseEnvelope isOwnTraffic (web/docs/protocol/types.ts:1758-1760)",
      detail: `the announce's ns ${JSON.stringify(announce.ns)} is not ${JSON.stringify(FRAME_PROTOCOL_NS)}, so the frame drops it as foreign: ${values}`,
    };
  }
  if (announce.v !== FRAME_PROTOCOL_VERSION) {
    return {
      guard: "parseEnvelope version check (web/docs/protocol/types.ts:1801)",
      detail: `the announce's v ${JSON.stringify(announce.v)} is not ${FRAME_PROTOCOL_VERSION}: ${values}`,
    };
  }
  if (!isDecimalRevisionText(announce.revision)) {
    return {
      guard: "!isDecimalRevision(p.revision) (web/modules/shared/remote-version.ts:443)",
      detail: `the announced revision arrived as ${described(announce.revision, announce.revisionType)}, which that guard drops silently: ${values}`,
    };
  }
  if (!held) {
    return {
      guard: null,
      detail: `the frame's own host.current() could not be measured: no host open push or api.open/api.save reply was recorded in ${
        heldRealm?.isTop ? "the top page" : "the frame's realm"
      }, so the fileId / revision guards cannot be evaluated (${values})`,
    };
  }
  if (held.fileId !== announce.documentId) {
    return {
      guard: "cur.fileId !== p.document_id (web/modules/shared/remote-version.ts:445)",
      detail: `the frame holds fileId ${JSON.stringify(held.fileId)} (${held.envelope}), the announce names document_id ${JSON.stringify(
        announce.documentId,
      )}`,
    };
  }
  const open = held.revisionOf;
  if (open !== null && BigInt(announce.revision) <= BigInt(open)) {
    return {
      guard: "rev <= open (web/modules/shared/remote-version.ts:448)",
      detail: `the frame already holds revision ${JSON.stringify(open)} (${held.envelope}) and the announce carries ${JSON.stringify(announce.revision)}`,
    };
  }
  return {
    guard: null,
    detail: `no guard at the pin explains the drop from these measured values: the frame holds fileId ${JSON.stringify(
      held.fileId,
    )} at revision ${JSON.stringify(open)} (${held.envelope}), the announce is ${values} and reached ${where} from the parent window`,
  };
}

/**
 * The slack the reload is allowed to take AFTER the announce before the step gives up on it. It is
 * NEVER subtracted from the freshness floor (BE-704-501): the window's lower bound is the announce's
 * own `at` exactly, so a matching GET recorded even 1 ms before the announce is a stale open and
 * cannot stand in for the reload. The postMessage -> host -> `api.open` hop a busy VM may add only
 * extends how long the step waits for the reload to COMPLETE.
 */
export const ANNOUNCE_OPEN_TOLERANCE_MS = 50;

/**
 * The recorded `office-frame` GETs at or after `sinceMs` (D5-01/BE-704-501). The reload window is
 * anchored at the ANNOUNCE's own timestamp, not at the instant the driver starts waiting: the frame
 * reloads the moment the announce lands, and round 5's window began after the driver's poll noticed
 * the announce — so a reload that had already happened was counted as "0 GET(s) after the announce".
 * The floor is `sinceMs` EXACTLY (`Number(entry.at) >= sinceMs`): no slack is subtracted here or by
 * the caller, because a GET from before the announce is a boot or stale open, not this row's reload.
 */
export function freshOpensAfter(opens, sinceMs) {
  const floor = Number.isFinite(sinceMs) && sinceMs > 0 ? sinceMs : 0;
  return (opens ?? []).filter((entry) => Number(entry?.at ?? 0) >= floor);
}

/**
 * Whether the frame's own `office-frame` GET for the announced version has landed yet (D4-01/
 * D5-01/BE-704-401/BE-704-501). The window is anchored at `sinceMs` — the ANNOUNCE's own timestamp,
 * with NO slack subtracted — never at the instant the driver started waiting or the instant its
 * click returned: a CLEAN frame reloads the moment the announce lands
 * (`web/modules/shared/remote-version.ts:364-379` -> `load` l.286-300), so its GET can be recorded
 * during the reload click and still be the reload. A GET recorded before the announce is a boot or
 * stale open and is reported as such (`opensBefore`), never taken for the reload — not even one
 * recorded 1 ms earlier, which is what the round-5 tolerance on the wrong side of the anchor did.
 *
 * The verdict carries the whole miss — how many of this document's GETs landed at/after the
 * announce, what they answered, and how many landed before it and how long before — so a row can
 * print what was measured instead of "no fresh open".
 */
export function evaluateReloadWindow(opens = [], { versionId = null, sinceMs = null, now = Date.now() } = {}) {
  const floor = Number.isFinite(sinceMs) && sinceMs > 0 ? Math.min(sinceMs, now) : now;
  const fresh = freshOpensAfter(opens, floor);
  const hit = versionId === null ? fresh[0] ?? null : fresh.find((entry) => entry?.versionId === versionId) ?? null;
  if (hit) return { reloaded: true, floor, hit, opensSeen: fresh.length, opensBefore: (opens ?? []).filter((entry) => Number(entry?.at ?? 0) < floor).length, reason: "" };
  const described = (entry) => {
    if (entry?.versionId) return entry.versionId;
    if (entry?.failed) return "the GET failed";
    if (entry?.answered) return `a GET with no versionId (${entry?.status ?? "no status"})`;
    return "a GET with no answer yet";
  };
  const seen = (fresh ?? [])
    .slice(0, 4)
    .map((entry) => `${described(entry)}${entry?.pathname ? ` @${entry.pathname}` : ""}`)
    .join(", ");
  const before = (opens ?? []).filter((entry) => Number(entry?.at ?? 0) < floor);
  const beforeSeen = before
    .slice(-4)
    .map((entry) => `${entry?.versionId ?? "no version id"} @${entry?.pathname ?? "no path"} (${Math.max(0, floor - Number(entry?.at ?? 0))} ms before the announce)`)
    .join(", ");
  return {
    reloaded: false,
    floor,
    hit: null,
    opensSeen: fresh.length,
    opensBefore: before.length,
    reason: `the web frame made no fresh office-frame open for ${versionId ?? "any version"} (${fresh.length} office-frame GET(s) of this document at/after the announce: ${
      seen || "none"
    }; ${before.length} of its GET(s) landed before the announce${beforeSeen ? `: ${beforeSeen}` : ""})`,
  };
}

/**
 * The frame's own S6 reload flow, SERIALIZED into the FRAME's document (D4-01/BE-704-402/406).
 *
 * A dirty frame (or one with an AI run live) shows its warn bar; its action is
 * `section.uw-remote-bar button.uw-remote-link[data-action="reload"]`
 * (`web/modules/shared/remote-bar.ts:118-124`, the bar `remote-version.ts:188-193` builds;
 * the action calls `reloadFlow` -> the conflict dialog at its reload step,
 * `web/modules/shared/conflict-dialog.ts:424-446`). That step offers `download` FIRST whenever the
 * host can download (`choices.push({id:'download', …})` l.426-433, then `discard` at l.434-438), so
 * a driver that clicks the first `[data-choice]` clicks DOWNLOAD: that starts a file delivery and
 * never reloads. This flow clicks ONLY `button[data-choice="discard"]` — "Discard changes and
 * reload" — and reports the choices it saw, so a step that never made the discard choice is a
 * measured miss rather than a silent download.
 *
 * It clicks nothing else, waits at most `boundMs` for the dialog (a clean frame shows none: it
 * reloads itself on the announce, and the caller then only waits for the fresh GET), and answers
 * `clicked: false, bar: false` when this document carries no bar at all. It is self-contained (no
 * module scope) because Playwright serializes only its own source.
 */
export async function driveFrameReloadFlow({ boundMs = 5_000, pollMs = 100 } = {}) {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const deadline = Date.now() + Math.max(0, Number(boundMs) || 0);
  const barAction = 'section.uw-remote-bar button.uw-remote-link[data-action="reload"]';
  const maskOf = () => document.querySelector('[data-office-web="conflict"]');
  const choicesOf = () =>
    [...((maskOf() ?? { querySelectorAll: () => [] }).querySelectorAll("button[data-choice]"))].map((el) => el.getAttribute("data-choice"));
  const action = document.querySelector(barAction);
  if (!action) {
    return { clicked: false, bar: false, choseDiscard: false, reason: "no S6 reload action is up in the frame (a clean document reloads itself on the announce)" };
  }
  if (action.getAttribute("aria-disabled") === "true") {
    return { clicked: false, bar: true, choseDiscard: false, reason: "the frame's S6 reload action is aria-disabled (the fork is still waiting on its own work)" };
  }
  const label = (action.textContent ?? "").trim();
  action.click();
  for (;;) {
    const mask = maskOf();
    const discard = mask ? mask.querySelector('button[data-choice="discard"]') : null;
    if (discard) {
      const choices = choicesOf();
      if (discard.getAttribute("aria-disabled") === "true") {
        return { clicked: true, bar: true, label, choices, choseDiscard: false, reason: 'the reload step\'s "discard" choice is aria-disabled' };
      }
      const confirmText = (discard.textContent ?? "").trim();
      discard.click();
      return { clicked: true, bar: true, label, choices, choseDiscard: true, confirmText };
    }
    if (Date.now() >= deadline) {
      const choices = mask ? choicesOf() : null;
      return {
        clicked: true,
        bar: true,
        label,
        choices,
        choseDiscard: false,
        reason: choices
          ? `the reload step offers no "discard" choice (it offers: ${choices.join(", ") || "none"})`
          : "the frame showed no reload confirm (its action reloads a clean document by itself)",
      };
    }
    await sleep(pollMs);
  }
}

/**
 * The web half on Playwright: signs the seeded account in at `/login`, opens
 * the document URL the D Inbox builds, waits for the Office frame host
 * (`data-state="ready"`), edits the frame the way the D e2e does
 * (`e2e/office-modules-web.spec.ts` sheets/html cases) and saves with
 * `harness/web.mjs` `webSave` (the frame's own Ctrl+S commit answer).
 *
 * What the host told the frame is captured by `installFrameRecorder`, installed
 * with `addInitScript` in every document before any page script runs: the D
 * vendored host posts `{kind:"event", type:"doc.remoteVersion", payload:{version_id,…}}`
 * to the FRAME's window once the handshake is done
 * (`packages/core/office/docs-frame-host.ts:370-390` via
 * `docs-frame-endpoint.ts:238`, whose peer is `iframe.contentWindow`), so a
 * captured event is the web's own S6 notice and its `version_id` is the version
 * the frame was told about. The capture is read from EVERY document of the page
 * (`readFrameMessages`), because the announce is delivered to the frame and never
 * reaches the top page's own array (D3-01). The frame's reload is read from its
 * own `api.open` answer (the `GET /office-frame/documents/{id}` response:
 * `file.version_id`).
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
    await web.context.addInitScript(installFrameRecorder);
    // Every GET of this document's office-frame route is recorded when it is ISSUED, and its
    // answer filled in when it lands (D5-01). Two round-5 defects are answered here:
    //   * a GET that never answers was invisible (the old record was pushed from the response
    //     body only), so "0 office-frame GET(s)" could not be told from "one that hung";
    //   * the reply's fields were read as `file.version_id` / `file.checksum_sha256`, but the
    //     pinned wire `FileMeta` is CAMELCASE (`fileId`, `versionId`, `revision`, `etag` —
    //     `web/docs/protocol/types.ts:326-346`), so every open this recorder saw was filed as
    //     "no version id" and the announced-version match could never succeed.
    const openEntryFor = (request) => {
      if (request.method() !== "GET") return null;
      const url = new URL(request.url());
      if (!FRAME_DOC_GET_PATH.test(url.pathname) || !url.pathname.includes(documentId)) return null;
      return { at: Date.now(), pathname: url.pathname, answered: false, failed: false, versionId: null, version: null, revision: null, checksum: null, fileId: null, etag: null };
    };
    const openEntries = new Map();
    web.page.on("request", (request) => {
      try {
        const entry = openEntryFor(request);
        if (!entry) return;
        opens.push(entry);
        openEntries.set(request, entry);
      } catch {
        // a malformed URL is not a frame open
      }
    });
    web.page.on("requestfailed", (request) => {
      const entry = openEntries.get(request);
      if (entry) entry.failed = true;
    });
    web.page.on("response", (response) => {
      try {
        const request = response.request();
        const entry = openEntries.get(request) ?? openEntryFor(request);
        if (!entry) return;
        if (!openEntries.has(request)) opens.push(entry);
        entry.status = response.status();
        response
          .json()
          .then((body) => {
            const file = body?.file ?? null;
            entry.answered = true;
            entry.fileId = file?.fileId ?? null;
            entry.versionId = file?.versionId ?? file?.version_id ?? null;
            entry.version = file?.version ?? body?.version ?? null;
            entry.revision = file?.revision ?? body?.revision ?? null;
            entry.etag = file?.etag ?? null;
            entry.checksum = file?.checksum_sha256 ?? null;
          })
          .catch(() => {
            entry.answered = true;
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

    /**
     * What every document of this page received (D3-01), off ONE step budget (BE-704-405). A
     * document whose recorder never ran, a frame that went away mid-read, or a read that was never
     * started because the budget was spent reports `messages: null` with its own `readError` — a
     * measured fact the miss reason counts rather than hides. The reads are concurrent (one bound
     * for N frames) and share `deadlineMs`, which the poll passes down from its own budget.
     */
    const frameReports = async ({ deadlineMs = Date.now() + stepTimeoutMs, read = readFrameMessages } = {}) =>
      readFrameReports({ frames: web.page.frames(), read, deadlineMs, perReadTimeoutMs: FRAME_READ_TIMEOUT_MS });

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
      async announcements({ sinceMs = 0, deadlineMs = Date.now() + stepTimeoutMs } = {}) {
        // every document's recorder is read: the host posts to the frame's window (D3-01), off the
        // poll's OWN remaining budget so N frames can never overrun it (BE-704-405)
        return summarizeFrameRecordings(await frameReports({ deadlineMs }), sinceMs).announcements;
      },
      /** The same merge with the shape of what was read, for a miss's reason (D3-01). */
      async frameAudit({ deadlineMs = Date.now() + stepTimeoutMs } = {}) {
        return summarizeFrameRecordings(await frameReports({ deadlineMs }), 0);
      },
      /**
       * The fresh `office-frame` open of the announced version. The window is anchored at the
       * ANNOUNCE's own timestamp (`sinceMs`, the recorder's `at` in the frame's realm) EXACTLY
       * (BE-704-501) — never at the instant this call starts (D5-01), never at the instant the
       * reload click returned (BE-704-401), and never with slack subtracted from the floor: a CLEAN
       * frame reloads the moment the announce lands, so its GET can be recorded before the click
       * returns and is still the reload, while a GET from before the announce is a stale open.
       */
      async waitForReload({ versionId, sinceMs = null, timeoutMs = stepTimeoutMs }) {
        const settled = await pollUntil(
          async () => evaluateReloadWindow(opens, { versionId, sinceMs }),
          (verdict) => verdict.reloaded,
          { boundMs: timeoutMs, intervalMs: pollMs },
        );
        const verdict = settled.value ?? evaluateReloadWindow(opens, { versionId, sinceMs });
        if (!verdict.reloaded) {
          return {
            reloaded: false,
            elapsedMs: settled.elapsedMs,
            opensSeen: verdict.opensSeen,
            opensBefore: verdict.opensBefore,
            reason: `${verdict.reason} within ${timeoutMs} ms`,
          };
        }
        const hit = verdict.hit;
        return { reloaded: true, versionId: hit.versionId, version: hit.version, checksum: hit.checksum, revision: hit.revision, elapsedMs: settled.elapsedMs };
      },
      /**
       * What the frame itself held and heard, measured in its own realm (D5-01): the announce
       * envelope with the JS type of every field, the realm that received it, the frame's held
       * file (`host open` push / `api.open` / `api.save`), and which of the pin's guards those
       * values fail. The guard is NAMED from the measurement — never assumed.
       */
      async frameEvidence({ versionId = null, deadlineMs = Date.now() + stepTimeoutMs } = {}) {
        const state = frameRemoteState(await frameReports({ deadlineMs }), { versionId });
        return {
          ...state,
          verdict: announceGuardVerdict({
            announce: state.announce,
            held: state.held,
            announceRealm: state.announceRealm,
            heldRealm: state.heldRealm,
          }),
        };
      },
      /**
       * The frame's OWN S6 reload action (D4-01/BE-704-402). At the fork pin a CLEAN frame reloads
       * itself on the announce (`web/modules/shared/remote-version.ts:364-379` `evaluate`
       * -> `load` l.286-300), but a DIRTY frame (or one with an AI run live) only shows the warn
       * bar: its "Reload latest…" ({@link ../remote-version.ts} l.210-228 -> `reloadFlow`
       * l.400-430) opens the conflict dialog's Reload step, whose control is
       * `button[data-choice="discard"]` ("Discard changes and reload",
       * `conflict-dialog.ts:417-446`) — NEVER `download`, which the same step offers FIRST and
       * which starts a file delivery instead of reloading. The web frame is an IFRAME, so the
       * whole flow runs INSIDE it (`driveFrameReloadFlow`, serialized into the frame's document).
       *
       * This call only DRIVES the fork: it never claims the reload happened. The caller waits for
       * the fresh open of the announced version id, and that GET is what confirms (BE-704-402).
       * Nothing to click (a clean frame that reloads itself) is not a failure: it answers
       * `clicked: false` with that reason, and the caller waits for the open either way.
       */
      async clickReload({ versionId = null } = {}) {
        // `versionId` is the announced version the caller is waiting for: the fork's bar names a
        // REVISION, not a version id (`uwRemoteNewerDirty` `{n}`), so the control is found by its
        // own action, and the argument is only carried into the record.
        void versionId;
        const clickTimeout = Math.min(stepTimeoutMs, 5_000);
        for (const frame of web.page.frames()) {
          if (frame === web.page.mainFrame()) continue;
          const read = await evalFrameBounded(frame, driveFrameReloadFlow, {
            timeoutMs: clickTimeout + 500,
            arg: { boundMs: clickTimeout, pollMs },
          });
          if (!read.ok) {
            return { clicked: false, bar: false, frame: editorKindOfUrl(frame.url()) ?? "frame", reason: `the frame's S6 reload flow could not be driven: ${read.error}` };
          }
          const { bar: carriesBar, ...flow } = read.value ?? {};
          // no bar in THIS document (a clean frame reloads itself): another frame may carry it
          if (carriesBar !== true) continue;
          return { ...flow, frame: editorKindOfUrl(frame.url()) ?? "frame" };
        }
        return { clicked: false, bar: false, reason: "no S6 reload action is up in any frame (a clean frame reloads itself on the announce)" };
      },
      /** What each document showed when the reload did not happen (D4-01), read where it lives. */
      async frameSurface({ deadlineMs = Date.now() + stepTimeoutMs } = {}) {
        // the docs host element is on the TOP page, the bar and the dialog are inside the frame;
        // the frames' own reads share one budget and run concurrently (BE-704-405)
        const hostBudget = Math.min(FRAME_READ_TIMEOUT_MS, deadlineMs - Date.now());
        const hostRead =
          hostBudget > 0
            ? await evalFrameBounded(web.page, readFrameHostState, { timeoutMs: hostBudget })
            : { ok: false, error: FRAME_READ_NO_BUDGET };
        const reports = [{ url: web.page.url(), host: hostRead.ok ? hostRead.value : null, surface: null, error: hostRead.ok ? "" : hostRead.error }];
        for (const report of await frameReports({ deadlineMs, read: readFrameRemoteSurface })) {
          reports.push({ url: report.url, host: null, surface: report.value, error: report.readError });
        }
        return reports;
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
 * Signs the previous row's session out of the shared app BEFORE the harness's
 * sign-in runs, with the confirmation the product's own UI sends
 * (`accountLogout({ confirmed: true })`,
 * `apps/shell/src/renderer/src/account-model.ts:443`).
 *
 * The harness's `signIn` logs a signed-in app out with a bare
 * `aiOffice.accountLogout()` (`harness/app.mjs:275`), and the fork's S3 gate
 * asks the shell renderer first whenever the sign-out plan still holds unsent
 * work (`uniwork-docs/wiring.ts:875-889` -> `uniwork-docs/account-boundary.ts`
 * l.198-214, `plan.count > 0 || plan.ramOnly > 0`). Only the renderer's answer
 * resolves that promise, and no one answers it in a headless run: on the 4th
 * row of the cloud D2 round (G5-A03 docx, the app still holding row 3's dirty
 * sheets edit) `app-open` hung to the 90 s step bound with
 * `aiOffice.accountLogout did not settle within 90 s` (D2-05). Answering the
 * gate here leaves the harness's own logout with a signed-out app.
 *
 * `aiOffice(name, args)` is `harness/app.mjs`'s bounded bridge, so a hang still
 * ends as the caller's step timeout, never an unbounded wait.
 */
export async function signOutPreviousSession(aiOffice) {
  const status = await aiOffice("accountStatus").catch(() => null);
  if (status?.state !== "signed-in") return { signedOut: false, state: status?.state ?? null };
  // `{ confirmed: true }`, exactly (BE-704-301): `aiOffice(name, ...args)` spreads its
  // rest args into `window.aiOffice[name](...a)` (`harness/app.mjs:208-210`), so an array
  // here reaches the preload as ONE array argument; the pinned fork reads
  // `options.confirmed` (`uniwork-auth/index.ts:652-658`), finds none, and its sign-out
  // gate then waits for a renderer prompt no headless run can answer — cloud D2/D3/D4's
  // 4th-row 90 s `app-open` hang. The object form is what the product's own account UI
  // sends (`account-model.ts:443`) and what `harness/app.mjs` sends for its own logout.
  await aiOffice("accountLogout", { confirmed: true });
  return { signedOut: true, state: status.state };
}

/**
 * The app's own S6 reload flow, SERIALIZED into the editor page (D4-02/BE-704-406). The fork's
 * reload is a FLOW, not one click, and it is all in this page:
 *
 *   1. the bar's own action — `div.uw-remote-bar button.uw-remote-action[data-action="reload"]`
 *      (`UniworkChrome.tsx:1085-1113`, label `uwRemoteReload`) — calls
 *      `aiOffice.uniworkRemoteAction(path, 'reload')` (`UniworkChrome.tsx:582`); a page that has
 *      not been re-rendered by this fork keeps a text-matched fallback;
 *   2. the main process opens the conflict dialog for the stored notice
 *      (`service.ts:3860-3874`), whose step 1 offers "Reload latest"
 *      (`button[data-conflict-action="reload"]`, `UniworkConflictDialog.tsx:573-577`);
 *   3. its reload step asks what happens to the local edits — "Keep my version as a draft" /
 *      "Discard my changes" (`input[type="radio"][value="discard"]`, l.519-535) — and the confirm
 *      refuses while no choice is made (`canSubmit = selectedKeep === 'discard' || (selectedKeep
 *      === 'draft' && keepOk)`, `uniwork-conflict-model.ts:326`);
 *   4. the confirm is `button[data-conflict-action="reload-go"]` (l.624-642), rendered
 *      `aria-disabled="true"` until that choice is made.
 *
 * The old driver clicked one text-matched button and never made the choice, so the confirm stayed
 * disabled and the app kept the old version (cloud D4's `app-reload` FAIL). This returns the
 * steps it walked (`bar`, `step1`, `choseDiscard`), the `aria-disabled` text that refused, and
 * whether the confirm was actually clicked (`confirmed`) — so a row can FAIL on the confirmation
 * instead of on a settle timeout (BE-704-403). It is self-contained (no module scope) because
 * Playwright serializes only its own source.
 */
export async function driveAppConflictReloadFlow(boundMs = 8_000) {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const dialog = () => document.querySelector('[role="alertdialog"]');
  const steps = { bar: false, step1: false, choseDiscard: false, disabled: "" };
  const deadline = Date.now() + Math.max(0, Number(boundMs) || 0);
  for (;;) {
    if (!steps.bar) {
      const el =
        document.querySelector('div.uw-remote-bar button.uw-remote-action[data-action="reload"]') ??
        [...document.querySelectorAll("button,a,[role='button']")].find(
          (button) =>
            !button.closest('[role="alertdialog"]') &&
            /(Tải lại bản mới nhất|Reload latest)/i.test((button.textContent ?? "").trim()),
        );
      if (el) {
        if (el.getAttribute("aria-disabled") === "true") {
          return { ...steps, clicked: false, confirmed: false, reason: "the S6 bar's reload action is aria-disabled (the fork is still waiting on its own save)" };
        }
        el.click();
        steps.bar = true;
        await sleep(150);
        continue;
      }
    }
    if (steps.bar && !steps.step1) {
      const step1 = dialog()?.querySelector('button[data-conflict-action="reload"]');
      if (step1) {
        if (step1.getAttribute("aria-disabled") === "true") {
          return { ...steps, clicked: true, confirmed: false, reason: `the conflict dialog's "Reload latest" is aria-disabled (${(step1.textContent ?? "").trim()})` };
        }
        step1.click();
        steps.step1 = true;
        await sleep(150);
        continue;
      }
    }
    if (steps.bar && !steps.choseDiscard) {
      const radio = dialog()?.querySelector('input[type="radio"][value="discard"]');
      if (radio) {
        if (!radio.checked) radio.click();
        steps.choseDiscard = Boolean(radio.checked);
        await sleep(100);
        continue;
      }
    }
    if (steps.bar) {
      const go = dialog()?.querySelector('button[data-conflict-action="reload-go"]');
      if (go) {
        if (go.getAttribute("aria-disabled") === "true") {
          steps.disabled = (go.textContent ?? "").trim();
        } else {
          go.click();
          return { ...steps, clicked: true, confirmed: true, confirmText: (go.textContent ?? "").trim() };
        }
      }
    }
    if (Date.now() >= deadline) {
      return {
        ...steps,
        clicked: steps.bar,
        confirmed: false,
        reason: steps.disabled
          ? `the reload confirm "${steps.disabled}" stayed disabled after the keep choice`
          : steps.bar
            ? "the conflict dialog's reload step never appeared"
            : "the S6 bar's reload action was never found",
      };
    }
    await sleep(200);
  }
}

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
    // D2-05: answer the fork's sign-out gate for the PREVIOUS row's session (see
    // `signOutPreviousSession`) before the harness's own logout can hang on it.
    // A timeout here is the row's own FAIL; any other answer is best-effort and
    // the harness's logout below reports what it sees.
    await signOutPreviousSession(ctrl.aiOffice).catch((err) => {
      if (err?.isAppStepTimeout) {
        // Name this call in the record (D3-03): the harness's own sign-in sends the same
        // `aiOffice.accountLogout` through the same bridge, so a bare "did not settle within
        // 90 s" could not be attributed to either side in cloud D3.
        err.message = `the previous row's session could not be signed out: ${err.message}`;
        err.appStepTimeout = {
          ...err.appStepTimeout,
          call: `signOutPreviousSession.${err.appStepTimeout?.call ?? "aiOffice.accountLogout"}`,
        };
        throw err;
      }
    });
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
  /**
   * The page that carries the S6 bar (probed with readRemoteNewerSurface). A
   * page whose probe throws does not fail the search — another page may show
   * the bar — but the first error is kept so a miss can say what broke
   * (`remoteNewerMissReason`, D2-04).
   */
  const findRemoteNewerPage = async (version) => {
    const probeErrors = [];
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
        probeErrors.push(err.message);
        return null;
      });
      if (probe?.visible) return { page, probe, probeErrors };
    }
    return { page: null, probe: null, probeErrors };
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
    /** The shared dirty-edit plan driver (see `makeAppDirty`), page picked for this working copy. */
    async makeDirty({ path }) {
      return makeAppDirty({ ctrl, kind, path, documentId });
    },
    async remoteNewerBar({ version }) {
      return newerBarReport(await findRemoteNewerPage(version), version);
    },
    async clickReload({ version = null } = {}) {
      const { page, probe, probeErrors } = await findRemoteNewerPage(version);
      if (!page) return { clicked: false, reason: remoteNewerMissReason(version, probeErrors) };
      // The fork's S6 reload is a FLOW, not one click (D4-02): see
      // `driveAppConflictReloadFlow` for the pin's own steps — the bar's action,
      // the dialog's "Reload latest", the "Discard my changes" radio and the
      // confirm that stays `aria-disabled` until that choice is made
      // (`uniwork-conflict-model.ts:326`). The flow is a serialized page function
      // so the page-side markup is testable against a fake DOM (BE-704-406).
      const boundMs = Math.min(stepTimeoutMs, 8000);
      const flow = await ctrl
        .evalBounded(page, driveAppConflictReloadFlow, boundMs, "click:remoteNewerReloadFlow")
        .catch((err) => {
          if (err?.isAppStepTimeout) throw err;
          return { clicked: false, reason: err.message };
        });
      if (!flow?.clicked) return { clicked: false, reason: flow?.reason ?? "no reload action" };
      return {
        clicked: true,
        confirmed: flow.confirmed === true,
        confirmText: flow.confirmText ?? "",
        choseDiscard: flow.choseDiscard === true,
        confirmReason: flow.confirmed === true ? "" : flow.reason ?? "no confirm answer",
        text: probe?.text ?? "",
      };
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

// Exported for G7-08 web-driver.mjs to reuse version counting without copying (proposal §3).
// `strict` (G7-08 w2e, review r2 G708-R2-6; r3 G708-R3-4): a 200 without a `versions` array is an
// absent scored field for the strict G7-08 caller, not a count of 0. The default keeps the old
// lenient expression for every G7-04 caller, so a body shaped `{versions:{length:3}}` still
// counts as before and only `strict: true` rejects a non-array list.
export async function listVersions({ apiOrigin, fetchImpl = fetch, documentId, token, strict = false }) {
  const res = await callTracerApi({ apiOrigin, fetchImpl, name: "listDocumentVersions", params: { documentID: documentId }, token });
  const versions = res.data?.versions;
  if (strict) {
    if (!Array.isArray(versions)) {
      throw new Error("missing_version_list: the listDocumentVersions body carries no versions array");
    }
    return versions.length;
  }
  return versions?.length ?? 0;
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
    // BE-704-08: which of the three edit steps this run drove through the app's
    // OWN editor UI. "real" = the editor itself made the edit; "standin" = the
    // harness wrote the format's deterministic bytes into the working copy (a
    // working-copy write, never claimed as a UI edit) — or the step never ran,
    // which drove no UI edit either. G7-A01 runs no dirty step (D1-04), so its
    // `dirty` entry is always "standin".
    uiEdits: { dirty: "standin", offlineSave: "standin", aiSave: "standin" },
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
  /**
   * Whether a recorded step's outcome must END the chain right now (D1-04).
   * A FAIL always does. A BLOCKED does NOT: the later steps that consume its
   * result are recorded SKIPPED instead (see `runStep`), so the row still ends
   * BLOCKED (77) with the named blocker while every step that reads nothing the
   * BLOCKED step produced still runs. A PASS never does.
   */
  const aborts = (name) => record.steps[name]?.status === "FAIL";
  /**
   * Runs one step, but records SKIPPED instead when a BLOCKED step's result it
   * depends on never arrived. A BLOCKED step therefore stops the chain only for
   * the steps that need its result: in the G5-A03 chain a BLOCKED `app-dirty`
   * skips `dirty-kept`/`app-reload` (they read the dirty editor state) while the
   * independent `web-save-2` -> `app-offline-save` -> `app-reconnect` ->
   * `web-sees` -> `final-shas` still run (D1-04).
   */
  const skipped = new Set();
  const runStep = async (name, source, fn) => {
    if (skipped.has(name)) {
      record.steps[name] = {
        source,
        status: "SKIPPED",
        reason: "skipped: it consumes the result of a BLOCKED step (D1-04)",
        elapsedMs: 0,
      };
      return record.steps[name];
    }
    const result = await step(name, source, fn);
    if (result.status === "BLOCKED") for (const dep of dependentSteps(row, name)) skipped.add(dep);
    return result;
  };

  const runChain = async () => {
    // --- seed one document for this fixture --------------------------------
    const seed = await runStep("seed", "protocol", async () => {
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
    if (aborts("seed")) return;
    const { token, email, password, userId, organizationSlug, workspaceSlug, documentId } = seeded;
    const kind = FIXTURE_KIND[fixture];
    const user = { key: "cross-host-seeded", id: userId, email, password, token };
    const wc0 = () => app?.workingCopy?.() ?? null;
    /**
     * The version the NEXT commit must create: the server's own count plus one.
     * Read from the server rather than counted locally, so a step that never ran
     * (a SKIPPED step after a BLOCKED one, D1-04) cannot desynchronise the
     * expectation: whatever committed, the next Save is one more. Call it BEFORE
     * the commit it predicts (the count moves as soon as the commit lands).
     */
    const nextVersion = async () => (await listVersions({ apiOrigin, fetchImpl, documentId, token })) + 1;

    // --- 1. web edit + Save (G7-A01.1 / G5-A03.1 source) --------------------
    const webOpen = await runStep("web-open", "web", async () => {
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
    if (aborts("web-open")) return;

    const webSave1 = await runStep("web-save-1", "web", async () => {
      const saved = await web.editAndSave({ marker: `web-1-${Date.now().toString(36)}` });
      if (!saved.saved) {
        return saved.drivable === false
          ? { status: "BLOCKED", blocker: saved.reason, owner: BLOCKED_OWNER }
          : { status: "FAIL", reason: saved.reason ?? "the web frame did not save the edit" };
      }
      const head = await readFrameHeadViaProtocol({ apiOrigin, fetchImpl, documentId, token, withBytes: true });
      const want = 2;
      if (head.version !== want || head.versionId !== saved.versionId || head.sha256 !== head.checksum) {
        return {
          status: "FAIL",
          reason: `the web Save did not land as version ${want} of the same bytes (version=${head.version}, id=${head.versionId}, saved=${saved.versionId})`,
        };
      }
      record.versionIds[`v${head.version}`] = head.versionId;
      record.versionCounts.afterWebSave1 = head.version;
      record.checksums.webAfterWebSave1 = head.sha256;
      record.details.webSaveAt = now();
      record.userSaves.push({ version: head.version, versionId: head.versionId, checksum: head.checksum, source: "web" });
      hooks?.afterWebSave?.({ version: head.version, versionId: head.versionId, revision: head.revision, checksum: head.checksum, source: "web" });
      return { versionId: head.versionId, version: head.version, checksum: head.checksum, dirtyObserved: saved.dirtyObserved ?? null };
    });
    if (aborts("web-save-1")) return;

    // --- 2. open in the app from web (deep link) ----------------------------
    const appOpen = await runStep("app-open", "app", async () => {
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
    if (aborts("app-open")) return;

    // --- 3. the app is dirty, a web Save lands (G5-A03.3 ONLY, D1-04) ------
    // G5-A03.3 is the only row that drives the dirty editor; G7-A01 runs no
    // step here at all, so a fork whose editor control never becomes ready can
    // no longer block the G7-A01 chain.
    if (row === "G5-A03") {
      const appDirty = await runStep("app-dirty", "app-ui", async () => {
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
        record.uiEdits.dirty = "real";
        return { source: dirty.source, plan: dirty.plan ?? "", workingCopySha256: wc?.sha256 ?? "" };
      });
      // A BLOCKED dirty step must NOT end the chain (D1-04): `runStep` records
      // the steps that read the dirty edit's result as SKIPPED (`web-save-2` ->
      // `dirty-kept` -> `app-reload`, see `STEP_DEPENDENCIES`) while the steps
      // that read nothing it produced still run: `app-offline-save` ->
      // `app-reconnect` -> `web-sees` -> `final-shas` (G5-A03.2). The row then
      // ends BLOCKED (77) with the dirty step's named blocker. A FAIL still wins
      // and stops the chain.
      if (aborts("app-dirty")) return;

      const webSave2 = await runStep("web-save-2", "web", async () => {
        const want = await nextVersion();
        const saved = await web.editAndSave({ marker: `web-2-${Date.now().toString(36)}` });
        if (!saved.saved) {
          return saved.drivable === false
            ? { status: "BLOCKED", blocker: saved.reason, owner: BLOCKED_OWNER }
            : { status: "FAIL", reason: saved.reason ?? "the second web Save did not happen" };
        }
        const head = await readFrameHeadViaProtocol({ apiOrigin, fetchImpl, documentId, token, withBytes: true });
        if (head.version !== want || head.versionId !== saved.versionId) {
          return { status: "FAIL", reason: `the second web Save did not land as version ${want} (version=${head.version}, id=${head.versionId})` };
        }
        record.versionIds[`v${head.version}`] = head.versionId;
        record.versionCounts.afterWebSave2 = head.version;
        record.checksums.webAfterWebSave2 = head.sha256;
        record.details.webSaveAt = now();
        record.userSaves.push({ version: head.version, versionId: head.versionId, checksum: head.checksum, source: "web" });
        hooks?.afterWebSave?.({ version: head.version, versionId: head.versionId, revision: head.revision, checksum: head.checksum, source: "web" });
        return { versionId: head.versionId, version: head.version };
      });
      if (aborts("web-save-2")) return;

      const dirtyKept = await runStep("dirty-kept", "app", async () => {
        const webSave2Version = record.versionCounts.afterWebSave2;
        // The tracer's feed-nudge recipe (waitForFeedReloadV2): the app's own
        // feed pass is what tells a dirty, open document that a newer version
        // exists. One nudge can land while the proxy is still cut, so the poll
        // re-runs it — spaced over the bound, capped at FEED_NUDGE_LIMIT — while
        // the bar is missing (D2-04).
        const nudgeEveryMs = Math.max(pollMs * 4, Math.floor(stepTimeout / (FEED_NUDGE_LIMIT * 3)));
        let nudges = 0;
        let lastNudgeAt = 0;
        const noticed = await pollUntil(
          async () => {
            const at = now();
            if (nudges < FEED_NUDGE_LIMIT && at - lastNudgeAt >= nudgeEveryMs) {
              nudges += 1;
              lastNudgeAt = at;
              await app.nudgeSync?.();
            }
            return app.remoteNewerBar({ version: webSave2Version });
          },
          (r) => r?.visible === true,
          { boundMs: stepTimeout, intervalMs: pollMs },
        );
        const wc = wc0();
        const problems = [];
        if (wc?.sha256 !== record.details.dirtyEditSha) {
          problems.push(`the app replaced its local bytes (working copy ${wc?.sha256 ?? "none"} != ${record.details.dirtyEditSha})`);
        }
        if (Number(wc?.binding?.baseVersion ?? 0) !== record.versionCounts.afterWebSave1) {
          problems.push(`the app reloaded the incoming version (binding v${wc?.binding?.baseVersion ?? "none"})`);
        }
        if (noticed.value?.visible !== true) {
          problems.push(
            `the S6 new-version bar was not visible: ${noticed.value?.reason ?? "no probe answer"} (feed nudges: ${nudges})`,
          );
        } else if (noticed.value.version !== webSave2Version) {
          // BE-704-303: the bar must name the version this step waited for, not
          // whatever bar another page happened to carry
          problems.push(`the S6 new-version bar names version ${noticed.value.version ?? "none"}, not ${webSave2Version}`);
        }
        if (problems.length > 0) return { status: "FAIL", reason: problems.join("; ") };
        record.details.remoteNewerBar = noticed.value;
        return { bar: noticed.value, workingCopySha256: wc.sha256, feedNudges: nudges };
      });
      if (aborts("dirty-kept")) return;

      // --- discard/reload the dirty edit to continue ------------------------
      const appReload = await runStep("app-reload", "app-ui", async () => {
        // the dirty checksum just BEFORE the click (BE-704-403): the discard is only a measured
        // transition from these bytes, so record them before the fork can replace the copy
        const before = wc0();
        // the bar must name the version the web just saved (BE-704-303); the click then drives
        // the fork's own reload path, keep choice and confirm included (D4-02)
        const clicked = await app.clickReload({ version: record.versionCounts.afterWebSave2 });
        if (!clicked?.clicked) {
          return { status: "BLOCKED", blocker: `the S6 reload action could not be driven: ${clicked?.reason ?? "unknown"}`, owner: BLOCKED_OWNER };
        }
        // The discard is only ACCEPTED with the confirmation the fork requires: the reload step's
        // confirm refuses until the keep choice is made (`canSubmit = selectedKeep === 'discard'
        // || …`, uniwork-conflict-model.ts:326). A copy that reaches the web Save's bytes without
        // that confirmation (a stray reload, another sync path) must not PASS this row (BE-704-403).
        if (clicked.confirmed !== true || clicked.choseDiscard !== true) {
          const wc = wc0();
          return {
            status: "FAIL",
            reason: `the app's reload was not confirmed with the discard choice (confirmed=${clicked.confirmed === true}, choseDiscard=${clicked.choseDiscard === true}); the fork answered: ${
              clicked.confirmReason || clicked.reason || "no confirm answer"
            }; the dirty working copy before the click was ${digestForReason(before?.sha256)} (binding v${
              before?.binding?.baseVersion ?? "none"
            }) and is now ${digestForReason(wc?.sha256)} (binding v${wc?.binding?.baseVersion ?? "none"})`,
          };
        }
        const settled = await pollUntil(
          async () => app.workingCopy(),
          (wc) => Number(wc?.binding?.baseVersion) === record.versionCounts.afterWebSave2 && wc.sha256 === record.checksums.webAfterWebSave2,
          { boundMs: stepTimeout, intervalMs: pollMs },
        );
        if (!settled.ok) {
          const wc = settled.value ?? {};
          // the click's own outcome, measured: a confirm that never became usable is the
          // difference between "the fork did not reload" and "the driver never confirmed"
          return {
            status: "FAIL",
            reason: `the app did not settle on v${record.versionCounts.afterWebSave2} after the reload (binding v${wc.binding?.baseVersion ?? "none"}, working copy ${digestForReason(wc.sha256)}, reload click: ${
              clicked.confirmed ? `confirmed "${clicked.confirmText ?? ""}"` : clicked.confirmReason ?? "not confirmed"
            })`,
          };
        }
        record.details.appReload = {
          clicked: true,
          confirmed: true,
          choseDiscard: true,
          confirmText: clicked.confirmText ?? "",
          dirtyShaBeforeClick: before?.sha256 ?? "",
          baseVersionBeforeClick: Number(before?.binding?.baseVersion ?? 0),
        };
        return { versionId: settled.value.binding.baseVersionId, version: record.versionCounts.afterWebSave2 };
      });
      if (aborts("app-reload")) return;
    }

    // --- 4. desktop offline edit + Save (G7-A01.3) --------------------------
    const offlineSave = await runStep("app-offline-save", "app-ui", async () => {
      // The count the offline Save must NOT move: read before the cut, because
      // `listVersions` goes straight to the API and is unaffected by the app's
      // cut proxy, so this is the server's own tally at the moment of the cut.
      const baseVersion = await listVersions({ apiOrigin, fetchImpl, documentId, token });
      await app.cutLink();
      const dirty = await app.makeDirty({ path: record.details.appPath, documentId });
      const uiEdit = Boolean(dirty?.edited && dirty.source === "app-ui");
      const standIn = uiEdit
        ? null
        : kind === "sheets"
          ? buildXlsxRevenueWithXyzBytes(repoRoot).bytes
          : buildEditedDocxFixtureBytes(repoRoot).v2Bytes;
      record.uiEdits.offlineSave = uiEdit ? "real" : "standin";
      if (!uiEdit) {
        record.notes.push(
          `the offline Save's edit was written by the harness as the format's deterministic stand-in (a working-copy write), not typed in the editor: ${dirty?.reason ?? "the editor plan did not run"} — this is not a UI edit (uiEdits.offlineSave=standin)`,
        );
      }
      // The intents this row must NOT count as its own (BE-704-302): a confirmed
      // sign-out parks unsent work, so the user-level intents dir can already hold
      // a `.rec` from an earlier parked row, and a poll that accepted "some intent
      // exists" would PASS without proving THIS Save was held. Read the baseline
      // right before the Save and require something NEW.
      const intentBaseline = app.intents();
      const saved = await app.save({ path: record.details.appPath, offline: true, standInBytes: standIn });
      if (saved?.reason) return { status: "FAIL", reason: saved.reason };
      // The app writes its receipt for this Save asynchronously (the module's
      // own Save lands after `aiOffice.uniworkSave` resolved — see
      // `readAppSaveReceipt`): poll until a NEW intent file for this Save or the
      // offline binding is there, THEN assert the split held. Reading once raced
      // the app's own Save and failed all four rows of D2-01 in 986-1521 ms.
      const held = await pollUntil(
        async () => readAppSaveReceipt(app, intentBaseline, { documentId }),
        (receipt) => receipt.newIntentFiles > 0 || OFFLINE_SAVE_STATES.includes(receipt.state),
        { boundMs: stepTimeout, intervalMs: pollMs },
      );
      const versions = await listVersions({ apiOrigin, fetchImpl, documentId, token });
      const receipt = held.value;
      const wc = receipt.workingCopy;
      const problems = [];
      if (!held.ok) {
        // the state in quotes: `state=<value>` is redacted as a credential by
        // `redactSignInError`'s key/value rule, and the observed value is the
        // point of this message. `documentIntents` is THIS document's own count
        // (BE-704-404): a new `.rec` of another open document moves `intents`
        // but never the document's own record.
        problems.push(
          `the app held no NEW save intent and no offline state for document ${documentId} (record ${receipt.documentRecord ? digestForReason(receipt.documentRecord) : "none"}) within ${stepTimeout} ms (intents=${receipt.intentFiles}, documentIntents=${receipt.documentIntentFiles}, newIntents=${receipt.newIntentFiles}, binding state "${receipt.state}", baseVersion=${receipt.baseVersion})`,
        );
      }
      if (versions !== baseVersion) problems.push(`the server created a version while the app was offline (${versions}, want ${baseVersion})`);
      if (Number(wc?.binding?.baseVersion ?? 0) !== baseVersion) problems.push(`the offline Save moved the app base (v${wc?.binding?.baseVersion ?? "none"}, want v${baseVersion})`);
      if (problems.length > 0) return { status: "FAIL", reason: problems.join("; ") };
      record.versionCounts.whileCut = versions;
      record.details.offlineEdit = { source: uiEdit ? "app-ui" : "harness-working-copy-write", plan: dirty?.plan ?? "" };
      return {
        editSource: uiEdit ? "app-ui" : "harness-working-copy-write",
        intentFiles: receipt.intentFiles,
        documentIntentFiles: receipt.documentIntentFiles,
        newIntentFiles: receipt.newIntentFiles,
        versionsWhileCut: versions,
      };
    });
    if (aborts("app-offline-save")) return;

    // --- 5. reconnect -> commit -> the web sees the version ------------------
    const reconnect = await runStep("app-reconnect", "app", async () => {
      const want = await nextVersion();
      await app.restoreLink();
      await app.nudgeSync?.();
      await app.save({ path: record.details.appPath, offline: false });
      // (the count is read before the save: it moves as soon as the commit lands)
      const settled = await pollUntil(
        async () => app.workingCopy(),
        (wc) => wc?.binding?.state === "saved" && Number(wc?.binding?.baseVersion) === want && wc.sha256 === wc.binding?.baseChecksum,
        { boundMs: stepTimeout, intervalMs: pollMs },
      );
      if (!settled.ok) {
        const wc = settled.value ?? {};
        return {
          status: "FAIL",
          reason: `the app did not settle on a saved v${want} receipt after reconnect (state=${wc.binding?.state ?? "none"}, baseVersion=${wc.binding?.baseVersion ?? "none"}, intents=${app.intents().length})`,
        };
      }
      const versions = await listVersions({ apiOrigin, fetchImpl, documentId, token });
      if (versions !== want) return { status: "FAIL", reason: `expected ${want} server versions after the reconnect commit, got ${versions}` };
      const head = await readFrameHeadViaProtocol({ apiOrigin, fetchImpl, documentId, token });
      if (head.versionId !== settled.value.binding.baseVersionId || head.checksum !== settled.value.sha256) {
        return { status: "FAIL", reason: "the app's committed version does not match the server head the web would load" };
      }
      record.versionIds[`v${head.version}`] = head.versionId;
      record.versionCounts.afterReconnect = head.version;
      record.checksums.desktopAfterReconnect = head.checksum;
      record.userSaves.push({ version: head.version, versionId: head.versionId, checksum: head.checksum, source: "app" });
      hooks?.afterAppCommit?.({ version: head.version, versionId: head.versionId, revision: head.revision, checksum: head.checksum, source: "app" });
      return { versionId: head.versionId, version: head.version, checksum: head.checksum, intentsRemaining: app.intents().length };
    });
    if (aborts("app-reconnect")) return;

    const webSees = await runStep("web-sees", "web", async () => {
      const reconnectVersionId = record.versionIds[`v${record.versionCounts.afterReconnect}`];
      const since = (record.details.webSaveAt ?? 0) - 1;
      // ONE deadline for the whole step (BE-704-502): the announce poll, the reload wait and every
      // miss-path diagnostic read draw on this budget. The reads that follow a spent poll used to
      // each open a FRESH `stepTimeout`, so a busy or hung renderer could pin the step for the poll
      // bound plus two more read budgets — and `step()` has no outer wall clock, so this is the bound.
      const deadlineAt = Date.now() + stepTimeout;
      const leftMs = () => Math.max(0, deadlineAt - Date.now());
      // …and the WAITS stop short of it by the reserve the miss diagnostics need (BE-704-502), so a
      // poll or reload wait that never finds what it wants cannot leave the miss unexplained
      const diagnosticReserveMs = Math.min(MISS_DIAGNOSTIC_RESERVE_MS, Math.max(0, Math.floor(stepTimeout / 2)));
      const waitBudgetMs = () => Math.max(0, leftMs() - diagnosticReserveMs);
      const diagnostics = [];
      /**
       * One diagnostic read, only when the step's ONE budget still has time (BE-704-502). The read
       * gets the step's own absolute deadline (so its per-document reads share what is left rather
       * than opening a fresh bound each); a read that could not be started is recorded — with the
       * reason — instead of silently shrinking the miss evidence.
       */
      const diagnosticRead = async (read, run) => {
        const left = leftMs();
        if (left <= 0) {
          diagnostics.push({ read, started: false, budgetMs: 0, reason: `the ${read} read was not started: the web-sees step's ${stepTimeout} ms budget was spent` });
          return null;
        }
        const value = await run(deadlineAt).catch(() => null);
        // every per-document read that expired or failed is on the record too: the audit counts
        // them, a surface report carries its own `error`, and the frame evidence its `readError`
        const documents = Array.isArray(value) ? value : value?.documents ?? null;
        const errors = documents ? documents.map((d) => d?.error ?? d?.readError).filter((e) => typeof e === "string" && e) : [];
        diagnostics.push({
          read,
          started: true,
          budgetMs: left,
          frames: documents ? documents.length : value?.frames ?? 0,
          readErrors: value?.readErrors ?? errors.length,
          readErrorReasons: (value?.readErrorReasons ?? errors).slice(0, 3),
        });
        return value;
      };
      /** The reads this step never made, for the miss reason (BE-704-502). */
      const unreadDiagnostics = () => {
        const spent = diagnostics.filter((d) => !d.started).map((d) => d.reason);
        return spent.length > 0 ? `; diagnostics left unread: ${spent.join("; ")}` : "";
      };
      const announced = await pollUntil(
        // the poll passes its OWN remaining budget down to the frame reads (BE-704-405), so N
        // frames read on one wave can never overrun this poll's bound — and that bound is what is
        // LEFT of this step's one deadline (BE-704-502)
        async (pollDeadlineMs) => web.announcements({ sinceMs: Math.max(0, since), deadlineMs: pollDeadlineMs }),
        (list) => Array.isArray(list) && list.some((m) => m.versionId === reconnectVersionId),
        { boundMs: waitBudgetMs(), intervalMs: pollMs },
      );
      const match = (announced.value ?? []).find((m) => m.versionId === reconnectVersionId) ?? null;
      if (!match) {
        // What was read, measured (D3-01): the round-3 wording guessed at office_sync_feed,
        // whose server default is true and which was never read, where the artifact could
        // have carried these numbers instead.
        const audit = await diagnosticRead("frameAudit", (deadlineMs) =>
          typeof web.frameAudit === "function" ? web.frameAudit({ deadlineMs }) : null,
        );
        const measured = audit
          ? ` (${audit.frames} document(s) read, ${audit.recorders} carried the message recorder, ${audit.events} protocol event(s) received: ${audit.types.slice(0, 4).join(", ") || "none"}${audit.readErrors ? `, ${audit.readErrors} frame read(s) failed: ${audit.readErrorReasons?.[0] ?? "unknown"}` : ""})`
          : "";
        record.details.webSeesMiss = { announced: null, diagnostics };
        return {
          status: "FAIL",
          reason: `the web host announced no doc.remoteVersion for ${reconnectVersionId} within ${stepTimeout} ms${measured}${unreadDiagnostics()}`,
        };
      }
      // D4-01: a CLEAN frame reloads itself on the announce, but a dirty one shows the S6 bar
      // and reloads only when its own action (and that dialog's Reload confirm) is clicked, in
      // the FRAME's document. Drive the click first when a bar is up, then wait for the open.
      const reloadClick =
        typeof web.clickReload === "function"
          ? await web.clickReload({ versionId: reconnectVersionId }).catch((err) => ({ clicked: false, reason: err.message }))
          : null;
      // The window opens at the ANNOUNCE's own timestamp, not at this instant (D5-01) and not at
      // the instant the click returned (BE-704-401): a clean frame reloads as soon as the announce
      // lands, so its GET can be recorded while the click is still in flight and is still the reload.
      // BE-704-501: the freshness floor is the announce ITSELF — no tolerance is subtracted from the
      // anchor, so a matching GET recorded even 1 ms before it is a stale open. The postMessage ->
      // host -> `api.open` hop is allowed on the COMPLETION deadline only, never on the floor; and
      // what is left of this step's one budget is what the wait may still spend (BE-704-502).
      const reload = await web.waitForReload({
        versionId: reconnectVersionId,
        sinceMs: Number(match.at ?? 0),
        timeoutMs: waitBudgetMs() + ANNOUNCE_OPEN_TOLERANCE_MS,
      });
      // BE-704-402: the fresh open of the ANNOUNCED version id is what confirms the reload — the
      // click itself never claims it (`clickReload` only drives the fork's own discard choice).
      const confirmed = reload?.reloaded === true && reload.versionId === reconnectVersionId;
      if (!reload?.reloaded) {
        // what the frame SHOWED, measured: the bar it left un-clicked, the dialog waiting
        const surface = await diagnosticRead("frameSurface", (deadlineMs) =>
          typeof web.frameSurface === "function" ? web.frameSurface({ deadlineMs }) : null,
        );
        const shown = (surface ?? [])
          .filter((r) => !/^about:blank$/.test(r.url))
          .slice(0, 3)
          .map((r) => {
            if (r.error) return `a document's surface could not be read (${r.error})`;
            // the state in quotes: `state=<value>` is redacted as a credential by
            // `redactSignInError`'s key/value rule (the offline-save reason quotes it too)
            if (r.host) return `host(state "${r.host.state ?? "none"}", dirty=${r.host.dirty ?? "unknown"})`;
            return `bar="${r.surface?.bar || "none"}" actions=${JSON.stringify(r.surface?.actions ?? [])} dialog=${
              r.surface?.dialog ? JSON.stringify(r.surface.choices ?? []) : "none"
            }`;
          })
          .join("; ");
        // What the frame HELD and HEARD, measured in its own realm (D5-01), and which of the
        // pin's guards those values fail. Round 5 asserted "the frame's own guard needs a
        // DECIMAL revision" without measuring anything; the announce's own JS type is recorded
        // now, so the reason names only what the values prove.
        const evidence = await diagnosticRead("frameEvidence", (deadlineMs) =>
          typeof web.frameEvidence === "function" ? web.frameEvidence({ versionId: reconnectVersionId, deadlineMs }) : null,
        );
        const verdict = evidence?.verdict ?? null;
        const realm = evidence?.announceRealm
          ? `received in ${evidence.announceRealm.isTop ? "the TOP page" : "a frame"}`
          : "recorded in no document";
        const held = evidence?.held
          ? `the frame holds fileId ${evidence.held.fileId} at revision ${JSON.stringify(evidence.held.revisionOf ?? null)} (${evidence.held.envelope})`
          : "the frame's held file was not measured";
        const verdictText = verdict
          ? verdict.guard
            ? `dropped by ${verdict.guard} — ${verdict.detail}`
            : verdict.detail
          : "the frame's own realm was not read";
        if (evidence) {
          record.details.webSeesMiss = {
            announced: match,
            reloadClick,
            announceRealm: evidence.announceRealm,
            announceTypes: evidence.announce
              ? {
                  document_id: evidence.announce.documentIdType,
                  revision: evidence.announce.revisionType,
                  version_id: evidence.announce.versionIdType,
                  saved_at: evidence.announce.savedAtType,
                }
              : null,
            held: evidence.held,
            verdict,
            documents: evidence.documents,
            opens: { seen: reload?.opensSeen ?? 0, beforeTheAnnounce: reload?.opensBefore ?? 0 },
            diagnostics,
          };
        } else {
          record.details.webSeesMiss = { announced: match, reloadClick, opens: { seen: reload?.opensSeen ?? 0, beforeTheAnnounce: reload?.opensBefore ?? 0 }, diagnostics };
        }
        return {
          status: "FAIL",
          reason: `the web frame did not reload the announced version: ${reload?.reason ?? "no reload"} (announced version_id ${match.versionId} revision ${
            match.revision ?? "none"
          }${match.revisionType ? ` as ${match.revisionType}` : ""}, ${realm}; ${held}; the guard the measured values fail: ${verdictText}; S6 reload click: ${
            reloadClick?.clicked
              ? `clicked "${reloadClick.label ?? ""}" in the ${reloadClick.frame} frame${
                  reloadClick.choseDiscard === true
                    ? " and made the discard choice"
                    : ` but never made the discard choice (${reloadClick.reason ?? "no confirm"})`
                }`
              : reloadClick?.reason ?? "not attempted"
          }${shown ? `; frame surface: ${shown}` : ""}${unreadDiagnostics()})`,
        };
      }
      const head = await web.fetchHeadViaFrameRoute();
      if (head.sha256 !== record.checksums.desktopAfterReconnect || head.versionId !== reconnectVersionId) {
        return {
          status: "FAIL",
          reason: `the web content checksum is not the desktop's committed checksum (web ${head.sha256} v${head.versionId}, desktop ${record.checksums.desktopAfterReconnect} v${reconnectVersionId})`,
        };
      }
      record.checksums.webContent = head.sha256;
      record.details.webSees = {
        announced: match,
        reloadWindowFrom: Number(match.at ?? 0),
        reloadClick,
        reload: { versionId: reload.versionId, version: reload.version },
        // the confirmation is the fresh open of the ANNOUNCED version id (BE-704-402), never the click
        confirmed,
        webContentSha256: head.sha256,
      };
      return { versionId: reload.versionId, announcedVersionId: match.versionId, webContentSha256: head.sha256 };
    });
    if (aborts("web-sees")) return;

    // --- 6. AI turn + Save (G7-A01.5, G7-A01 only) ---------------------------
    if (row === "G7-A01") {
      const aiTurn = await runStep("ai-turn", "protocol", async () => {
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
      if (aborts("ai-turn")) return;

      const aiSave = await runStep("ai-save", "app", async () => {
        const want = await nextVersion();
        const standIn = kind === "sheets" ? buildXlsxRevenueWithXyzBytes(repoRoot).bytes : buildEditedDocxFixtureBytes(repoRoot).v2Bytes;
        // (the count is read before the save: it moves as soon as the commit lands)
        record.uiEdits.aiSave = "standin";
        record.notes.push(
          "the AI turn is a document-route protocol call (contract-p0 A10); the Save after it stores the format's deterministic stand-in bytes for the AI edit (uiEdits.aiSave=standin) — the fork's AI-panel wiring is not driven by this harness",
        );
        const saved = await app.save({ path: record.details.appPath, offline: false, standInBytes: standIn });
        if (saved?.reason) return { status: "FAIL", reason: saved.reason };
        // The commit and the binding both land after the IPC Save resolves
        // (D2-01): poll the server head and the app's own receipt together,
        // like `app-reload` and `app-reconnect` poll their own settle.
        const settled = await pollUntil(
          async () => ({
            head: await readFrameHeadViaProtocol({ apiOrigin, fetchImpl, documentId, token }),
            wc: app.workingCopy(),
          }),
          (seen) =>
            seen.head?.version === want &&
            Number(seen.wc?.binding?.baseVersion ?? 0) === want &&
            seen.wc?.sha256 === seen.head?.checksum,
          { boundMs: stepTimeout, intervalMs: pollMs },
        );
        if (!settled.ok) {
          const seen = settled.value ?? {};
          // the measured checksums are part of the reason (BE-704-305): with only
          // the versions, a delayed commit and a working copy that is not the
          // committed bytes read the same
          return {
            status: "FAIL",
            reason: `the Save after the AI turn did not create exactly one version (server v${seen.head?.version ?? "none"}, app v${seen.wc?.binding?.baseVersion ?? "none"}, want v${want}, serverChecksum=${digestForReason(seen.head?.checksum)}, appChecksum=${digestForReason(seen.wc?.sha256)})`,
          };
        }
        const head = settled.value.head;
        record.versionIds[`v${head.version}`] = head.versionId;
        record.versionCounts.afterAiSave = head.version;
        record.userSaves.push({ version: head.version, versionId: head.versionId, checksum: head.checksum, source: "app" });
        return { versionId: head.versionId, version: head.version, checksum: head.checksum };
      });
      if (aborts("ai-save")) return;
    }

    // --- 7. both hosts on the same result (G7-A01.6 / G5-A03.2) -------------
    await runStep("final-shas", "protocol", async () => {
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
