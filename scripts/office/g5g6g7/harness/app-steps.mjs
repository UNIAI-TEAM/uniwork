// App-side helpers shared by the G7/G8 harness drivers (moved unchanged from
// g7-10/tracer.mjs for G8-19, UNI-1414): ports.env parsing, the desktop
// precondition, the app's working copy and sync store on disk, the bounded CDP
// step and its timeout diagnostics, the docs-tab close readiness probe, the
// deep-link handoff, and the sanitized desktop sign-in decision.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256Hex } from "./fixture-files.mjs";
import { BLOCKED_EXIT, HARNESS_DEPLOYMENT_ID, handoffEnv, workingCopyDir } from "./lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = resolve(HERE, "../../../..");

export function parseEnvFile(text) {
  return Object.fromEntries(
    String(text)
      .split("\n")
      .filter((line) => line.trim() && !line.trim().startsWith("#"))
      .map((line) => {
        const at = line.indexOf("=");
        return at < 0 ? [line.trim(), ""] : [line.slice(0, at).trim(), line.slice(at + 1).trim()];
      }),
  );
}

export function checkDesktopPrecondition(portsEnv = {}) {
  if (!portsEnv.UNIWORK_USER_DATA || !portsEnv.ELECTRON_BIN || !portsEnv.SHELL_APP_DIR) {
    return {
      ok: false,
      reason:
        "this run did not start the fork app (no UNIWORK_USER_DATA/ELECTRON_BIN/SHELL_APP_DIR in ports.env; HARNESS_SKIP_APP=1)",
    };
  }
  const sessionBin = join(portsEnv.UNIWORK_USER_DATA, "uniwork-auth", "session.bin");
  if (!existsSync(sessionBin)) {
    return {
      ok: false,
      reason:
        "the app is not signed in (no uniwork-auth/session.bin; a headless Linux VM without an unlocked OS keyring cannot keep a desktop session)",
    };
  }
  return { ok: true, reason: "" };
}

/**
 * Lists encrypted `.rec` intent files in the fork's durable sync store:
 * `<userData>/uniwork-sync/store/<deploymentId>/<userId>/intents/*.rec`
 * (`apps/shell/src/main/uniwork-sync/store/paths.ts`, `intent-store.ts`).
 */
export function listAppSyncIntentFiles(userDataDir, deploymentId = HARNESS_DEPLOYMENT_ID, userId = "") {
  if (!userDataDir || !userId) return [];
  const intentsDir = join(userDataDir, "uniwork-sync", "store", deploymentId, userId, "intents");
  if (!existsSync(intentsDir)) return [];
  try {
    return readdirSync(intentsDir).filter((name) => name.endsWith(".rec"));
  } catch {
    return [];
  }
}

export function inspectWorkingCopy({
  userDataDir,
  deploymentId = HARNESS_DEPLOYMENT_ID,
  documentId,
  expectedUserId = null,
  expectedSha256 = "",
}) {
  const root = join(userDataDir, "uniwork-documents", deploymentId);
  if (!existsSync(root)) {
    return {
      bindingPresent: false,
      filePresent: false,
      sha256Match: false,
      bindingState: null,
      binding: null,
      workingCopyFilePath: null,
    };
  }
  const accounts = expectedUserId
    ? [expectedUserId]
    : readdirSync(root, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);

  for (const acc of accounts) {
    const dir = workingCopyDir(userDataDir, deploymentId, acc, documentId);
    const bindingPath = join(dir, "binding.json");
    if (!existsSync(bindingPath)) continue;
    try {
      const binding = JSON.parse(readFileSync(bindingPath, "utf8"));
      const filePath = binding.filename ? join(dir, binding.filename) : null;
      const filePresent = Boolean(filePath && existsSync(filePath));
      const actualSha = filePresent ? sha256Hex(readFileSync(filePath)) : "";
      const sha256Match = expectedSha256 ? actualSha === expectedSha256 && binding.baseChecksum === expectedSha256 : true;
      return {
        bindingPresent: true,
        filePresent,
        sha256Match,
        bindingState: binding.state ?? null,
        bindingError: binding.error ?? null,
        binding,
        workingCopyFilePath: filePath,
      };
    } catch {
      return {
        bindingPresent: false,
        filePresent: false,
        sha256Match: false,
        bindingState: "invalid",
        binding: null,
        workingCopyFilePath: null,
      };
    }
  }
  return {
    bindingPresent: false,
    filePresent: false,
    sha256Match: false,
    bindingState: null,
    binding: null,
    workingCopyFilePath: null,
  };
}

