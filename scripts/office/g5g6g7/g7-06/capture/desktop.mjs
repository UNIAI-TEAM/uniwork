/* global process */
// Desktop host: the G7-01 harness's fork Electron app. start.sh left the
// ingredients in ports.env (ELECTRON_BIN, SHELL_APP_DIR, DISPLAY, XAUTHORITY,
// the API origin); the running app has no debugging port, so each fixture gets
// its own Electron instance started through Playwright's `_electron` on the
// SAME display, with the SAME allow-listed environment (harness lib.mjs
// appEnv) but a user-data dir of its own: the harness app holds the
// single-instance lock of its dir, and a second instance on it would hand its
// argv over and exit.
//
// The fixture is opened the way the fork's own suite opens a file: its path in
// argv (collectLaunchPaths). It is a copy in the instance's scratch dir, so the
// fork's working files never land next to the committed fixture. The shot is
// the module's WebContentsView page (`://<module>/`): that is where the
// document renders, the shell's tab strip around it is not part of it.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { readPins } from "../../../../../apps/web/platform/office-frame/frame-headers.mjs";
import { appEnv } from "../../harness/lib.mjs";
import { blocked, failed, ok } from "./meta.mjs";
import { COLOR_SCHEME, OPEN_TIMEOUT_MS, SETTLE, TIMEZONE, VIEWPORTS } from "./constants.mjs";
import { STATUS_SELECTORS, isStreamingStatus, notSettledReason, pageIsBusy, realSleep, settle } from "./settle.mjs";
import { appPlaces, clip } from "./scrub.mjs";
import { collectRenderedText, joinBlocks } from "./text.mjs";

export const ELECTRON_ARGS = ["--no-sandbox", "--disable-gpu", "--lang=vi-VN", "--force-device-scale-factor=1", "--force-color-profile=srgb", "--font-render-hinting=none", "--disable-lcd-text"];
/** Raw error or screen text in a reason: first line, credentials and home/run/app paths scrubbed, clipped. */
const reasonText = (text, ports, length = 300) => clip(String(text).split("\n")[0], length, { app: appPlaces(ports) });

const SIGN_IN_WORDS = /\b(sign in|log in|login)\b|đăng nhập/i;

/** Why the harness app cannot be reused for a capture, or "" when it can. */
export function desktopPrecondition(ports) {
  const missing = ["ELECTRON_BIN", "SHELL_APP_DIR", "API_ORIGIN"].filter((key) => !ports[key]);
  if (missing.length > 0) return `ports.env has no ${missing.join(", ")}: the run did not start the fork app (start.sh without --skip-app is needed)`;
  if (!existsSync(ports.ELECTRON_BIN)) return `ELECTRON_BIN ${ports.ELECTRON_BIN} does not exist`;
  if (!existsSync(ports.SHELL_APP_DIR)) return `SHELL_APP_DIR ${ports.SHELL_APP_DIR} does not exist`;
  if (!ports.DISPLAY) return "ports.env has no DISPLAY: there is no X display to open the app on (the harness starts it under xvfb)";
  return "";
}

/** The environment of one capture instance: the harness's allow-list plus the fixed locale, zone and display. */
export function desktopEnv(ports, userDataDir, source = process.env) {
  return appEnv({
    source,
    apiOrigin: ports.API_ORIGIN,
    userDataDir,
    extra: {
      UNIWORK_BRIDGE_SILENT: "1",
      GENOFFICE_LANG: "vi",
      TZ: TIMEZONE,
      DISPLAY: ports.DISPLAY,
      ...(ports.XAUTHORITY ? { XAUTHORITY: ports.XAUTHORITY } : {}),
    },
  });
}

/** Finds the page whose URL carries `://<module>/` (a WebContentsView is a Playwright page of the app). */
async function findModulePage(app, module, timeoutMs, now = Date.now) {
  const part = `://${module}/`;
  const deadline = now() + timeoutMs;
  for (;;) {
    for (const candidate of app.windows()) {
      let href = candidate.url();
      if (!href) href = await candidate.evaluate(() => window.location.href).catch(() => "");
      if (href.includes(part)) return candidate;
    }
    const remaining = deadline - now();
    if (remaining <= 0) return null;
    await app.waitForEvent("window", { timeout: Math.min(remaining, 1_000) }).catch(() => {});
  }
}

/** What the shell window itself shows (its first page), for a BLOCKED/FAILED reason that names the screen. */
async function shellScreenText(app) {
  try {
    const shell = await app.firstWindow({ timeout: 5_000 });
    const text = await shell.evaluate(() => (document.body?.innerText ?? "").replace(/\s+/g, " ").trim());
    return String(text).slice(0, 160);
  } catch {
    return "";
  }
}

/**
 * What the shell shows around the module view: every BrowserWindow title (the OS
 * window title) and the text of every shell page (tab strip, menus drawn in
 * HTML). Brand text there is on screen even though the module view is clean.
 */
export async function collectShellText(app, modulePage) {
  const blocks = [];
  try {
    const titles = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((win) => win.getTitle()));
    blocks.push({ title: "", body: titles.join("\n"), attrs: [] });
  } catch {
    // no window titles readable: the pages below still are
  }
  for (const win of app.windows()) {
    if (win === modulePage) continue;
    const { text } = await collectRenderedText(win);
    blocks.push({ title: "", body: text, attrs: [] });
  }
  return joinBlocks(blocks);
}

async function closeApp(app) {
  const child = app.process();
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  }).catch(() => {});
  // by PID only: the instance's own process, never a name
  const timer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }, 20_000);
  try {
    await app.close();
  } catch {
    // already gone
  } finally {
    clearTimeout(timer);
  }
}

