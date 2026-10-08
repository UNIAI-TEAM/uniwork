// UNI-966 macOS profile smoke: takes the bundle.zip the server's own bundle code
// wrote (real dmg + deployment-profile.json with a stub https origin + README),
// and walks the macOS first-run path a user takes: unzip with ditto, quarantine
// both files as a browser download would, mount the dmg, copy the .app out,
// launch it, see the no-deployment-profile card, choose the profile through the
// main-owned picker (dialogs stubbed via app.evaluate), confirm, restart, and
// prove the restarted app resolves the profile, answers desktop:auth-config for
// it, and that Sign in asks the stub origin and opens the browser on it.
// Evidence (screenshots, results.json, app logs, stub requests) goes to --out.
//
//   node scripts/office/macos-profile-smoke.mjs --bundle bundle.zip --out <dir> \
//     --cert <stub.pem> --key <stub-key.pem>
//
// The stub origin's host must resolve to 127.0.0.1 (the workflow adds an
// /etc/hosts line) and its self-signed certificate reaches the app through
// NODE_EXTRA_CA_CERTS. Nothing here talks to a real UniWork server.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:https";
import { join, resolve } from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const { _electron } = createRequire(join(repoRoot, "e2e", "package.json"))("@playwright/test");
const SESSION = "desktop-dev-session";

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`missing --${name}`);
  return resolve(value);
}

const bundle = arg("bundle");
const out = arg("out");
const cert = arg("cert");
const key = arg("key");
const work = join(out, "work");
await mkdir(work, { recursive: true });

const results = [];
const record = (check, status, detail = {}) => {
  results.push({ check, status, ...detail });
  process.stdout.write(`[${status}] ${check} ${Object.keys(detail).length ? JSON.stringify(detail) : ""}\n`);
};
const check = (name, ok, detail) => record(name, ok ? "PASS" : "FAIL", detail);

// ---- 1. The download: unzip as Archive Utility does, then quarantine both files.
const bundleSha256 = createHash("sha256").update(await readFile(bundle)).digest("hex");
const extracted = join(work, "Downloads", "uniwork-office");
await mkdir(extracted, { recursive: true });
await run("ditto", ["-x", "-k", bundle, extracted]);
const entries = (await readdir(extracted)).sort();
const dmgName = entries.find((name) => name.endsWith(".dmg"));
const profilePath = join(extracted, "deployment-profile.json");
const profile = JSON.parse(await readFile(profilePath, "utf8"));
const readme = existsSync(join(extracted, "README.txt")) ? await readFile(join(extracted, "README.txt"), "utf8") : "";
check("bundle holds the dmg, the profile and the README", Boolean(dmgName) && entries.length === 3 && readme.includes("deployment-profile.json"), { bundleSha256, entries, profile });
await writeFile(join(out, "bundle-profile.json"), `${JSON.stringify(profile, null, 2)}\n`);
await writeFile(join(out, "bundle-README.txt"), readme);
const stubOrigin = new URL(profile.apiOrigin);

const quarantine = `0083;${Math.floor(Date.now() / 1000).toString(16)};Safari;`;
for (const name of entries) await run("xattr", ["-w", "com.apple.quarantine", quarantine, join(extracted, name)]);
const quarantined = await Promise.all(entries.map(async (name) => ({ name, quarantine: (await run("xattr", ["-p", "com.apple.quarantine", join(extracted, name)]).catch(() => ({ stdout: "" }))).stdout.trim() })));
check("both downloaded files carry com.apple.quarantine", quarantined.every((entry) => entry.quarantine.startsWith("0083;")), { quarantined });

