/* global process */
// Headless-keyring probe, the part that decides (UNI-1376, g7-qa spike). It runs
// in Electron's main process, handed the fork's OWN credential store
// (apps/shell/src/main/uniwork-auth/credentials.ts `createCredentialStore`, the
// module the app signs a desktop session in with) and Electron's real
// `safeStorage`. No toy encrypt/decrypt: a save and a load go through the same
// function the app calls, so `status` is what the app would report.
//
// It lives apart from keyring-probe-main.mjs (which imports `electron`) so a
// plain `node --test` can pin the logic with a fake store and safeStorage.
//
// No secret value ever leaves this function: the credential's token is random,
// compared in memory and never returned; the result carries booleans, a coarse
// error code and a byte count.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** The store's own error codes (credentials.ts CredentialStoreErrorCode); anything else is "error". */
const KNOWN_CODES = new Set(["keyring_unavailable", "io"]);

/** One call that may throw: its value, or `fallback` (a safeStorage probe must never end the run). */
function attempt(call, fallback) {
  try {
    const value = call();
    return value === undefined ? fallback : value;
  } catch {
    return fallback;
  }
}

/** The shape of a credential the store accepts (credentials.ts isStoredCredential), with a random token. */
export function probeCredential(token) {
  return {
    deploymentId: "keyring-probe",
    apiOrigin: "http://127.0.0.1:9",
    clientId: "uniwork-office-dev",
    accountId: "acc_probe",
    deviceSessionId: "dev_probe",
    sessionId: "sess_probe",
    refreshToken: token,
    refreshExpiresAt: 4_102_444_800_000,
  };
}

/**
 * @param {object} deps
 * @param {(options: { userDataDir: string, safeStorage: object }) => { load(): object | null, save(c: object): void, clear(): void, canStore(): boolean }} deps.createCredentialStore
 * @param {{ isEncryptionAvailable(): boolean, getSelectedStorageBackend?(): string }} deps.safeStorage
 * @param {string} deps.userDataDir
 * @returns {{ probe: "keyring", platform: string, backend: string, encryptionAvailable: boolean, canStore: boolean, roundTrip: "ok" | "fail", status: "ready" | "keyring_unavailable" | "io" | "error", errorCode: string | null, sessionFileBytes: number | null, plaintextInFile: boolean | null }}
 */
export function runProbe({ createCredentialStore, safeStorage, userDataDir }) {
  const backend = attempt(() => safeStorage.getSelectedStorageBackend?.(), "unsupported");
  const encryptionAvailable = attempt(() => safeStorage.isEncryptionAvailable() === true, false);
  const store = createCredentialStore({ userDataDir, safeStorage });
  const canStore = attempt(() => store.canStore() === true, false);

  const token = randomBytes(24).toString("hex");
  const sessionFile = join(userDataDir, "uniwork-auth", "session.bin");
  let roundTrip = "fail";
  let errorCode = null;
  let sessionFileBytes = null;
  let plaintextInFile = null;
  try {
    store.save(probeCredential(token));
    if (existsSync(sessionFile)) {
      sessionFileBytes = statSync(sessionFile).size;
      plaintextInFile = readFileSync(sessionFile).toString("latin1").includes(token);
    }
    const loaded = store.load();
    // the decrypted token must equal what was saved, and the file must not hold it in the clear
    if (loaded?.refreshToken === token && plaintextInFile === false) roundTrip = "ok";
  } catch (error) {
    // the store's coarse code only: its messages and stacks carry no value, but nothing here prints them anyway
    const code = error && typeof error === "object" ? error.code : undefined;
    errorCode = KNOWN_CODES.has(code) ? code : "error";
  } finally {
    attempt(() => store.clear(), undefined);
  }

  let status = "ready";
  if (roundTrip !== "ok") status = errorCode ?? "error";
  return {
    probe: "keyring",
    platform: process.platform,
    backend,
    encryptionAvailable,
    canStore,
    roundTrip,
    status,
    errorCode,
    sessionFileBytes,
    plaintextInFile,
  };
}
