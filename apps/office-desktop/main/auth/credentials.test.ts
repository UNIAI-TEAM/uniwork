import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CredentialStoreError, KEYRING_REFUSAL_MESSAGE, createOsCredentialStore, type CredentialSession, type SafeStorageAdapter } from "./credentials";

const session: CredentialSession = { accountId: "account-a", deviceSessionId: "device-a", sessionId: "session-a", accessToken: "access-secret", refreshToken: "refresh-secret", expiresIn: 900, refreshExpiresIn: 2_592_000 };
function fakeSafeStorage(available = true): SafeStorageAdapter {
  return { isEncryptionAvailable: () => available, encryptString: (value) => Uint8Array.from(Buffer.from(value, "utf8").map((byte) => byte ^ 0xa5)), decryptString: (value) => Buffer.from(Uint8Array.from(value).map((byte) => byte ^ 0xa5)).toString("utf8") };
}
const NS = "deployment-a@0123456789ab";
function temp() { return mkdtempSync(join(tmpdir(), "uniwork-credential-test-")); }

describe("OS-backed credential store", () => {
  it("round-trips an encrypted pair in the channel/deployment/account namespace", async () => {
    const root = temp();
    try {
      const store = createOsCredentialStore({ userDataDirectory: root, channel: "dev", namespace: NS, safeStorage: fakeSafeStorage() });
      await store.save(session);
      expect(store.get()).toEqual(session);
      const files = readdirSync(join(root, "credentials", "dev", NS));
      expect(files).toHaveLength(2);
      expect(readFileSync(join(root, "credentials", "dev", NS, files[0]!)).toString()).not.toContain("access-secret");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it("fails closed when the OS store is locked and never falls back to plaintext", () => {
    const root = temp();
    try {
      const store = createOsCredentialStore({ userDataDirectory: root, channel: "dev", namespace: NS, safeStorage: fakeSafeStorage(false) });
      expect(() => store.get()).toThrowError(new CredentialStoreError("locked", "secure credential store is locked"));
      expect(() => store.save(session)).toThrowError(CredentialStoreError);
      expect(readdirSync(root)).toHaveLength(0);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it("refuses the Linux basic_text backend with the keyring reason and fix hint", () => {
    const root = temp();
    try {
      const store = createOsCredentialStore({ userDataDirectory: root, channel: "dev", namespace: NS, safeStorage: { ...fakeSafeStorage(), getSelectedStorageBackend: () => "basic_text" } });
      expect(() => store.get()).toThrowError(new CredentialStoreError("keyring_required", KEYRING_REFUSAL_MESSAGE));
      expect(() => store.save(session)).toThrowError(CredentialStoreError);
      expect(() => store.clear()).toThrowError(CredentialStoreError);
      expect(readdirSync(root)).toHaveLength(0);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it("accepts a Secret Service backend and treats a failing probe as unknown", async () => {
    const root = temp();
    try {
      const store = createOsCredentialStore({ userDataDirectory: root, channel: "dev", namespace: NS, safeStorage: { ...fakeSafeStorage(), getSelectedStorageBackend: () => "gnome_libsecret" } });
      await store.save(session);
      expect(store.get()).toEqual(session);
      const probeFails = createOsCredentialStore({ userDataDirectory: root, channel: "dev", namespace: NS, safeStorage: { ...fakeSafeStorage(), getSelectedStorageBackend: () => { throw new Error("unsupported on this platform"); } } });
      expect(probeFails.get()).toEqual(session);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it("keeps the previous pair if replacing the encrypted file tears", async () => {
    const root = temp();
    try {
      const store = createOsCredentialStore({ userDataDirectory: root, channel: "dev", namespace: NS, safeStorage: fakeSafeStorage() });
      await store.save(session);
      const original = store.get();
      const failingStore = createOsCredentialStore({ userDataDirectory: root, channel: "dev", namespace: NS, safeStorage: fakeSafeStorage(), fileSystem: {
        mkdirSync: () => undefined, readdirSync: (path) => readdirSync(path), existsSync: () => true, readFileSync: (path) => readFileSync(path),
        writeFileSync: () => undefined, openSync: () => 1, fsyncSync: () => undefined, closeSync: () => undefined, renameSync: () => { throw new Error("torn"); }, rmSync: () => undefined, chmodSync: () => undefined,
      } });
      expect(() => failingStore.save({ ...session, accessToken: "new-access" })).toThrowError(CredentialStoreError);
      expect(store.get()).toEqual(original);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it("reports corrupt selectors and clears the active pair without touching other namespaces", async () => {
    const root = temp();
    try {
      const store = createOsCredentialStore({ userDataDirectory: root, channel: "dev", namespace: NS, safeStorage: fakeSafeStorage() });
      await store.save(session);
      const active = join(root, "credentials", "dev", NS, ".active");
      writeFileSync(active, "missing-account", { mode: 0o600 });
      const reloaded = createOsCredentialStore({ userDataDirectory: root, channel: "dev", namespace: NS, safeStorage: fakeSafeStorage() });
      expect(() => reloaded.get()).toThrowError(CredentialStoreError);
      writeFileSync(active, "account-a", { mode: 0o600 });
      await store.clear();
      expect(store.get()).toBeUndefined();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it("refuses a namespace without the origin segment", () => {
    const root = temp();
    try {
      for (const namespace of ["deployment-a", "deployment-a@", "../x@0123456789ab", "deployment-a@0123456789AB"]) {
        expect(() => createOsCredentialStore({ userDataDirectory: root, channel: "dev", namespace, safeStorage: fakeSafeStorage() })).toThrowError(expect.objectContaining({ code: "corrupt" }));
      }
      expect(readdirSync(root)).toHaveLength(0);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