// ---- 2. Install: mount the dmg read-only and copy the app out, as a drag does.
const mountpoint = join(work, "mnt");
await mkdir(mountpoint, { recursive: true });
await run("hdiutil", ["attach", join(extracted, dmgName), "-nobrowse", "-readonly", "-mountpoint", mountpoint]);
const appName = (await readdir(mountpoint)).find((name) => name.endsWith(".app"));
const applications = join(work, "Applications");
await mkdir(applications, { recursive: true });
await run("ditto", [join(mountpoint, appName), join(applications, appName)]);
await run("hdiutil", ["detach", mountpoint]);
const appBundle = join(applications, appName);
const appQuarantine = (await run("xattr", ["-p", "com.apple.quarantine", appBundle]).catch(() => ({ stdout: "" }))).stdout.trim();
record("installed app quarantine (informational: Gatekeeper is not exercised, Playwright execs the binary)", "INFO", { appName, appQuarantine: appQuarantine || null });
const macosDirectory = join(appBundle, "Contents", "MacOS");
const executable = join(macosDirectory, (await readdir(macosDirectory))[0]);

// ---- 3. The stub origin: answers only the desktop login start, records requests.
const requests = [];
const server = createServer({ cert: await readFile(cert), key: await readFile(key) }, (request, response) => {
  const url = new URL(request.url, stubOrigin);
  requests.push({ method: request.method, path: url.pathname, query: Object.fromEntries([...url.searchParams].filter(([name]) => ["client_id", "deployment_id", "redirect_uri", "code_challenge_method", "platform"].includes(name))) });
  if (request.method === "GET" && url.pathname === "/api/v1/auth/desktop/start") {
    const authorize = new URL("/oauth/desktop/authorize", stubOrigin);
    authorize.searchParams.set("state", url.searchParams.get("state") ?? "");
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ authorization_url: authorize.toString(), attempt_expires_at: new Date(Date.now() + 600_000).toISOString() }));
    return;
  }
  response.writeHead(404, { "Content-Type": "application/json" });
  response.end("{}");
});
await new Promise((done) => server.listen(Number(stubOrigin.port || 443), "127.0.0.1", done));

async function launch(label) {
  const logs = [];
  const app = await _electron.launch({ executablePath: executable, env: { ...process.env, NODE_EXTRA_CA_CERTS: cert }, timeout: 60_000 });
  const child = app.process();
  child.stdout?.on("data", (chunk) => logs.push(`[out] ${chunk}`));
  child.stderr?.on("data", (chunk) => logs.push(`[err] ${chunk}`));
  const session = { app, child, logs, label, done: false };
  session.exited = new Promise((done) => child.once("exit", (code, signal) => { session.done = true; done({ code, signal }); }));
  session.page = await app.firstWindow();
  await session.page.waitForLoadState("domcontentloaded");
  return session;
}

async function finish(session, { quit = true } = {}) {
  if (quit) await session.app.evaluate(({ app }) => app.quit()).catch(() => undefined);
  const outcome = await Promise.race([session.exited, sleep(30_000).then(() => "timeout")]);
  // Playwright drops its handle once the app exits: use the child process.
  if (outcome === "timeout") session.child.kill("SIGKILL");
  await writeFile(join(out, `${session.label}-app.log`), session.logs.join(""), "utf8");
  return outcome;
}

const shot = async (page, name) => { await page.screenshot({ path: join(out, `${name}.png`) }).catch(() => undefined); return `${name}.png`; };
const ipc = (page, channel) => page.evaluate(([name, sessionGeneration]) => globalThis.uniworkOffice.call(name, { sessionGeneration }), [channel, SESSION]);
const logLine = (session, marker) => session.logs.join("").split("\n").find((line) => line.includes(marker));
async function waitForLog(session, marker, ms = 30_000) {
  for (let waited = 0; waited < ms; waited += 500) {
    const line = logLine(session, marker);
    if (line) return line;
    await sleep(500);
  }
  return undefined;
}
const loginState = (page, state, timeout = 30_000) => page.locator(`[data-login-state='${state}']`).waitFor({ state: "visible", timeout }).then(() => true, () => false);