/** A settle that ended still busy on a streaming-load status: the one failure a fresh instance is known to cure (item 6). */
export function isRetryableTimeout(result) {
  return result.status === "timeout" && result.reason === "still_busy" && isStreamingStatus(result.busyWhy);
}

/**
 * Runs `attempt` (one fixture on one fresh instance, closed before it returns);
 * a result that says `retryable` is run once more and the first failure is kept
 * on `retries`. A second busy result is the fixture's result: no loop.
 */
export async function captureWithRetry(attempt) {
  const first = await attempt();
  if (first.status !== "failed" || !first.retryable) return first;
  const second = await attempt();
  const { retryable: _retryable, ...rest } = second;
  return { ...rest, retries: [{ reason: first.reason, ...(first.diagnostics ? { diagnostics: first.diagnostics } : {}) }] };
}

/** Collects the module page's console lines (capped, secrets and paths scrubbed); read them with `.lines`. */
export function watchConsole(page, app = []) {
  const lines = [];
  page.on("console", (message) => {
    if (lines.length < 40) lines.push(clip(`${message.type()}: ${message.text()}`, 300, { app }));
  });
  return { lines };
}

/** What the module's status regions say right now, per frame; read-only, never touches the page. */
async function statusText(page, app) {
  const texts = [];
  for (const frame of page.frames()) {
    const found = await frame
      .evaluate((selectors) => selectors.flatMap((selector) => [...document.querySelectorAll(selector)].map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim()).filter(Boolean)), STATUS_SELECTORS)
      .catch(() => []);
    texts.push(...found);
  }
  return clip(texts.join(" | "), 400, { app });
}

/** One fixture on a fresh instance (closed again before it returns). */
async function captureOne({ ports, fixture, playwright, scratch, log, now = Date.now }) {
  const dir = mkdtempSync(join(scratch, `${fixture.id}-`));
  const userData = join(dir, "userdata");
  mkdirSync(userData, { recursive: true });
  writeFileSync(join(userData, "app-settings.json"), `${JSON.stringify({ onboardingSeen: true, language: "vi" })}\n`);
  const file = join(dir, basename(fixture.path));
  copyFileSync(fixture.absPath, file);
  let app = null;
  try {
    try {
      app = await playwright._electron.launch({ executablePath: ports.ELECTRON_BIN, args: [...ELECTRON_ARGS, ports.SHELL_APP_DIR, file], env: desktopEnv(ports, userData), timeout: 60_000 });
    } catch (error) {
      return failed(`electron_launch_failed: ${reasonText(error.message, ports)}`);
    }
    const page = await findModulePage(app, fixture.module, OPEN_TIMEOUT_MS, now);
    if (!page) {
      const screen = reasonText(await shellScreenText(app), ports, 160);
      if (SIGN_IN_WORDS.test(screen)) return blocked(`shell_requires_sign_in: the shell shows "${screen}" instead of opening ${basename(fixture.path)}`);
      return failed(`module_view_not_found: no ://${fixture.module}/ page within ${OPEN_TIMEOUT_MS / 1000}s; the shell shows "${screen}"`);
    }
    const appDirs = appPlaces(ports);
    const consoleWatch = watchConsole(page, appDirs);
    const applied = [];
    await app.evaluate(({ BrowserWindow, nativeTheme }, size) => {
      nativeTheme.themeSource = "light";
      for (const win of BrowserWindow.getAllWindows()) win.setContentSize(size.w, size.h);
    }, VIEWPORTS.desktop).then(() => applied.push("theme+size"), () => {});
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: COLOR_SCHEME }).then(() => applied.push("media"), () => {});
    log(`desktop: ${fixture.id} -> ${fixture.module} view open (${applied.join(", ") || "no emulation applied"})`);
    for (const frame of page.frames()) await frame.addStyleTag({ content: "*{caret-color:transparent!important}" }).catch(() => {});
    const result = await settle({
      grab: () => page.screenshot({ animations: "disabled", caret: "hide" }),
      isBusy: () => pageIsBusy(page),
      sleep: realSleep,
      now,
      ...SETTLE,
    });
    if (result.status !== "settled") {
      // dump what the app said before failing or retrying, so the next round can tell the causes apart
      const diagnostics = { status: await statusText(page, appDirs), busy: clip(result.busyWhy ?? "", 200, { app: appDirs }), console: consoleWatch.lines };
      return failed(notSettledReason(result), { retryable: isRetryableTimeout(result), diagnostics });
    }
    const { text, canvasOnly } = await collectRenderedText(page);
    const shellText = await collectShellText(app, page);
    return ok({ png: result.frame, text, shellText, canvasOnly });
  } catch (error) {
    return failed(`capture_error: ${reasonText(error.message, ports)}`);
  } finally {
    if (app) await closeApp(app);
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Captures every fixture on the desktop host; `results[id]` is ok (png/text) | blocked | failed. */
export async function captureDesktop({ ports, fixtures, playwright, log = () => {}, forkShaFallback = "", now }) {
  // the pin the D checkout names: the version the desktop run is compared against too
  const base = { forkSha: ports.OFFICE_FORK_SHA || forkShaFallback, pinVersion: readPins().docs?.version ?? "", notes: [] };
  const why = desktopPrecondition(ports);
  if (why) return { ...base, results: Object.fromEntries(fixtures.map((fixture) => [fixture.id, blocked(why)])) };
  const scratch = mkdtempSync(join(tmpdir(), "g7-06-desktop-"));
  const results = {};
  try {
    for (const fixture of fixtures) {
      results[fixture.id] = fixture.module
        ? await captureWithRetry(() => captureOne({ ports, fixture, playwright, scratch, log, now }))
        : failed(`no module for format ${fixture.format}`);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  return { ...base, results };
}