/**
 * Pure decision function for desktop app sign-in (r3, ADDENDUM r5 G1/G3):
 *   * `appStarted: false` — the run never started the fork app (`HARNESS_SKIP_APP=1`,
 *     or a ports.env without `UNIWORK_USER_DATA`/`ELECTRON_BIN`/`SHELL_APP_DIR`) —
 *     is a step that cannot be driven by design: `BLOCKED` (exit 77).
 *   * Once start.sh reported the app up, every way the app can be missing is a
 *     harness or app failure, never a missing precondition: `FAIL` (exit 1) when
 *     the recorded app process is gone (`appProcessAlive === false`), when a CDP
 *     connection was attempted and refused, and when CDP answered but no shell
 *     renderer window exposing `window.aiOffice` was found. Cloud round r3 read
 *     exactly those three as BLOCKED, and the round passed with a false BLOCKED.
 *   * A CDP connection that was never possible (no `APP_CDP_PORT`, no Playwright)
 *     keeps `BLOCKED`: the app cannot be driven headlessly in this run dir.
 *   * The OS keyring being unavailable or locked (`keyringAvailable === false`, or
 *     `accountState` `"keyring-unavailable"` / `"keystore-locked"`) is the other
 *     precondition the VM may genuinely lack: `BLOCKED` (exit 77).
 *   * With a usable keyring, self sign-in must leave BOTH `accountState ===
 *     "signed-in"` (for `expectedUserId`) AND `uniwork-auth/session.bin` on disk
 *     (`sessionBinExists === true`); any failure returns `FAIL` (exit 1).
 *
 * `appProcessAlive` and `keyringAvailable` are tri-state: `null` means the tracer
 * never learned the fact (no pid file / no `accountStatus` read), which is not the
 * same statement as `false` (G3 — the r3 record said `keyringAvailable: false`
 * next to `sessionBinExists: true` on a path that never asked the app).
 */
export function decideAppSignInOutcome({
  appStarted = true,
  appPid = null,
  appProcessAlive = null,
  cdpAttempted = false,
  cdpConnected = true,
  shellWindowFound = null,
  keyringAvailable = null,
  accountState = "unknown",
  sessionBinExists = false,
  signedInUserId = "",
  expectedUserId = "",
  signInError = "",
  blockerReason = "",
}) {
  const appRef = appPid === null || appPid === undefined ? "the pid start.sh recorded" : `pid ${appPid}`;
  if (!appStarted) {
    return {
      exitCode: BLOCKED_EXIT,
      status: "BLOCKED",
      signedIn: false,
      reason:
        blockerReason ||
        "this run did not start the fork app (no UNIWORK_USER_DATA/ELECTRON_BIN/SHELL_APP_DIR in ports.env; HARNESS_SKIP_APP=1)",
    };
  }
  if (appProcessAlive === false) {
    return {
      exitCode: 1,
      status: "FAIL",
      signedIn: false,
      reason: `start.sh reported the app started, but its process is gone at loop start (${appRef}; the run dir's pids file records it, see the run's logs/app.log)${blockerReason ? `; last CDP error: ${blockerReason}` : ""}`,
    };
  }
  if (cdpAttempted && !cdpConnected) {
    return {
      exitCode: 1,
      status: "FAIL",
      signedIn: false,
      reason:
        blockerReason ||
        `the app was started (${appRef} is alive) but its CDP endpoint did not answer; a harness or app failure, not a missing precondition`,
    };
  }
  if (cdpConnected && shellWindowFound === false) {
    return {
      exitCode: 1,
      status: "FAIL",
      signedIn: false,
      reason:
        blockerReason ||
        "connected to Electron CDP but found no shell renderer window exposing window.aiOffice",
    };
  }
  if (!cdpConnected) {
    return {
      exitCode: BLOCKED_EXIT,
      status: "BLOCKED",
      signedIn: false,
      reason:
        blockerReason ||
        "the app's Save cannot be driven headlessly in this run (no CDP connection is possible; ports.env has no APP_CDP_PORT or Playwright is not loadable)",
    };
  }
  if (keyringAvailable === false || accountState === "keyring-unavailable" || accountState === "keystore-locked") {
    return {
      exitCode: BLOCKED_EXIT,
      status: "BLOCKED",
      signedIn: false,
      reason:
        blockerReason ||
        `the app is not signed in (accountStatus.state=${accountState}, no uniwork-auth/session.bin; a headless Linux VM without an unlocked OS keyring cannot keep a desktop session)`,
    };
  }
  if (signInError) {
    return {
      exitCode: 1,
      status: "FAIL",
      signedIn: false,
      reason: `desktop app sign-in failed while the OS keyring was available: ${signInError}`,
    };
  }
  if (accountState !== "signed-in") {
    return {
      exitCode: 1,
      status: "FAIL",
      signedIn: false,
      reason: `desktop app sign-in did not reach accountStatus.state="signed-in" while the OS keyring was available (got state="${accountState}")`,
    };
  }
  if (!sessionBinExists) {
    return {
      exitCode: 1,
      status: "FAIL",
      signedIn: false,
      reason:
        'desktop app reported accountStatus.state="signed-in" while the OS keyring was available, but uniwork-auth/session.bin was not written to disk',
    };
  }
  if (expectedUserId && signedInUserId && signedInUserId !== expectedUserId) {
    return {
      exitCode: 1,
      status: "FAIL",
      signedIn: false,
      reason: `desktop app signed in as ${signedInUserId}, expected seeded user ${expectedUserId}`,
    };
  }
  return {
    exitCode: 0,
    status: "PASS",
    signedIn: true,
    reason: "desktop app is signed in with uniwork-auth/session.bin on disk",
  };
}