/** Main's own picker, confirmation and relaunch are replaced in the running
 * main process; each call is written to stdout for the evidence. */
async function stubDialogs(app, { pick, confirm }) {
  await app.evaluate(({ app: electron, dialog }, options) => {
    const optionsOf = (args) => (args.length > 1 ? args[1] : args[0]) ?? {};
    dialog.showOpenDialog = async (...args) => {
      const opts = optionsOf(args);
      process.stdout.write(`SMOKE_OPEN_DIALOG ${JSON.stringify({ title: opts.title, filters: opts.filters, properties: opts.properties, defaultPath: opts.defaultPath ? "set" : "unset" })}\n`);
      return { canceled: false, filePaths: [options.pick] };
    };
    dialog.showMessageBox = async (...args) => {
      const opts = optionsOf(args);
      process.stdout.write(`SMOKE_CONFIRM ${JSON.stringify({ message: opts.message, detail: opts.detail, buttons: opts.buttons, defaultId: opts.defaultId, cancelId: opts.cancelId })}\n`);
      return { response: options.confirm, checkboxChecked: false };
    };
    electron.relaunch = () => { process.stdout.write("SMOKE_RELAUNCH\n"); };
  }, { pick, confirm });
}

let userData;
try {
  // ---- 4. First launch: no profile anywhere -> the card offers the picker.
  const first = await launch("1-first-launch");
  try {
    userData = await first.app.evaluate(({ app }) => app.getPath("userData"));
    const imported = join(userData, "deployment-profile.json");
    check("runner starts without an imported profile", !existsSync(imported), { userData });
    check("first launch shows the no-deployment-profile card", await loginState(first.page, "no-deployment-profile"), { screenshot: await shot(first.page, "01-no-profile-card") });
    const config = await ipc(first.page, "desktop:auth-config");
    check("desktop:auth-config answers no_deployment_profile (missing)", config?.state === "no_deployment_profile" && config?.reason === "missing", { config });
    const button = first.page.getByRole("button", { name: /^(Choose configuration file…|Chọn tệp cấu hình…)$/ });
    check("the card offers Choose configuration file", await button.isVisible(), {});

    // Cancel first: the default answer of the confirmation writes nothing.
    await stubDialogs(first.app, { pick: profilePath, confirm: 0 });
    await button.click();
    const cancelled = await first.page.locator("[data-import-status='cancelled']").waitFor({ timeout: 15_000 }).then(() => true, () => false);
    check("cancelling the confirmation writes no profile and does not restart", cancelled && !existsSync(imported) && !logLine(first, "SMOKE_RELAUNCH"), { cancelled });

    await stubDialogs(first.app, { pick: profilePath, confirm: 1 });
    await button.click();
    const confirmLine = await waitForLog(first, "SMOKE_CONFIRM");
    const confirm = confirmLine ? JSON.parse(confirmLine.slice(confirmLine.indexOf("{"))) : undefined;
    check("the confirmation names the stub origin host, default Cancel", Boolean(confirm?.message?.includes(stubOrigin.hostname)) && confirm?.defaultId === 0 && confirm?.cancelId === 0, { confirm, openDialog: logLine(first, "SMOKE_OPEN_DIALOG")?.trim() });
    await shot(first.page, "02-importing");
    const relaunch = await waitForLog(first, "SMOKE_RELAUNCH");
    const exit = await finish(first, { quit: false });
    check("import restarts the app (app.relaunch + clean quit)", Boolean(relaunch) && exit?.code === 0, { exit });
    const written = existsSync(imported) ? JSON.parse(await readFile(imported, "utf8")) : undefined;
    const mode = existsSync(imported) ? ((await stat(imported)).mode & 0o777).toString(8) : null;
    check("userData/deployment-profile.json equals the bundle profile, mode 600", JSON.stringify(written) === JSON.stringify(profile) && mode === "600", { mode, written });
  } finally {
    if (!first.done) await finish(first);
  }

  // ---- 5. The restart: the imported profile resolves and sign-in uses its origin.
  const second = await launch("2-after-import");
  try {
    check("restarted app shows the sign-in card", await loginState(second.page, "signed-out"), { screenshot: await shot(second.page, "03-signed-out-card") });
    const config = await ipc(second.page, "desktop:auth-config");
    check("desktop:auth-config answers the imported deployment, resettable", config?.clientId === profile.clientId && config?.deploymentId === profile.deploymentId && config?.resettable === true, { config });
    const diagnostics = await ipc(second.page, "desktop:diagnostics");
    check("desktop:diagnostics reports the stub origin host", diagnostics?.originHost === stubOrigin.host && diagnostics?.deploymentId === profile.deploymentId, { originHost: diagnostics?.originHost, deploymentId: diagnostics?.deploymentId, channel: diagnostics?.channel });
    await second.app.evaluate(({ shell }) => { shell.openExternal = async (url) => { process.stdout.write(`SMOKE_OPEN_EXTERNAL ${url}\n`); }; });
    await second.page.getByRole("button", { name: /^(Sign in|Đăng nhập)$/ }).click();
    const opened = await waitForLog(second, "SMOKE_OPEN_EXTERNAL");
    const openedUrl = opened ? new URL(opened.slice(opened.indexOf("SMOKE_OPEN_EXTERNAL") + 20).trim()) : undefined;
    const start = requests.find((entry) => entry.path === "/api/v1/auth/desktop/start");
    check("Sign in asks the stub origin for a desktop login", Boolean(start) && start.query.client_id === profile.clientId && start.query.deployment_id === profile.deploymentId, { start });
    check("Sign in opens the browser on the stub origin's authorize URL", openedUrl?.origin === stubOrigin.origin && openedUrl?.pathname === "/oauth/desktop/authorize", { opened: openedUrl ? `${openedUrl.origin}${openedUrl.pathname}` : null });
    check("the card waits for the browser step", await loginState(second.page, "pending", 15_000), { screenshot: await shot(second.page, "04-pending") });
    await second.page.getByRole("button", { name: /^(Cancel login|Hủy đăng nhập)$/ }).click().catch(() => undefined);
    await loginState(second.page, "signed-out", 15_000);

    // ---- 6. Reset connection: removes the imported profile and restarts.
    await stubDialogs(second.app, { pick: profilePath, confirm: 1 });
    await second.page.getByRole("button", { name: /^(Reset connection|Đặt lại kết nối)$/ }).click();
    const resetConfirm = await waitForLog(second, "SMOKE_CONFIRM");
    const resetRelaunch = await waitForLog(second, "SMOKE_RELAUNCH");
    const exit = await finish(second, { quit: false });
    check("Reset connection confirms, removes the profile and restarts", Boolean(resetConfirm) && Boolean(resetRelaunch) && exit?.code === 0 && !existsSync(join(userData, "deployment-profile.json")), { resetConfirm: resetConfirm?.trim(), exit });
  } finally {
    if (!second.done) await finish(second);
  }

  const third = await launch("3-after-reset");
  try {
    check("after reset the no-deployment-profile card is back", await loginState(third.page, "no-deployment-profile"), { screenshot: await shot(third.page, "05-after-reset") });
  } finally {
    await finish(third);
  }
} catch (error) {
  record("smoke completed", "FAIL", { error: String(error?.stack ?? error).slice(0, 1500) });
} finally {
  server.close();
  await writeFile(join(out, "stub-requests.json"), `${JSON.stringify(requests, null, 2)}\n`);
  await writeFile(join(out, "results.json"), `${JSON.stringify({ bundleSha256, results }, null, 2)}\n`);
}

const failed = results.filter((entry) => entry.status === "FAIL");
process.stdout.write(`\n${results.length} checks, ${failed.length} failed\n`);
process.exit(failed.length ? 1 : 0);
