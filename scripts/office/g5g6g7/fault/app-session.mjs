/* global process, window, document */
// The Electron side of the app-layer fault runner (UNI-1380, WI-4): one fork
// app instance this runner starts itself, pointed at the FAULT PROXY (not at
// the D server the harness app talks to), on its own userData dir, with the
// fork's G7-03a test hooks on (intent trace, queue timer overrides).
//
// It drives the app the way the fork's own e2e does (e2e/helpers.ts,
// e2e/uniwork-documents.spec.ts): Playwright's Electron launcher, the shell's
// `window.aiOffice` frame API (accountLogin, uniworkOpenDocument,
// uniworkDocStatus), the docs editor's `__aidocs` handle and the sheets canvas.
// The sign-in's browser leg is replaced by the consent API of the D server,
// approved as the app's account (app-tenant.mjs); the callback reaches the app
// the real way, as a second instance with the URL in argv.
//
// Nothing here kills by name: a crash kills exactly the process tree of the
// Electron this module launched (its pid and every descendant of it), only while
// that pid is still this runner's own child, and never a pid or process group
// the harness recorded in its pids file (app-process-guard.mjs, FIX-6).

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appEnv } from "../harness/lib.mjs";
import { attemptIdFromAuthorizationUrl, faultAppExtraEnv } from "./app-cases-lib.mjs";
import { crashTargets, harnessPidsFromFile, ownGroupTarget } from "./app-process-guard.mjs";
import { approveDesktopAttempt } from "./app-tenant.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A precondition of the VM, not a product claim: the case is BLOCKED, never FAIL. */
export class AppBlocked extends Error {}

/** Polls `probe` until it returns a truthy value or `timeoutMs` passes (then null). */
export async function waitFor(probe, timeoutMs, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe().catch(() => null);
    if (value) return value;
    if (Date.now() > deadline) return null;
    await sleep(intervalMs);
  }
}

/**
 * Launches the fork app. `ports` is the harness run's ports.env (Electron
 * binary, app dir, display); `options.extra` adds env to the fault env.
 */
export async function launchApp({ playwright, ports, proxyOrigin, userDataDir, traceFile, stuckAfterMs, recheckMs, logFile, harnessPidFile = null }) {
  mkdirSync(userDataDir, { recursive: true });
  const settings = join(userDataDir, "app-settings.json");
  if (!existsSync(settings)) writeFileSync(settings, JSON.stringify({ onboardingSeen: true }));
  const env = appEnv({
    apiOrigin: proxyOrigin,
    userDataDir,
    extra: faultAppExtraEnv({ traceFile, stuckAfterMs, recheckMs, display: ports.DISPLAY, xauthority: ports.XAUTHORITY }),
  });
  const app = await playwright._electron.launch({
    executablePath: ports.ELECTRON_BIN,
    args: ["--no-sandbox", "--disable-gpu", "--password-store=gnome-libsecret", ports.SHELL_APP_DIR],
    env,
    timeout: 90_000,
  });
  const proc = app.process();
  if (logFile) {
    mkdirSync(join(logFile, ".."), { recursive: true });
    const sink = (chunk) => {
      try {
        writeFileSync(logFile, chunk, { flag: "a" });
      } catch {
        // the app log is a convenience for the round report
      }
    };
    proc.stdout?.on("data", sink);
    proc.stderr?.on("data", sink);
  }
  const shell = await app.firstWindow({ timeout: 90_000 });
  const ready = await waitFor(
    () => shell.evaluate(() => (document.readyState !== "loading" && window.location.href !== "about:blank" && Boolean(window.aiOffice)) || null),
    60_000,
  );
  if (!ready) throw new Error("the app's shell window never exposed window.aiOffice");
  // the pid Playwright spawned from this process: the only root a crash may signal
  return { app, shell, pid: proc.pid, runnerPid: process.pid, harnessPidFile, env, ports, userDataDir };
}

/** The shell's account status (`{loggedIn, state, ...}`), or null when the call fails. */
export const accountStatus = (session) => session.shell.evaluate(() => window.aiOffice.accountStatus()).catch(() => null);

/**
 * Hands `url` to the running app as a second instance (fork e2e
 * handoffUrlToRunningApp): same binary, same userData, URL in argv.
 */