export async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

/**
 * The pid start.sh recorded for the app, and whether that process is alive right
 * now (G1). start.sh writes `<name> <pid> <port>` per line into the run dir's
 * `pids` file and stops exactly those groups; the app line is the last word on
 * whether the app the harness started is still there. `null` means unknown (no
 * pid file, or no app line in it) and is never treated as dead: only a pid that
 * is recorded and gone is evidence of a failure.
 */
export function isProcessAlive(pid) {
  if (!Number.isInteger(Number(pid)) || Number(pid) <= 0) return null;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (err) {
    // EPERM means the process exists and belongs to somebody else.
    return err?.code === "EPERM";
  }
}

export function readAppProcessRecord(runDir) {
  if (!runDir) return { appPid: null, appProcessAlive: null, appProcessSource: "no-pid-file" };
  const pidFile = join(runDir, "pids");
  if (!existsSync(pidFile)) return { appPid: null, appProcessAlive: null, appProcessSource: "no-pid-file" };
  let appPid = null;
  try {
    for (const line of readFileSync(pidFile, "utf8").split("\n")) {
      const [name, pid] = line.trim().split(/\s+/);
      if (name === "app" && Number.isInteger(Number(pid))) appPid = Number(pid);
    }
  } catch {
    return { appPid: null, appProcessAlive: null, appProcessSource: "unreadable-pid-file" };
  }
  if (appPid === null) return { appPid: null, appProcessAlive: null, appProcessSource: "no-app-line" };
  return { appPid, appProcessAlive: isProcessAlive(appPid), appProcessSource: "pid-file" };
}

/**
 * What a sign-in error may say in `tracer-loop-N.json` (G710-BE-13). The field
 * is an open channel — the sign-in flow passes a consent callback URL around,
 * and a future error string can embed a token or a credential — so everything
 * that could carry one is dropped and the error class/context is kept:
 *
 *   * a URL becomes `<url>`: its query (a single-use `code`/`state`), its
 *     userinfo and its path go with it;
 *   * a `key=value`/`key: value` pair whose key names a credential or a session
 *     keeps the key and loses the value;
 *   * a bare `Bearer`/`Basic` credential is replaced;
 *   * a long opaque run (32+ characters of token alphabet) is replaced;
 *   * the whole message is truncated to `maxChars` (default 240; a row reason passes a larger cap).
 */
export const SIGN_IN_ERROR_MAX_CHARS = 240;
const SIGN_IN_ERROR_KEY_VALUE =
  /(?<=\b(?:access_token|refresh_token|id_token|token|secret|password|passwd|credential|credentials|authorization|api_?key|csrf_?token|csrf|ticket|attempt_id|code|state)\s*[:=]\s*)[^\s,;&"']+/gi;
const SIGN_IN_ERROR_OPAQUE = /[A-Za-z0-9_-]{32,}/g;

export function redactSignInError(raw, { maxChars = SIGN_IN_ERROR_MAX_CHARS } = {}) {
  let text = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  text = text.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, "<url>");
  text = text.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, (match, scheme) => `${scheme} <redacted>`);
  text = text.replace(SIGN_IN_ERROR_KEY_VALUE, "<redacted>");
  text = text.replace(SIGN_IN_ERROR_OPAQUE, "<redacted>");
  return text.length > maxChars ? `${text.slice(0, maxChars)}...` : text;
}

