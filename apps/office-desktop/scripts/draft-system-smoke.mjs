import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

if (process.platform !== "win32") {
  process.stdout.write("desktop recovery system smoke: not run (Windows DPAPI/safeStorage required)\n");
  process.exit(0);
}

const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rootDirectory = resolve(appDirectory, "..", "..");
const requireRoot = createRequire(join(rootDirectory, "package.json"));
const requireApp = createRequire(join(appDirectory, "package.json"));
const execFileAsync = promisify(execFile);
const identityManifest = JSON.parse(await readFile(join(appDirectory, "identity.json"), "utf8"));
const devIdentity = identityManifest.channelProfiles.dev;
const esbuild = requireRoot("esbuild");
const electronBinary = join(dirname(requireApp.resolve("electron/package.json")), "dist", "electron.exe");
const smokeRoot = resolve(process.env.OFFICE_DESKTOP_SYSTEM_ROOT ?? join("D:\\", ".uniwork-dev", "office-desktop-system"));
await mkdir(smokeRoot, { recursive: true });
const userData = await mkdtemp(join(smokeRoot, "recovery-"));
const harness = join(userData, "safe-storage-harness.mjs");
const resultFile = join(userData, "result.json");

const source = `
import { app, safeStorage } from "electron";
import { createSafeStorageDraftKeyStore } from "./main/drafts/keystore.ts";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
const resultFile = process.env.OFFICE_DESKTOP_SYSTEM_RESULT;
const run = async () => {
try {
  await writeFile(resultFile, JSON.stringify({ started: true }));
  if (!safeStorage.isEncryptionAvailable()) throw new Error("safeStorage_unavailable");
  const store = createSafeStorageDraftKeyStore({
    userDataDirectory: app.getPath("userData"),
    channel: "dev",
    keyNamespace: ${JSON.stringify(devIdentity.keyNamespace)},
    safeStorage,
  });
  const first = await store.getOrCreate("system-q8");
  const second = await store.get("system-q8");
  if (!second || Buffer.from(first).compare(Buffer.from(second)) !== 0) throw new Error("key_round_trip_failed");
  const keyDirectory = join(app.getPath("userData"), "draft-keys", "dev", ${JSON.stringify(devIdentity.keyNamespace)});
  const files = await readdir(keyDirectory);
  if (files.length !== 1 || !files[0].endsWith(".key")) throw new Error("key_file_missing");
  const wrapped = await readFile(join(keyDirectory, files[0]), "utf8");
  if (wrapped.includes(Buffer.from(first).toString("base64url"))) throw new Error("raw_key_persisted");
  await store.delete("system-q8");
  if (await store.get("system-q8") !== undefined) throw new Error("key_delete_failed");
  await writeFile(resultFile, JSON.stringify({ ok: true, available: true }));
  app.exit(0);
} catch (error) {
  await writeFile(resultFile, JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  app.exit(1);
}
};
app.setPath("userData", process.env.OFFICE_DESKTOP_SYSTEM_USER_DATA);
if (app.isReady()) void run();
else app.once("ready", () => { void run(); });
`;
try {
  await esbuild.build({ stdin: { contents: source, sourcefile: "safe-storage-harness.ts", resolveDir: appDirectory, loader: "ts" }, bundle: true, platform: "node", format: "esm", target: "es2022", external: ["electron"], outfile: harness, logLevel: "silent" });
  const child = spawn(electronBinary, ["--no-sandbox", "--disable-gpu", harness], {
    cwd: rootDirectory,
    env: { ...process.env, OFFICE_DESKTOP_SYSTEM_USER_DATA: userData, OFFICE_DESKTOP_SYSTEM_RESULT: resultFile },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  let stdout = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  const code = await new Promise((resolvePromise, reject) => {
    const timer = setTimeout(async () => { child.kill(); let marker = ""; try { marker = await readFile(resultFile, "utf8"); } catch { /* no marker */ } reject(new Error(`system smoke timed out: ${stderr || stdout || marker || "no child output"}`)); }, Number(process.env.OFFICE_DESKTOP_SYSTEM_TIMEOUT_MS ?? 120_000));
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (exitCode) => { clearTimeout(timer); resolvePromise(exitCode ?? 1); });
  });
  const result = JSON.parse(await readFile(resultFile, "utf8"));
  if (code !== 0 || !result.ok) throw new Error(`system smoke failed: ${result.error ?? stderr}`);
  const keyDirectory = join(userData, "draft-keys", "dev", devIdentity.keyNamespace);
  const acl = (await execFileAsync("icacls", [keyDirectory])).stdout.toLowerCase();
  const domain = process.env.USERDOMAIN?.trim();
  const username = process.env.USERNAME?.trim();
  const account = (domain && username ? `${domain}\\${username}` : userInfo().username).toLowerCase();
  if (!acl.includes(`${account}:(m)`) || acl.includes("(i)")) {
    throw new Error(`draft key directory ACL is not restricted to the current account: ${acl}`);
  }
  process.stdout.write("desktop recovery system smoke: Windows safeStorage round trip, opaque key file, restricted ACL and delete verified\n");
} finally {
  if (process.env.OFFICE_DESKTOP_SYSTEM_KEEP !== "1") await rm(userData, { recursive: true, force: true });
  else process.stdout.write(`desktop recovery system smoke kept artifacts at ${userData}\n`);
}
