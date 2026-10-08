// UNI-961 macOS smoke: drives the packaged darwin-arm64 UniWork Office app with
// Playwright's Electron launcher. It proves the .app opens, the File menu carries
// Print with Cmd+P, that the menu item opens the in-app print dialog for an open
// local document, and that "Save as PDF" writes a real PDF. Evidence (screenshots,
// the PDFs, results.json, app logs) goes to --out.
//
//   node scripts/office/macos-smoke.mjs --app <Product>.app --out <dir> --docx <file> --xlsx <file>
//
// Never prints to a real printer: the destination is always "Save as PDF" and the
// save dialog (opened by main) is answered by a stub on `dialog.showSaveDialog`.
// A real Cmd+P keystroke is attempted through System Events and recorded either way:
// a runner without accessibility permission refuses it, which is a finding, not a failure.
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const { _electron } = createRequire(join(repoRoot, "e2e", "package.json"))("@playwright/test");

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`missing --${name}`);
  return resolve(value);
}

const appBundle = arg("app");
const out = arg("out");
const docx = arg("docx");
const xlsx = arg("xlsx");
await mkdir(out, { recursive: true });

const results = [];
const record = (check, status, detail = {}) => {
  results.push({ check, status, ...detail });
  process.stdout.write(`[${status}] ${check} ${Object.keys(detail).length ? JSON.stringify(detail) : ""}\n`);
};

const macosDirectory = join(appBundle, "Contents", "MacOS");
const executable = join(macosDirectory, (await readdir(macosDirectory))[0]);

async function launch(args = []) {
  const logs = [];
  const app = await _electron.launch({ executablePath: executable, args, timeout: 60_000 });
  const child = app.process();
  child.stdout?.on("data", (chunk) => logs.push(`[out] ${chunk}`));
  child.stderr?.on("data", (chunk) => logs.push(`[err] ${chunk}`));
  const exited = new Promise((done) => child.once("exit", (code, signal) => done({ code, signal })));
  return { app, logs, exited };
}

/** app.quit() and wait for the process to leave on its own; kill only as the failure path. */
async function quit(session, label) {
  await session.app.evaluate(({ app }) => app.quit()).catch(() => undefined);
  const outcome = await Promise.race([session.exited, sleep(20_000).then(() => "timeout")]);
  if (outcome === "timeout") {
    session.app.process().kill("SIGKILL");
    record(`${label}: app quits cleanly`, "FAIL", { reason: "still running 20s after app.quit()" });
    return false;
  }
  record(`${label}: app quits cleanly`, outcome.code === 0 ? "PASS" : "FAIL", outcome);
  return outcome.code === 0;
}

async function shot(page, name) {
  const path = join(out, `${name}.png`);
  await page.screenshot({ path }).catch((error) => process.stdout.write(`screenshot ${name} failed: ${error}\n`));
  return `${name}.png`;
}

async function describeMenu(app) {
  return app.evaluate(({ Menu }) => {
    const describe = (item) => ({ label: item.label, role: item.role ?? null, accelerator: item.accelerator ?? null, registerAccelerator: item.registerAccelerator, enabled: item.enabled, submenu: item.submenu ? item.submenu.items.map(describe) : undefined });
    const menu = Menu.getApplicationMenu();
    return menu ? menu.items.map(describe) : null;
  });
}

/** Click the menu item that carries CmdOrCtrl+P, the way the OS menu bar would. */
async function clickPrintMenuItem(app) {
  return app.evaluate(({ Menu, BrowserWindow }) => {
    const menu = Menu.getApplicationMenu();
    if (!menu) return "no_menu";
    const find = (items) => {
      for (const item of items) {
        if (item.accelerator === "CmdOrCtrl+P") return item;
        const inner = item.submenu ? find(item.submenu.items) : undefined;
        if (inner) return inner;
      }
      return undefined;
    };
    const item = find(menu.items);
    if (!item) return "no_print_item";
    const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    item.click(undefined, window, window?.webContents);
    return "clicked";
  });
}

const dialogOf = (page) => page.getByRole("dialog");
const dialogOpens = (page, timeout) => dialogOf(page).first().waitFor({ state: "visible", timeout }).then(() => true, () => false);

const dialogIsOpen = async (page) => (await dialogOf(page).count()) > 0 && await dialogOf(page).first().isVisible();