export const DEFAULT_APP_STEP_TIMEOUT_MS = 90_000;
export const DEFAULT_LOOP_TIMEOUT_MS = 600_000;
export const DEFAULT_DOCS_CLOSE_SETTLE_MS = 2_500;
export const APP_LOG_TAIL_LINES = 40;

export function resolveAppStepTimeoutMs(overrideMs, portsEnv = null) {
  if (Number.isFinite(Number(overrideMs)) && Number(overrideMs) > 0) {
    return Number(overrideMs);
  }
  const fromEnv = Number(process.env.HARNESS_APP_STEP_TIMEOUT_MS);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  const fromPorts = Number(portsEnv?.HARNESS_APP_STEP_TIMEOUT_MS);
  if (Number.isFinite(fromPorts) && fromPorts > 0) return fromPorts;
  return DEFAULT_APP_STEP_TIMEOUT_MS;
}

export function resolveLoopTimeoutMs(overrideMs, portsEnv = null) {
  if (Number.isFinite(Number(overrideMs)) && Number(overrideMs) > 0) {
    return Number(overrideMs);
  }
  const fromEnv = Number(process.env.HARNESS_LOOP_TIMEOUT_MS);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  const fromPorts = Number(portsEnv?.HARNESS_LOOP_TIMEOUT_MS);
  if (Number.isFinite(fromPorts) && fromPorts > 0) return fromPorts;
  return DEFAULT_LOOP_TIMEOUT_MS;
}

export function resolveDocsCloseSettleMs(overrideMs, portsEnv = null) {
  if (overrideMs !== undefined && overrideMs !== null && Number.isFinite(Number(overrideMs)) && Number(overrideMs) >= 0) {
    return Number(overrideMs);
  }
  if (process.env.HARNESS_DOCS_CLOSE_SETTLE_MS !== undefined && process.env.HARNESS_DOCS_CLOSE_SETTLE_MS !== "") {
    const fromEnv = Number(process.env.HARNESS_DOCS_CLOSE_SETTLE_MS);
    if (Number.isFinite(fromEnv) && fromEnv >= 0) return fromEnv;
  }
  if (portsEnv?.HARNESS_DOCS_CLOSE_SETTLE_MS !== undefined && portsEnv?.HARNESS_DOCS_CLOSE_SETTLE_MS !== "") {
    const fromPorts = Number(portsEnv.HARNESS_DOCS_CLOSE_SETTLE_MS);
    if (Number.isFinite(fromPorts) && fromPorts >= 0) return fromPorts;
  }
  return DEFAULT_DOCS_CLOSE_SETTLE_MS;
}

export function formatAppStepTimeoutReason(call, timeoutMs) {
  const seconds = Number((Number(timeoutMs) / 1000).toFixed(3));
  return `${call} did not settle within ${seconds} s`;
}

export function formatDocsTabReadyTimeoutReason(timeoutMs) {
  const seconds = Number((Number(timeoutMs) / 1000).toFixed(3));
  return `docs tab not ready to close within ${seconds} s`;
}

