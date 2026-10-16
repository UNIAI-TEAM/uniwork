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
  const best = seen.find((s) => (version === null ? true : s.version === version)) ?? seen[0] ?? null;
  return {
    visible: seen.length > 0 && actions.length > 0,
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
  return { visible: true, version: probe.version, text: probe.text, where: editorKindOfUrl(page.url()) ?? "shell" };
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
export function readAppSaveReceipt(app) {
  const workingCopy = app.workingCopy();
  return {
    workingCopy,
    intentFiles: app.intents().length,
    state: String(workingCopy?.binding?.state ?? workingCopy?.bindingState ?? "none"),
    baseVersion: Number(workingCopy?.binding?.baseVersion ?? 0),
  };
}

// ---- the real web host controller (D web page + the pinned frame) ---------------------------

const FRAME_OPEN_PATH = /^\/api\/v1\/office-frame\/documents\/[^/]+$/;

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
 * `readFrameMessages` in every document and merging with
 * `summarizeFrameRecordings` sees it whichever realm the call resolved in.
 *
 * This function is serialized into the page: keep it self-contained (no
 * module-scope constants), the way `readRemoteNewerSurface` now is.
 */
export function installFrameRecorder(target = window) {
  const list = [];
  // the newest 1000 envelopes: a run's frame traffic is far below it, and the document is
  // replaced when the frame reloads
  const limit = 1000;
  Object.defineProperty(target, "__crossHostFrameMessages", { value: list, configurable: true });
  target.addEventListener("message", (event) => {
    try {
      const data = event?.data;
      if (!data || typeof data !== "object" || typeof data.type !== "string") return;
      const payload = data.payload ?? {};
      list.push({
        kind: typeof data.kind === "string" ? data.kind : null,
        type: data.type,
        versionId: payload.version_id ?? null,
        version: payload.version ?? null,
        revision: payload.revision ?? null,
        reason: payload.reason ?? null,
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
 * The web host's own announcements, merged from every document's recorder, plus
 * the shape of what was read: how many documents the page had, how many carried
 * the recorder, and which protocol envelopes appeared at all (D3-01). Reading
 * the top page alone reported "nothing was captured" whether or not the host
 * announced; these numbers say which of the two it was.
 */
export function summarizeFrameRecordings(reports = [], sinceMs = 0) {
  const announcements = [];
  const types = new Map();
  let recorders = 0;
  let events = 0;
  for (const report of reports ?? []) {
    const messages = Array.isArray(report?.messages) ? report.messages : null;
    if (messages) recorders += 1;
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
    types: [...types.entries()].map(([key, count]) => `${key} x${count}`),
  };
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

    /**
     * What every document of this page received (D3-01). A document whose recorder
     * never ran, or a frame that went away mid-read, reports `messages: null` — a
     * measured fact the miss reason counts rather than hides.
     */
    const frameReports = async () => {
      const reports = [];
      for (const frame of web.page.frames()) {
        reports.push({
          url: frame.url(),
          messages: await frame.evaluate(readFrameMessages).catch(() => null),
        });
      }
      return reports;
    };

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
        // every document's recorder is read: the host posts to the frame's window (D3-01)
        return summarizeFrameRecordings(await frameReports(), sinceMs).announcements;
      },
      /** The same merge with the shape of what was read, for a miss's reason (D3-01). */
      async frameAudit() {
        return summarizeFrameRecordings(await frameReports(), 0);
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
  await aiOffice("accountLogout", [{ confirmed: true }]);
  return { signedOut: true, state: status.state };
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
    async clickReload() {
      const { page, probe, probeErrors } = await findRemoteNewerPage(null);
      if (!page) return { clicked: false, reason: remoteNewerMissReason(null, probeErrors) };
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
        }
        if (problems.length > 0) return { status: "FAIL", reason: problems.join("; ") };
        record.details.remoteNewerBar = noticed.value;
        return { bar: noticed.value, workingCopySha256: wc.sha256, feedNudges: nudges };
      });
      if (aborts("dirty-kept")) return;

      // --- discard/reload the dirty edit to continue ------------------------
      const appReload = await runStep("app-reload", "app-ui", async () => {
        const clicked = await app.clickReload();
        if (!clicked?.clicked) {
          return { status: "BLOCKED", blocker: `the S6 reload action could not be driven: ${clicked?.reason ?? "unknown"}`, owner: BLOCKED_OWNER };
        }
        const settled = await pollUntil(
          async () => app.workingCopy(),
          (wc) => Number(wc?.binding?.baseVersion) === record.versionCounts.afterWebSave2 && wc.sha256 === record.checksums.webAfterWebSave2,
          { boundMs: stepTimeout, intervalMs: pollMs },
        );
        if (!settled.ok) {
          const wc = settled.value ?? {};
          return {
            status: "FAIL",
            reason: `the app did not settle on v${record.versionCounts.afterWebSave2} after the reload (binding v${wc.binding?.baseVersion ?? "none"}, working copy ${wc.sha256 ?? "none"})`,
          };
        }
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
      const saved = await app.save({ path: record.details.appPath, offline: true, standInBytes: standIn });
      if (saved?.reason) return { status: "FAIL", reason: saved.reason };
      // The app writes its receipt for this Save asynchronously (the module's
      // own Save lands after `aiOffice.uniworkSave` resolved — see
      // `readAppSaveReceipt`): poll until the intent file or the offline binding
      // is there, THEN assert the split held. Reading once raced the app's own
      // Save and failed all four rows of D2-01 in 986-1521 ms.
      const held = await pollUntil(
        async () => readAppSaveReceipt(app),
        (receipt) => receipt.intentFiles > 0 || OFFLINE_SAVE_STATES.includes(receipt.state),
        { boundMs: stepTimeout, intervalMs: pollMs },
      );
      const versions = await listVersions({ apiOrigin, fetchImpl, documentId, token });
      const receipt = held.value;
      const wc = receipt.workingCopy;
      const problems = [];
      if (!held.ok) {
        // the state in quotes: `state=<value>` is redacted as a credential by
        // `redactSignInError`'s key/value rule, and the observed value is the
        // point of this message
        problems.push(
          `the app held no save intent and no offline state for the offline Save within ${stepTimeout} ms (intents=${receipt.intentFiles}, binding state "${receipt.state}", baseVersion=${receipt.baseVersion})`,
        );
      }
      if (versions !== baseVersion) problems.push(`the server created a version while the app was offline (${versions}, want ${baseVersion})`);
      if (Number(wc?.binding?.baseVersion ?? 0) !== baseVersion) problems.push(`the offline Save moved the app base (v${wc?.binding?.baseVersion ?? "none"}, want v${baseVersion})`);
      if (problems.length > 0) return { status: "FAIL", reason: problems.join("; ") };
      record.versionCounts.whileCut = versions;
      record.details.offlineEdit = { source: uiEdit ? "app-ui" : "harness-working-copy-write", plan: dirty?.plan ?? "" };
      return { editSource: uiEdit ? "app-ui" : "harness-working-copy-write", intentFiles: receipt.intentFiles, versionsWhileCut: versions };
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
      const announced = await pollUntil(
        async () => web.announcements({ sinceMs: Math.max(0, since) }),
        (list) => Array.isArray(list) && list.some((m) => m.versionId === reconnectVersionId),
        { boundMs: stepTimeout, intervalMs: pollMs },
      );
      const match = (announced.value ?? []).find((m) => m.versionId === reconnectVersionId) ?? null;
      if (!match) {
        // What was read, measured (D3-01): the round-3 wording guessed at office_sync_feed,
        // whose server default is true and which was never read, where the artifact could
        // have carried these numbers instead.
        const audit = typeof web.frameAudit === "function" ? await web.frameAudit().catch(() => null) : null;
        const measured = audit
          ? ` (${audit.frames} document(s) read, ${audit.recorders} carried the message recorder, ${audit.events} protocol event(s) received: ${audit.types.slice(0, 4).join(", ") || "none"})`
          : "";
        return {
          status: "FAIL",
          reason: `the web host announced no doc.remoteVersion for ${reconnectVersionId} within ${stepTimeout} ms${measured}`,
        };
      }
      const reload = await web.waitForReload({ versionId: reconnectVersionId, timeoutMs: stepTimeout });
      if (!reload?.reloaded) {
        return { status: "FAIL", reason: `the web frame did not reload the announced version: ${reload?.reason ?? "no reload"}` };
      }
      const head = await web.fetchHeadViaFrameRoute();
      if (head.sha256 !== record.checksums.desktopAfterReconnect || head.versionId !== reconnectVersionId) {
        return {
          status: "FAIL",
          reason: `the web content checksum is not the desktop's committed checksum (web ${head.sha256} v${head.versionId}, desktop ${record.checksums.desktopAfterReconnect} v${reconnectVersionId})`,
        };
      }
      record.checksums.webContent = head.sha256;
      record.details.webSees = { announced: match, reload: { versionId: reload.versionId, version: reload.version }, webContentSha256: head.sha256 };
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
          return {
            status: "FAIL",
            reason: `the Save after the AI turn did not create exactly one version (server v${seen.head?.version ?? "none"}, app v${seen.wc?.binding?.baseVersion ?? "none"}, want v${want})`,
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