export function handoffUrl(session, url, timeoutMs = 30_000) {
  return new Promise((resolveExit) => {
    const child = spawn(session.ports.ELECTRON_BIN, ["--no-sandbox", "--disable-gpu", session.ports.SHELL_APP_DIR, url], {
      env: session.env,
      detached: true,
      stdio: "ignore",
    });
    const timer = setTimeout(() => {
      // the group of the instance spawned here (detached: its own group), never another
      const group = ownGroupTarget(child.pid);
      try {
        if (group !== null) process.kill(group, "SIGKILL");
      } catch {
        // already gone
      }
      resolveExit(null);
    }, timeoutMs);
    child.once("error", () => {
      clearTimeout(timer);
      resolveExit(null);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolveExit(code);
    });
  });
}

/**
 * Signs the app in as `account`. Linux without an unlocked Secret Service
 * cannot keep the credential (the fork refuses basic_text): that is BLOCKED.
 */
export async function signIn(session, apiOrigin, account) {
  const keyring = await session.app.evaluate(({ safeStorage }) =>
    safeStorage.isEncryptionAvailable() && (process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text"));
  if (!keyring) throw new AppBlocked("no OS keyring for the app (run the runner under app-keyring.sh: dbus-run-session + unlocked gnome-keyring)");
  await session.shell.evaluate(() => {
    window.__faultLoginUrls = [];
    window.aiOffice.onAccountLogin((ev) => {
      if (ev?.phase === "url" && ev.url) window.__faultLoginUrls.push(ev.url);
    });
  });
  // Chromium commits the safeStorage key to Local State ~10 s after start; a
  // handoff instance started earlier writes its own key (fork signin-steps).
  const localState = join(session.userDataDir, "Local State");
  await waitFor(async () => existsSync(localState) && readFileSync(localState, "utf8").includes("encrypted_key"), 30_000);
  await session.shell.evaluate(() => window.aiOffice.accountLogin());
  const url = await waitFor(() => session.shell.evaluate(() => window.__faultLoginUrls.at(-1) ?? null), 30_000);
  if (!url) throw new Error("the app never produced a desktop authorization URL");
  const attemptId = attemptIdFromAuthorizationUrl(url);
  if (!attemptId) throw new Error("the desktop authorization URL carries no attempt_id");
  const callback = await approveDesktopAttempt(apiOrigin, account, attemptId);
  const code = await handoffUrl(session, callback);
  if (code !== 0) throw new Error(`the callback handoff instance exited ${code}`);
  const status = await waitFor(async () => {
    const s = await accountStatus(session);
    return s?.loggedIn ? s : null;
  }, 45_000);
  if (!status) {
    const last = await accountStatus(session);
    if (/keyring/i.test(String(last?.state ?? last?.error ?? ""))) throw new AppBlocked(`the app could not store the session (${last?.state})`);
    throw new Error(`the app did not reach signed-in (state ${last?.state ?? "unknown"})`);
  }
  return status;
}

/** Waits for the stored session to be live again after a relaunch. */
export async function waitSignedIn(session, timeoutMs = 45_000) {
  return waitFor(async () => {
    const s = await accountStatus(session);
    return s?.loggedIn ? s : null;
  }, timeoutMs);
}

export async function signOut(session) {
  await stubMessageBoxes(session, [0]);
  await session.shell.evaluate(() => window.aiOffice.accountLogout());
}

/** Answers the next native message boxes of main in order (fork e2e answerMessageBoxes). */
export async function stubMessageBoxes(session, responses) {
  await session.app.evaluate(({ dialog }, answers) => {
    dialog.showMessageBox = async () => ({ response: answers.length ? answers.shift() : 1, checkboxChecked: false });
  }, responses).catch(() => {});
}

export const docStatus = (session, path) => session.shell.evaluate((p) => window.aiOffice.uniworkDocStatus(p), path).catch(() => null);

/** A page of the app whose URL contains `part` (editor views are their own pages). */
async function pageWithUrl(session, part, timeoutMs = 45_000) {
  return waitFor(async () => {
    for (const page of session.app.windows()) {
      const href = page.url() || (await page.evaluate(() => window.location.href).catch(() => ""));
      if (href.includes(part)) return page;
    }
    return null;
  }, timeoutMs);
}

/** Opens a server document through the frame API; returns `{path, editor, kind}`. */
export async function openDocument(session, documentId, kind) {
  const opened = await session.shell.evaluate((id) => window.aiOffice.uniworkOpenDocument(id), documentId);
  const path = opened?.path ?? opened?.value?.path ?? null;
  if (!path) throw new Error(`uniworkOpenDocument refused the document (${JSON.stringify(opened?.error ?? opened?.code ?? "no path")})`);
  const editor = await pageWithUrl(session, kind === "xlsx" ? "://sheets/" : "://docs/");
  if (!editor) throw new Error(`no ${kind} editor page after opening the document`);
  if (kind === "xlsx") {
    const grid = await waitFor(() => editor.evaluate(() => {
      for (const canvas of document.querySelectorAll("canvas")) {
        const r = canvas.getBoundingClientRect();
        if (r.width > 500 && r.height > 300) return true;
      }
      return null;
    }), 45_000);
    if (!grid) throw new Error("the sheets editor never showed its worksheet canvas");
    await sleep(1_500);
  } else {
    const ready = await waitFor(() => editor.evaluate(() => Boolean(window.__aidocs?.editor) || null), 45_000);
    if (!ready) throw new Error("the docs editor never exposed __aidocs.editor");
  }
  const status = await waitFor(async () => {
    const s = await docStatus(session, path);
    return s?.documentId === documentId ? s : null;
  }, 30_000);
  if (!status) throw new Error("the app never reported a bound status for the opened document");
  if (status.access && status.access !== "edit") throw new Error(`the document opened ${status.access}, not edit`);
  return { path, editor, kind, documentId };
}

/** One edit with a unique marker: docs types at the end, sheets types into a cell of row `n`. */
export async function edit(doc, marker, n = 1) {
  if (doc.kind === "xlsx") {
    const grid = await doc.editor.evaluate(() => {
      for (const canvas of document.querySelectorAll("canvas")) {
        const r = canvas.getBoundingClientRect();
        if (r.width > 500 && r.height > 300) return { x: r.x, y: r.y };
      }
      return null;
    });
    if (!grid) throw new Error("no worksheet canvas to edit");
    // column A, row n: right of the row header, below the column header (fork e2e driver)
    await doc.editor.mouse.click(grid.x + 46 + 43, grid.y + 24 + 12 + (n - 1) * 24);
    await doc.editor.keyboard.type(marker, { delay: 30 });
    await doc.editor.keyboard.press("Enter");
    return;
  }
  await doc.editor.locator(".doc-page").first().click();
  await doc.editor.evaluate(() => {
    const ed = window.__aidocs.editor;
    ed.commands.setTextSelection(ed.state.doc.content.size - 1);
  });
  await doc.editor.keyboard.type(` ${marker}`, { delay: 20 });
}

/** The explicit Save each module answers (Ctrl+S in docs, the menu command in sheets). */
export async function save(session, doc) {
  if (doc.kind === "xlsx") {
    await session.app.evaluate(({ webContents }, part) => {
      const wc = webContents.getAllWebContents().find((w) => w.getURL().includes(part));
      wc?.send("menu:action", "save");
    }, "://sheets/");
    return;
  }
  await doc.editor.keyboard.press("ControlOrMeta+s");
}

/** The harness's recorded pids (server, web, app, handoff): fenced off from every crash. */
function harnessPids(session) {
  try {
    return session.harnessPidFile && existsSync(session.harnessPidFile) ? harnessPidsFromFile(readFileSync(session.harnessPidFile, "utf8")) : [];
  } catch {
    return [];
  }
}

/**
 * Crash: SIGKILL the Electron this module launched and every descendant of it,
 * nothing else (crashTargets: still our child, no harness pid or group).
 */
export function crash(session) {
  if (session.dead) return 0;
  session.dead = true;
  const ps = spawnSync("ps", ["-eo", "pid=,ppid=,pgid="], { encoding: "utf8" });
  const pids = crashTargets(ps.stdout ?? "", { root: session.pid, runnerPid: session.runnerPid ?? process.pid, protectedPids: harnessPids(session) });
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
  session.app.close().catch(() => {});
  return pids.length;
}

/** Graceful close with the fork e2e's 20 s SIGKILL fallback (open tabs ask to save). */
export async function closeApp(session) {
  if (!session || session.dead) return;
  await stubMessageBoxes(session, [1, 1, 1]);
  const timer = setTimeout(() => crash(session), 20_000);
  try {
    await session.app.close();
  } catch {
    // a crashed session has nothing left to close
  } finally {
    clearTimeout(timer);
    session.dead = true;
  }
}

/** True once the app has stored a desktop session in this userData (fork credentials.ts). */
export const hasStoredSession = (userDataDir) => existsSync(join(userDataDir, "uniwork-auth", "session.bin"));