export function sanitizeTargetUrl(rawUrl) {
  const text = String(rawUrl ?? "").trim();
  if (!text) return null;
  try {
    const parsed = new URL(text);
    const safeParams = new URLSearchParams();
    for (const [k, v] of parsed.searchParams.entries()) {
      if (k === "mode") {
        safeParams.set(k, v);
      } else {
        safeParams.set(k, "<redacted>");
      }
    }
    const qs = safeParams.toString();
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}${qs ? `?${qs}` : ""}`;
  } catch {
    return redactSignInError(text);
  }
}

export function readRedactedAppLogTail(runDir, maxLines = APP_LOG_TAIL_LINES) {
  if (!runDir) return [];
  const appLogPath = join(runDir, "logs", "app.log");
  if (!existsSync(appLogPath)) return [];
  try {
    const raw = readFileSync(appLogPath, "utf8");
    const lines = raw.split(/\r?\n/);
    if (lines.length > 0 && lines.at(-1) === "") lines.pop();
    return lines.slice(-maxLines).map((line) => redactSignInError(line));
  } catch {
    return [];
  }
}

export function readBindingSnapshotAtTimeout({
  userDataDir,
  deploymentId = HARNESS_DEPLOYMENT_ID,
  documentId,
  expectedUserId,
}) {
  if (!userDataDir || !documentId) {
    return { bindingState: null, binding: null };
  }
  try {
    const wc = inspectWorkingCopy({
      userDataDir,
      deploymentId,
      documentId,
      expectedUserId,
    });
    if (!wc.bindingPresent || !wc.binding) {
      return { bindingState: null, binding: null };
    }
    return {
      bindingState: wc.bindingState ?? wc.binding?.state ?? null,
      binding: {
        state: wc.binding?.state ?? null,
        baseVersion: wc.binding?.baseVersion ?? null,
        baseRevision: wc.binding?.baseRevision ?? null,
        baseVersionId: wc.binding?.baseVersionId ?? null,
        baseChecksum: wc.binding?.baseChecksum ?? null,
        error: wc.binding?.error ? redactSignInError(wc.binding.error) : null,
      },
    };
  } catch {
    return { bindingState: null, binding: null };
  }
}

/**
 * Runs an app-side CDP call (`connect`, `page.evaluate` of `window.aiOffice.*`,
 * `aiOfficeTabs.close`, etc.) under a bounded race (`HARNESS_APP_STEP_TIMEOUT_MS`,
 * default 90000 ms). On timeout, throws an Error with `isAppStepTimeout = true`
 * and `appStepTimeout` diagnostics (`call`, `elapsedMs`, `bindingState`, `binding`,
 * `appLogTail`).
 */
export async function runBoundedAppStep(
  call,
  fn,
  {
    timeoutMs,
    portsEnv = null,
    runDir = null,
    userDataDir = null,
    deploymentId = HARNESS_DEPLOYMENT_ID,
    documentId = null,
    expectedUserId = null,
  } = {},
) {
  const boundMs = resolveAppStepTimeoutMs(timeoutMs, portsEnv);
  const startedAt = Date.now();
  let timer = null;
  try {
    return await Promise.race([
      Promise.resolve().then(fn),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const elapsedMs = Math.max(boundMs, Date.now() - startedAt);
          const reason = formatAppStepTimeoutReason(call, boundMs);
          const { bindingState, binding } = readBindingSnapshotAtTimeout({
            userDataDir: userDataDir ?? portsEnv?.UNIWORK_USER_DATA ?? null,
            deploymentId,
            documentId,
            expectedUserId,
          });
          const appLogTail = readRedactedAppLogTail(runDir, APP_LOG_TAIL_LINES);
          const err = new Error(reason);
          err.isAppStepTimeout = true;
          err.appStepTimeout = {
            call,
            timeoutMs: boundMs,
            elapsedMs,
            reason,
            bindingState,
            binding,
            appLogTail,
          };
          reject(err);
        }, boundMs);
      }),
    ]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

/**
 * Waits (bounded by `HARNESS_APP_STEP_TIMEOUT_MS`) until the open docs tab's
 * `WebContentsView` renderer is ready to answer `docsQueryDirty`'s
 * `'docs:close-check'` IPC (`apps/docs/src/main/docs-main.ts:6288-6308`), and then
 * settles for `HARNESS_DOCS_CLOSE_SETTLE_MS` (default `2500` ms, longer than the
 * fork's 2 s `docsQueryDirty` timer at `apps/docs/src/main/docs-main.ts:6293`) with
 * the renderer still ready before `aiOfficeTabs.close` is called (Finding H2, ADDENDUM r7b H2-1).
 *
 * Fork root cause (`ab12238f`):
 *   - `TabManager.closeTab` -> `confirmTabClose` (`apps/shell/src/main/tab-manager.ts:893-929`)
 *     calls `docsQueryDirty` (`apps/docs/src/main/docs-main.ts:6288-6308`), which sends
 *     `wc.send('docs:close-check')` (`docs-main.ts:6300`) and waits 2 s (`docs-main.ts:6293`).
 *   - If the docs renderer (`genoffice-app://docs/index.html?mode=tab`,
 *     `apps/docs/src/main/docs-main.ts:6425`) has not finished `loadFile(pending)`
 *     (`apps/docs/src/renderer/App.tsx:2242-2256`) and mounted its close-guard
 *     `useEffect` (`window.desktop.onCloseCheck`, `App.tsx:5334-5362`), `docsQueryDirty`
 *     fails closed with `{ dirty: true, autoSave: false, unresponsive: true }`
 *     (`docs-main.ts:6295`) and `performDocsClose` (`docs-main.ts:6355-6376`) opens
 *     a native `dialog.showMessageBox` (`closeNoReplyMsg`: Close Anyway / Cancel) on
 *     the headless Xvfb display where nothing clicks it.
 *   - In addition, the shell's 1 s `editor-state-poll.ts` (`apps/shell/src/main/uniwork-docs/editor-state-poll.ts:12,56-84`)
 *     calls `docsQueryEditorDirty`, which shares `closeStateQueries` (`docs-main.ts:6248,6289-6291`)
 *     with `docsQueryDirty`: any `'docs:close-check'` sent before `onCloseCheck` mounted is
 *     never answered and takes 2 s (`docs-main.ts:6293`) to expire.
 *
 * Positive readiness signal on the docs `WebContentsView` target (never calling
 * `window.desktop.reportCloseCheck`, so the harness never speaks for the product):
 *   1. `document.readyState === "complete"`
 *   2. `typeof window.desktop?.onCloseCheck === "function"` and
 *      `typeof window.desktop?.reportCloseCheck === "function"`
 *      (`apps/docs/src/preload/index.ts:246-261,277`)
 *   3. `!document.querySelector(".start-booting")` (`apps/docs/src/renderer/App.tsx:7519`
 *      while `doc === null`; `<EditorContent editor={editor} />` at `App.tsx:7438` once
 *      `doc !== null`)
 *   4. `window.__genofficeControl({ cmd: "selection" })?.status === "ok"` and
 *      `Boolean(window.__aidocs?.editor)` (`apps/docs/src/renderer/App.tsx:6198-6215`,
 *      `apps/docs/src/renderer/control.ts:16-21`, which commits after the `onCloseCheck`
 *      effect at `App.tsx:5334-5362` and returns `status: "ok"` only when `editor` and
 *      `doc !== null` are both ready).
 *   5. After checks 1-4 pass, waits out any pre-mount query in `closeStateQueries` by
 *      settling for `HARNESS_DOCS_CLOSE_SETTLE_MS` (default `2500` ms > `2000` ms at
 *      `docs-main.ts:6293`) and re-verifying checks 1-4 still hold before returning.
 */
