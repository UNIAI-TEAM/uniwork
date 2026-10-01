import { createRequire } from "node:module";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve, win32 as windowsPath } from "node:path";
import process from "node:process";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") {
  process.stdout.write("desktop recovery system smoke: not run (Windows DPAPI/safeStorage required)\n");
  process.exit(0);
}

const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rootDirectory = resolve(appDirectory, "..", "..");
const requireRoot = createRequire(join(rootDirectory, "package.json"));
const requireApp = createRequire(join(appDirectory, "package.json"));
const identityManifest = JSON.parse(await readFile(join(appDirectory, "identity.json"), "utf8"));
const buildIdentity = await readFile(join(appDirectory, "dist", "build-identity.json"), "utf8")
  .then((value) => JSON.parse(value))
  .catch(() => undefined);
const runtimeIdentity = buildIdentity ?? identityManifest;
const keyNamespace = runtimeIdentity.keyNamespace;
function windowsSystemPath(executable) {
  // The smoke accepts the WINDIR fallback so it can still resolve on hosts that
  // do not export SystemRoot; production (keystore.ts) intentionally resolves
  // SystemRoot only and fails closed otherwise.
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
  if (!systemRoot || !windowsPath.isAbsolute(systemRoot)) throw new Error("Windows system root could not be resolved");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.exe$/i.test(executable)) throw new Error("Windows system executable could not be resolved");
  return windowsPath.join(systemRoot, "System32", executable);
}
function currentWindowsAccount() {
  try {
    const account = execFileSync(windowsSystemPath("whoami.exe"), { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true }).trim();
    if (/^[^\\/:\r\n]+\\[^\\/:\r\n]+$/.test(account)) return account;
  } catch { /* report a typed smoke failure below */ }
  throw new Error("current Windows account could not be resolved");
}
const expectedAccount = currentWindowsAccount();
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
import { createDesktopDraftStore } from "./main/drafts/store.ts";
import { execFile } from "node:child_process";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, win32 as windowsPath } from "node:path";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
const resultFile = process.env.OFFICE_DESKTOP_SYSTEM_RESULT;
const expectedAccount = ${JSON.stringify(expectedAccount)};
const windowsSystemPath = (executable) => {
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
  if (!systemRoot || !windowsPath.isAbsolute(systemRoot)) throw new Error("Windows system root could not be resolved");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\\.exe$/i.test(executable)) throw new Error("Windows system executable could not be resolved");
  return windowsPath.join(systemRoot, "System32", executable);
};
const parseAcl = (text) => [...text.split(/\\r?\\n/).flatMap((line) => [...line.matchAll(/(?:^|\\s)([^:]+):((?:\\([^)]+\\))+)/g)].map((match) => ({ principal: match[1].trim(), rights: [...match[2].matchAll(/\\(([^)]+)\\)/g)].map((right) => right[1]).join(",") })))];
const assertRestrictedAcl = async (path) => {
  const text = (await execFileAsync(windowsSystemPath("icacls.exe"), [path])).stdout;
  const entries = parseAcl(text);
  const accountEntries = entries.filter((entry) => entry.principal.toLowerCase() === expectedAccount.toLowerCase());
  const systemPrincipal = ["nt authority", "system"].join(String.fromCharCode(92));
  const logonPrefix = ["nt authority", "logonsessionid_"].join(String.fromCharCode(92));
  const unexpected = entries.filter((entry) => {
    const principal = entry.principal.toLowerCase();
    return principal !== expectedAccount.toLowerCase() && principal !== systemPrincipal && !(principal.startsWith(logonPrefix) && /^[0-9_]+$/.test(principal.slice(logonPrefix.length)));
  });
  const osRightsValid = entries.every((entry) => {
    const principal = entry.principal.toLowerCase();
    if (principal === systemPrincipal) return entry.rights.split(",").includes("F");
    if (principal.startsWith(logonPrefix) && /^[0-9_]+$/.test(principal.slice(logonPrefix.length))) return entry.rights.split(",").includes("RX");
    return true;
  });
  if (text.toUpperCase().includes("(I)") || accountEntries.length !== 1 || !accountEntries[0].rights.split(",").includes("M") || unexpected.length > 0 || !osRightsValid) {
    throw new Error(\`draft key ACL is not restricted to the current account: \${text}\`);
  }
};
const run = async () => {
try {
  await writeFile(resultFile, JSON.stringify({ started: true }));
  if (!safeStorage.isEncryptionAvailable()) throw new Error("safeStorage_unavailable");
  const store = createSafeStorageDraftKeyStore({
    userDataDirectory: app.getPath("userData"),
    channel: "dev",
    keyNamespace: ${JSON.stringify(keyNamespace)},
    safeStorage,
  });
  const first = await store.getOrCreate("system-q8");
  const second = await store.get("system-q8");
  if (!second || Buffer.from(first).compare(Buffer.from(second)) !== 0) throw new Error("key_round_trip_failed");
  const keyDirectory = join(app.getPath("userData"), "draft-keys", "dev", ${JSON.stringify(keyNamespace)});
  const files = await readdir(keyDirectory);
  if (files.length !== 1 || !files[0].endsWith(".key")) throw new Error("key_file_missing");
  const wrapped = await readFile(join(keyDirectory, files[0]), "utf8");
  if (wrapped.includes(Buffer.from(first).toString("base64url"))) throw new Error("raw_key_persisted");
  await assertRestrictedAcl(keyDirectory);
  await assertRestrictedAcl(join(keyDirectory, files[0]));
  await store.delete("system-q8");
  if (await store.get("system-q8") !== undefined) throw new Error("key_delete_failed");
  // Q8 system leg: real store + real OS key store on disk. Logout keeps the
  // ciphertext and its key, recovery needs the live session/ACL/base, and a
  // lost key is a typed locked state that never replaces the row.
  const drafts = createDesktopDraftStore({ rootDirectory: join(app.getPath("userData"), "drafts"), keyStore: store });
  const session = { sessionId: "system-q8", deploymentId: "system", accountId: "account-a", generation: 1 };
  const identity = { deploymentId: "system", accountId: "account-a", organizationId: "local", workspaceId: "local", documentId: "local:system", base: { revision: "1", version: "sha256:".concat("a".repeat(64)) } };
  const lookup = { deploymentId: identity.deploymentId, accountId: identity.accountId, organizationId: identity.organizationId, workspaceId: identity.workspaceId, documentId: identity.documentId, draftId: "local:system:1" };
  await drafts.checkpointPlaintext({ session, identity, draftId: "local:system:1", generation: 1, plaintext: Buffer.from("protected system draft") });
  if ((await drafts.list({ session, lookup })).length !== 1) throw new Error("q8_checkpoint_missing");
  const draftRoot = join(app.getPath("userData"), "drafts");
  const rowNamespaces = await readdir(draftRoot);
  const rowDirectory = join(draftRoot, rowNamespaces[0]);
  const rowFiles = await readdir(rowDirectory);
  const rowFile = join(rowDirectory, rowFiles[0]);
  const ciphertextBefore = await readFile(rowFile, "utf8");
  if (ciphertextBefore.includes("protected system draft")) throw new Error("q8_plaintext_persisted");
  const recovered = await drafts.recoverPlaintext({ session, lookup, currentBase: identity.base, liveAccess: "edit" });
  if (recovered.status !== "recovered" || Buffer.from(recovered.plaintext).toString() !== "protected system draft") throw new Error("q8_recovery_failed");
  const blocked = await drafts.recoverPlaintext({ session, lookup, currentBase: identity.base, liveAccess: "none" });
  if (blocked.status !== "blocked") throw new Error("q8_acl_not_enforced");
  const conflicted = await drafts.recoverPlaintext({ session, lookup, currentBase: { revision: "2", version: "sha256:".concat("b".repeat(64)) }, liveAccess: "edit" });
  if (conflicted.status !== "conflict") throw new Error("q8_base_not_enforced");
  for (const keyFile of await readdir(keyDirectory)) await rm(join(keyDirectory, keyFile), { force: true });
  const locked = await drafts.recoverPlaintext({ session, lookup, currentBase: identity.base, liveAccess: "edit" });
  if (locked.status !== "locked") throw new Error("q8_key_loss_not_locked");
  if (await readFile(rowFile, "utf8") !== ciphertextBefore) throw new Error("q8_ciphertext_replaced");
  await writeFile(resultFile, JSON.stringify({ ok: true, available: true, q8: ["checkpoint", "recovery", "acl", "conflict", "key-lost", "ciphertext-retained"] }));
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
  process.stdout.write("desktop recovery system smoke: Windows safeStorage round trip, opaque key file, restricted ACL and delete verified; Q8 checkpoint/recovery/ACL/conflict/key-lost/ciphertext-retained verified\n");
} finally {
  if (process.env.OFFICE_DESKTOP_SYSTEM_KEEP !== "1") await rm(userData, { recursive: true, force: true });
  else process.stdout.write(`desktop recovery system smoke kept artifacts at ${userData}\n`);
}
