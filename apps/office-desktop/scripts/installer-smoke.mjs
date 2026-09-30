import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { join, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";

if (process.platform !== "win32") throw new Error("desktop installer smoke requires Windows x64");

const execFileAsync = promisify(execFile);
const appDirectory = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outputDirectory = resolve(process.env.OFFICE_DESKTOP_OUTPUT ?? join(appDirectory, "..", "..", ".uniwork-dev", "office-desktop-artifacts"));
const buildIdentity = JSON.parse(await readFile(join(appDirectory, "dist", "build-identity.json"), "utf8"));
const setup = resolve(process.env.OFFICE_DESKTOP_SETUP_EXE ?? join(outputDirectory, `${buildIdentity.artifactPrefix}_${buildIdentity.version}_unsigned_win32_x64-setup.exe`));
const root = resolve(process.env.OFFICE_DESKTOP_INSTALL_SMOKE_ROOT ?? join("D:\\", ".uniwork-dev", "office-desktop-installer-smoke"));
await mkdir(root, { recursive: true });
const work = await mkdtemp(join(root, "run-"));
const installDir = join(work, "install");
const userData = join(work, "user-data");
const drafts = join(userData, "drafts");
const schemeKey = `HKCU\\Software\\Classes\\${buildIdentity.userScheme}`;

async function run(file, args, options = {}) {
  const result = await execFileAsync(file, args, { windowsHide: true, ...options });
  return result;
}

async function registryExists() {
  try { await run("reg.exe", ["query", schemeKey]); return true; }
  catch { return false; }
}

async function launchSmoke(executable) {
  let stdout = "";
  let stderr = "";
  const child = spawn(executable, ["--office-desktop-smoke"], { cwd: appDirectory, env: { ...process.env, UNIWORK_OFFICE_USER_DATA: userData }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  await new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`installed launch timed out: ${stderr || stdout}`)); }, 60_000);
    child.once("error", reject);
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolvePromise();
      else reject(new Error(`installed launch exited ${code}: ${stderr || stdout}`));
    });
  });
  const marker = stdout.split(/\r?\n/).map((line) => { try { return JSON.parse(line); } catch { return undefined; } }).find((value) => value?.event === "office-desktop-smoke");
  if (!marker?.readyToShow || marker.diagnostics?.appId !== buildIdentity.appId || marker.diagnostics?.channel !== buildIdentity.channel || marker.diagnostics?.deploymentId !== process.env.UNIWORK_OFFICE_DEPLOYMENT_ID) throw new Error(`installed launch diagnostics mismatch: ${stdout}`);
}

try {
  await mkdir(drafts, { recursive: true });
  const sentinel = join(drafts, "keep-after-uninstall.txt");
  await writeFile(sentinel, "draft sentinel\n", "utf8");
  await run(setup, ["/S", `/D=${installDir}`]);
  const executable = join(installDir, `${buildIdentity.executable}.exe`);
  await launchSmoke(executable);
  if (!(await registryExists())) throw new Error(`installed scheme was not registered: ${buildIdentity.userScheme}`);
  const entries = await readdir(installDir);
  const uninstallerName = entries.find((entry) => /^Uninstall .*\.exe$/i.test(entry));
  if (!uninstallerName) throw new Error("per-user installer did not create an uninstaller");
  await run(join(installDir, uninstallerName), ["/S"]);
  for (let attempt = 0; attempt < 30 && await registryExists(); attempt += 1) await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000));
  if (await registryExists()) throw new Error("uninstall left the current-user scheme registration behind");
  try { await readFile(sentinel, "utf8"); } catch { throw new Error("uninstall deleted userData/drafts without an explicit opt-in"); }
  process.stdout.write(`desktop installer smoke: installed ${setup}, verified scheme/diagnostics, uninstalled, and preserved drafts\n`);
} finally {
  await rm(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
}