export async function waitForDocsTabReadyToClose({
  browser,
  shellPage = null,
  filePath = null,
  timeoutMs,
  settleMs,
  portsEnv = null,
  runDir = null,
  userDataDir = null,
  deploymentId = HARNESS_DEPLOYMENT_ID,
  documentId = null,
  expectedUserId = null,
  pollIntervalMs = 50,
} = {}) {
  const boundMs = resolveAppStepTimeoutMs(timeoutMs, portsEnv);
  const requiredSettleMs = resolveDocsCloseSettleMs(settleMs, portsEnv);
  const startedAt = Date.now();
  const deadline = startedAt + boundMs;
  let lastTargetUrl = null;
  let readySinceMs = null;

  const probeCandidate = async (candidate, remainingMs) => {
    let evalTimer = null;
    return Promise.race([
      Promise.resolve().then(() =>
        candidate.evaluate((_expectedFilePath) => {
          if (typeof window === "undefined") return { isDocsTarget: false, ready: false };
          const href = String(window.location?.href ?? "");
          const hasDesktopCloseBridge =
            typeof window.desktop?.onCloseCheck === "function" &&
            typeof window.desktop?.reportCloseCheck === "function";
          const isDocsUrl = href.includes("genoffice-app://docs") || href.includes("/docs/");
          if (!hasDesktopCloseBridge && !isDocsUrl) {
            return { isDocsTarget: false, ready: false, url: href };
          }
          const docObj = window.document ?? globalThis.document ?? null;
          const readyStateComplete =
            !docObj || typeof docObj.readyState !== "string" || docObj.readyState === "complete";
          const bootingEl =
            docObj && typeof docObj.querySelector === "function"
              ? docObj.querySelector(".start-booting")
              : null;
          const controlProbe =
            typeof window.__genofficeControl === "function"
              ? window.__genofficeControl({ cmd: "selection" })
              : null;
          const controlReady =
            controlProbe?.status === "ok" && Boolean(window.__aidocs?.editor);
          const ready = Boolean(
            readyStateComplete && hasDesktopCloseBridge && !bootingEl && controlReady,
          );
          return {
            isDocsTarget: true,
            ready,
            url: href,
          };
        }, filePath),
      ),
      new Promise((resolve) => {
        evalTimer = setTimeout(() => resolve(null), Math.min(remainingMs, 1_500));
      }),
    ])
      .catch(() => null)
      .finally(() => {
        if (evalTimer !== null) clearTimeout(evalTimer);
      });
  };

  while (Date.now() < deadline) {
    let sawReadyThisPass = false;
    const contexts = typeof browser?.contexts === "function" ? browser.contexts() : [];
    for (const ctx of contexts) {
      const pages = typeof ctx?.pages === "function" ? ctx.pages() : [];
      for (const candidate of pages) {
        if (!candidate || candidate === shellPage) continue;
        let rawUrl = "";
        try {
          rawUrl = typeof candidate.url === "function" ? String(candidate.url() ?? "") : "";
        } catch {
          rawUrl = "";
        }
        if (rawUrl && (rawUrl.includes("docs") || !lastTargetUrl)) {
          lastTargetUrl = sanitizeTargetUrl(rawUrl);
        }
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) break;
        const probe = await probeCandidate(candidate, remainingMs);

        if (probe?.url && (probe.isDocsTarget || !lastTargetUrl)) {
          lastTargetUrl = sanitizeTargetUrl(probe.url);
        }
        if (probe?.ready) {
          sawReadyThisPass = true;
          const now = Date.now();
          if (readySinceMs === null) {
            readySinceMs = now;
          }
          if (now - readySinceMs >= requiredSettleMs) {
            return {
              ready: true,
              targetUrl: sanitizeTargetUrl(probe.url || rawUrl || ""),
              elapsedMs: now - startedAt,
              settledMs: now - readySinceMs,
            };
          }
        }
      }
    }
    if (!sawReadyThisPass) {
      readySinceMs = null;
    }
    const leftMs = deadline - Date.now();
    if (leftMs <= 0) break;
    const settleLeftMs =
      readySinceMs !== null ? Math.max(1, requiredSettleMs - (Date.now() - readySinceMs)) : pollIntervalMs;
    await sleep(Math.min(pollIntervalMs, settleLeftMs, leftMs));
  }

  const elapsedMs = Math.max(boundMs, Date.now() - startedAt);
  const reason = formatDocsTabReadyTimeoutReason(boundMs);
  const { bindingState, binding } = readBindingSnapshotAtTimeout({
    userDataDir: userDataDir ?? portsEnv?.UNIWORK_USER_DATA ?? null,
    deploymentId,
    documentId,
    expectedUserId,
  });
  const appLogTail = readRedactedAppLogTail(runDir, APP_LOG_TAIL_LINES);
  const err = new Error(reason);
  err.isAppStepTimeout = true;
  err.owner = "g5-client";
  err.ownerCandidate = "g5-client";
  err.appStepTimeout = {
    call: "docsTabReadyToClose",
    timeoutMs: boundMs,
    elapsedMs,
    reason,
    targetUrl: lastTargetUrl,
    bindingState,
    binding,
    appLogTail,
    owner: "g5-client",
    ownerCandidate: "g5-client",
  };
  throw err;
}