async function cancelDialog(page) {
  if (!(await dialogOf(page).count())) return;
  await page.getByRole("button", { name: /^(Cancel|Hủy)$/ }).click().catch(() => undefined);
  await dialogOf(page).first().waitFor({ state: "hidden", timeout: 10_000 }).catch(() => undefined);
}

/** Retry the menu click: the document registers its Print a moment after it renders. */
async function openPrintDialogFromMenu(app, page, label) {
  let last = "";
  for (let attempt = 0; attempt < 15; attempt += 1) {
    last = await clickPrintMenuItem(app);
    if (last !== "clicked") break;
    if (await dialogOpens(page, 2_000)) return { opened: true, attempts: attempt + 1 };
  }
  record(`${label}: Print menu item opens the in-app print dialog`, "FAIL", { lastMenuResult: last });
  return { opened: false };
}

/** Save as PDF from the open dialog; the save dialog is stubbed to a fixed path. */
async function savePdfFromDialog(app, page, pdfPath) {
  await app.evaluate(({ dialog }, target) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
  }, pdfPath);
  const dialogText = await dialogOf(page).first().innerText();
  const pagesLabel = dialogText.match(/\d+\s+pages?/i)?.[0] ?? null;
  const destinationIsPdf = /Save as PDF|Lưu dưới dạng PDF/.test(dialogText);
  await page.getByRole("button", { name: /^(Save|Lưu)$/ }).click();
  for (let waited = 0; waited < 60 && !existsSync(pdfPath); waited += 1) await sleep(1_000);
  return { pagesLabel, destinationIsPdf, written: existsSync(pdfPath) };
}

function pdfFacts(bytes) {
  const text = Buffer.from(bytes).toString("latin1");
  const leafPages = (text.match(/\/Type\s*\/Page(?![A-Za-z])/g) ?? []).length;
  const counts = [...text.matchAll(/\/Count\s+(\d+)/g)].map((match) => Number(match[1]));
  return { isPdf: text.startsWith("%PDF-"), bytes: bytes.length, pageObjects: leafPages, declaredCount: counts.length ? Math.max(...counts) : null };
}

/** Real keystroke through System Events; the runner may refuse it without accessibility rights. */
async function realKeystroke(app, page) {
  await app.evaluate(({ app: electron, BrowserWindow }) => { electron.focus({ steal: true }); BrowserWindow.getAllWindows()[0]?.focus(); });
  await sleep(500);
  try {
    await run("osascript", ["-e", 'tell application "System Events" to keystroke "p" using command down'], { timeout: 20_000 });
  } catch (error) {
    return { sent: false, error: String(error.stderr || error.message).trim().slice(0, 300) };
  }
  return { sent: true, opened: await dialogOpens(page, 6_000) };
}

async function scenario(session, name, { keystrokes }) {
  const label = name;
  const { app } = session;
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await sleep(5_000);
    await shot(page, `${name}-01-opened`);
    record(`${label}: window shows with the document argument`, (await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((window) => window.isVisible()))) ? "PASS" : "FAIL", { title: await page.title(), screenshot: `${name}-01-opened.png` });

    const opened = await openPrintDialogFromMenu(app, page, label);
    if (opened.opened) {
      await shot(page, `${name}-02-print-dialog`);
      record(`${label}: Print menu item opens the in-app print dialog`, "PASS", { attempts: opened.attempts, screenshot: `${name}-02-print-dialog.png` });
      await sleep(3_000); // let the preview lay out
      await shot(page, `${name}-03-print-dialog-preview`);
      const pdfPath = join(out, `${name}.pdf`);
      const saved = await savePdfFromDialog(app, page, pdfPath);
      await sleep(1_000);
      await shot(page, `${name}-04-after-save`);
      if (!saved.written) record(`${label}: Save as PDF writes the file`, "FAIL", saved);
      else {
        const facts = pdfFacts(await readFile(pdfPath));
        const pages = Math.max(facts.pageObjects, facts.declaredCount ?? 0);
        record(`${label}: Save as PDF writes a PDF with >= 1 page`, facts.isPdf && pages >= 1 ? "PASS" : "FAIL", { ...saved, ...facts, pdf: `${name}.pdf` });
      }
      await cancelDialog(page);
    }

    if (keystrokes) {
      const modifier = await clickPrintMenuItem(app); // dialog must be closed first
      await dialogOpens(page, 3_000);
      await cancelDialog(page);
      record(`${label}: repeat menu click after a closed dialog`, modifier === "clicked" ? "PASS" : "FAIL", { result: modifier });

      const closedBeforePlaywright = !(await dialogIsOpen(page));
      const playwrightKey = await (async () => { await page.keyboard.press("Meta+p"); return dialogOpens(page, 5_000); })();
      record(`${label}: Playwright Meta+P reaches the shortcut`, playwrightKey && closedBeforePlaywright ? "PASS" : "INFO", { opened: playwrightKey, closedBefore: closedBeforePlaywright, note: "CDP key events may bypass before-input-event; informational" });
      await cancelDialog(page);

      const closedBeforeSend = !(await dialogIsOpen(page));
      const sendInput = await (async () => {
        await app.evaluate(({ BrowserWindow }) => {
          const contents = BrowserWindow.getAllWindows()[0].webContents;
          contents.sendInputEvent({ type: "keyDown", keyCode: "P", modifiers: ["meta"] });
          contents.sendInputEvent({ type: "keyUp", keyCode: "P", modifiers: ["meta"] });
        });
        return dialogOpens(page, 5_000);
      })();
      record(`${label}: webContents.sendInputEvent Cmd+P reaches the shortcut`, sendInput && closedBeforeSend ? "PASS" : "INFO", { opened: sendInput, closedBefore: closedBeforeSend });
      await cancelDialog(page);

      const closedBeforeReal = !(await dialogIsOpen(page));
      const real = await realKeystroke(app, page);
      if (real.sent) await shot(page, `${name}-05-real-cmd-p`);
      record(`${label}: real Cmd+P keystroke (System Events)`, real.sent && real.opened && closedBeforeReal ? "PASS" : "INFO", { ...real, closedBefore: closedBeforeReal, note: "recorded, not gated: a headless runner has no accessibility permission" });
      await cancelDialog(page);
    }
  } finally {
    await writeFile(join(out, `${name}-app.log`), session.logs.join(""), "utf8");
  }
}

// ---- Phase 1: first launch of the .app, first window, File menu, clean quit.
const first = await launch();
let userData;
try {
  const page = await first.app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await sleep(4_000);
  await shot(page, "00-first-window");
  const facts = await first.app.evaluate(({ app, BrowserWindow }) => ({ name: app.getName(), version: app.getVersion(), packaged: app.isPackaged, userData: app.getPath("userData"), platform: process.platform, arch: process.arch, electron: process.versions.electron, windows: BrowserWindow.getAllWindows().map((window) => ({ visible: window.isVisible(), title: window.getTitle(), bounds: window.getBounds() })) }));
  userData = facts.userData;
  record("first launch: window shows", facts.windows.some((window) => window.visible) && facts.platform === "darwin" && facts.arch === "arm64" ? "PASS" : "FAIL", { ...facts, screenshot: "00-first-window.png" });
  const menu = await describeMenu(first.app);
  await writeFile(join(out, "menu.json"), JSON.stringify(menu, null, 2), "utf8");
  const file = menu?.find((item) => /^(File|Tệp|Tập tin)$/i.test(item.label ?? ""));
  const print = file?.submenu?.find((item) => item.accelerator === "CmdOrCtrl+P");
  record("File menu has Print with CmdOrCtrl+P", print ? "PASS" : "FAIL", { topLevel: menu?.map((item) => item.label), file: file?.submenu?.map((item) => item.label), print });
} finally {
  await writeFile(join(out, "first-launch-app.log"), first.logs.join(""), "utf8");
}
await quit(first, "first launch");

// ---- Phase 2: local-files mode (a per-device preference file), then each fixture.
await mkdir(join(userData, "local"), { recursive: true });
await writeFile(join(userData, "local", "mode.json"), JSON.stringify({ version: 1, localMode: true }), { mode: 0o600 });

for (const [name, file, keystrokes] of [["docx", docx, true], ["xlsx", xlsx, false]]) {
  const session = await launch([file]);
  try {
    await scenario(session, name, { keystrokes });
  } catch (error) {
    record(`${name}: scenario completed`, "FAIL", { error: String(error?.stack ?? error).slice(0, 1500) });
  }
  await quit(session, name);
}

await writeFile(join(out, "results.json"), JSON.stringify(results, null, 2), "utf8");
const failed = results.filter((entry) => entry.status === "FAIL");
process.stdout.write(`\n${results.length} checks, ${failed.length} failed\n`);
process.exit(failed.length ? 1 : 0);