export function loadPlaywrightChromium(repoRoot = DEFAULT_REPO_ROOT) {
  try {
    const req = createRequire(join(repoRoot, "e2e", "package.json"));
    return req("@playwright/test").chromium;
  } catch {
    try {
      const req = createRequire(import.meta.url);
      return req("playwright").chromium;
    } catch {
      return null;
    }
  }
}

export function deliverDeepLink(portsEnv, deepLink) {
  const childEnv = handoffEnv(portsEnv);
  return spawnSync(
    portsEnv.ELECTRON_BIN,
    ["--no-sandbox", "--disable-gpu", "--password-store=gnome-libsecret", portsEnv.SHELL_APP_DIR, deepLink],
    { env: childEnv, timeout: 20_000, encoding: "utf8" },
  );
}

/**
 * Builds the sanitized desktop sign-in decision record (`F3`, ADDENDUM r5 G1/G3)
 * for `tracer-loop-N.json`. Never includes any session token, password, or secret:
 * `signInError` goes through `redactSignInError` (G710-BE-13).
 *
 * `appPid` / `appProcessAlive` are the run's own PID-file record (G1), and
 * `cdpAttempted` / `cdpConnected` / `shellWindowFound` say which of the three
 * failures the decision saw. `keyringAvailable` is tri-state: `true`/`false` only
 * when the app itself reported it through `accountStatus()`, `null` when the
 * tracer never reached the app (G3) — the r3 record read
 * `keyringAvailable: false` with `sessionBinExists: true`, which is not a
 * combination the app can report: `session.bin` is written only while a real
 * keyring is there (`apps/shell/src/main/uniwork-auth/credentials.ts`,
 * `ensureAvailable`), and an app that cannot open the keyring keeps the file and
 * reports `keyring-unavailable` — the `false` in that record came from the
 * tracer's CDP-failure path, which never asked.
 */
export function buildSanitizedAppSignInRecord(rawInput = {}) {
  const triState = (value) => (value === undefined || value === null ? null : Boolean(value));
  const decisionInput = {
    appStarted: Boolean(rawInput.appStarted),
    appPid: Number.isInteger(Number(rawInput.appPid)) && Number(rawInput.appPid) > 0 ? Number(rawInput.appPid) : null,
    appProcessAlive: triState(rawInput.appProcessAlive),
    cdpAttempted: Boolean(rawInput.cdpAttempted),
    cdpConnected: Boolean(rawInput.cdpConnected),
    shellWindowFound: triState(rawInput.shellWindowFound),
    keyringAvailable: triState(rawInput.keyringAvailable),
    accountState: String(rawInput.accountState ?? "unknown"),
    sessionBinExists: Boolean(rawInput.sessionBinExists),
    signedInUserId: String(rawInput.signedInUserId ?? ""),
    expectedUserId: String(rawInput.expectedUserId ?? ""),
    signInError: redactSignInError(rawInput.signInError ?? ""),
    blockerReason: String(rawInput.blockerReason ?? ""),
  };
  const out = decideAppSignInOutcome(decisionInput);
  return {
    accountStatusState: decisionInput.accountState,
    sessionBinExists: decisionInput.sessionBinExists,
    decisionInput,
    decisionResult: {
      exitCode: out.exitCode,
      status: out.status,
      signedIn: Boolean(out.signedIn),
      reason: String(out.reason ?? ""),
    },
  };
}

/**
 * The desktop consent sign-in (moved from g7-10/tracer.mjs
 * connectAppController for G8-19, UNI-1414): asks the app for the login URL
 * (`aiOffice.accountLogin` + `onAccountLogin`), approves the attempt through
 * the consent API as the caller's user (`callApi(name, {query, body})` ->
 * `{data}`), hands the callback deep link to the app and waits up to 15 s for
 * `signed-in` with `uniwork-auth/session.bin` on disk (or a keyring state).
 * Every status read is reported through `onStatus`; returns the last one.
 */
export async function runDesktopConsentSignIn({
  page,
  runAppCdp,
  callApi,
  deepLinkDeliverer,
  portsEnv,
  sessionBinPath,
  status = null,
  onStatus = () => {},
}) {
  const authUrl = await runAppCdp("aiOffice.accountLogin", () =>
    page.evaluate(
      () =>
        new Promise((resolveUrl, rejectUrl) => {
          const timer = setTimeout(() => rejectUrl(new Error("accountLogin url timeout")), 15_000);
          const off = window.aiOffice.onAccountLogin((ev) => {
            if (ev && ev.phase === "url" && ev.url) {
              clearTimeout(timer);
              off();
              resolveUrl(ev.url);
            } else if (ev && ev.phase === "error") {
              clearTimeout(timer);
              off();
              rejectUrl(new Error(`accountLogin error: ${ev.error}`));
            }
          });
          window.aiOffice.accountLogin().catch((err) => {
            clearTimeout(timer);
            off();
            rejectUrl(err);
          });
        }),
    ),
  );
  const attemptId = new URL(authUrl).searchParams.get("attempt_id");
  if (!attemptId) {
    throw new Error(`accountLogin URL carried no attempt_id: ${authUrl}`);
  }
  const consentGet = await callApi("getDesktopConsent", { query: { attempt_id: attemptId } });
  const csrfToken = consentGet.data?.csrf_token ?? "";
  if (!csrfToken) {
    throw new Error("getDesktopConsent returned no csrf_token");
  }
  const consentPost = await callApi("submitDesktopConsent", {
    body: { attempt_id: attemptId, csrf_token: csrfToken, decision: "approve" },
  });
  const callbackUrl = consentPost.data?.callback_url ?? consentPost.data?.redirect_url ?? "";
  if (!callbackUrl) throw new Error("submitDesktopConsent returned no callback_url");
  const handoff = deepLinkDeliverer(portsEnv, callbackUrl);
  if (handoff?.error || (typeof handoff?.status === "number" && handoff.status !== 0)) {
    throw new Error(
      `callback deep-link handoff failed (exit ${handoff?.status ?? "err"}): ${handoff?.stderr || handoff?.error?.message || ""}`.trim(),
    );
  }
  const signDeadline = Date.now() + 15_000;
  while (Date.now() < signDeadline) {
    status = await runAppCdp("aiOffice.accountStatus", () =>
      page.evaluate(() => window.aiOffice.accountStatus()),
    );
    onStatus(status);
    if (status?.state === "signed-in" && existsSync(sessionBinPath)) break;
    if (status?.state === "keyring-unavailable" || status?.state === "keystore-locked") break;
    await sleep(250);
  }
  return status;
}
