import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createSafeStorageDraftKeyStore, DraftKeyStoreError, windowsAclPath, windowsSystemPath, windowsWhoamiPath, type DraftKeyFileSystem, type DraftSafeStorage } from "./keystore";

function fakeStore() {
  const files = new Map<string, Uint8Array>();
  let available = true;
  const safeStorage: DraftSafeStorage = {
    isEncryptionAvailable: () => available,
    encryptString: (value) => new TextEncoder().encode(value).slice().reverse(),
    decryptString: (value) => new TextDecoder().decode(value.slice().reverse()),
  };
  const fileSystem: DraftKeyFileSystem = {
    mkdir: async () => undefined,
    readFile: async (path) => { const bytes = files.get(path); if (!bytes) { const error = Object.assign(new Error("missing"), { code: "ENOENT" }); throw error; } return bytes.slice(); },
    writeFile: async (path, data) => { if (files.has(path)) { const error = Object.assign(new Error("exists"), { code: "EEXIST" }); throw error; } files.set(path, data.slice()); },
    open: async () => ({ sync: async () => undefined, close: async () => undefined }),
    rename: async (from, to) => { const bytes = files.get(from); if (!bytes) throw new Error("missing"); files.delete(from); files.set(to, bytes); },
    rm: async (path) => { files.delete(path); },
    chmod: async () => undefined,
  };
  return { files, safeStorage, fileSystem, setAvailable: (value: boolean) => { available = value; } };
}

it("round trips one key per namespace and deletes it explicitly", async () => {
  const fake = fakeStore();
  const store = createSafeStorageDraftKeyStore({ userDataDirectory: "D:/test", channel: "dev", keyNamespace: "uniwork-office-dev", safeStorage: fake.safeStorage, fileSystem: fake.fileSystem, restrictFile: async () => undefined, randomBytes: (size) => new Uint8Array(size).fill(7) });
  const first = await store.getOrCreate("namespace-a");
  await expect(store.get("namespace-a")).resolves.toEqual(first);
  await expect(store.getOrCreate("namespace-a")).resolves.toEqual(first);
  await store.delete("namespace-a");
  await expect(store.get("namespace-a")).resolves.toBeUndefined();
});

it("fails closed while the OS store is locked and for corrupt ciphertext", async () => {
  const fake = fakeStore();
  const store = createSafeStorageDraftKeyStore({ userDataDirectory: "D:/test", channel: "dev", keyNamespace: "uniwork-office-dev", safeStorage: fake.safeStorage, fileSystem: fake.fileSystem, restrictFile: async () => undefined });
  await store.getOrCreate("namespace-a");
  fake.setAvailable(false);
  await expect(store.get("namespace-a")).rejects.toMatchObject({ code: "locked" });
  fake.setAvailable(true);
  const keyPath = [...fake.files.keys()].find((path) => path.endsWith("namespace-a.key"));
  expect(keyPath).toBeDefined();
  fake.files.set(keyPath!, new Uint8Array([1, 2, 3]));
  await expect(store.get("namespace-a")).rejects.toMatchObject({ code: "corrupt" });
  // A corrupt key is never replaced by freshly generated material.
  await expect(store.getOrCreate("namespace-a")).rejects.toMatchObject({ code: "corrupt" });
  expect(fake.files.get(keyPath!)).toEqual(new Uint8Array([1, 2, 3]));
});

it("refuses a plaintext safeStorage backend and creates no key material", async () => {
  const fake = fakeStore();
  const store = createSafeStorageDraftKeyStore({ userDataDirectory: "D:/test", channel: "dev", keyNamespace: "uniwork-office-dev", safeStorage: { ...fake.safeStorage, getSelectedStorageBackend: () => "basic_text" }, fileSystem: fake.fileSystem, restrictFile: async () => undefined });
  await expect(store.getOrCreate("namespace-a")).rejects.toMatchObject({ code: "locked" });
  expect(fake.files.size).toBe(0);
});

it("keeps one key across concurrent calls and independent store instances", async () => {
  const fake = fakeStore();
  const options = { userDataDirectory: "D:/test", channel: "dev", keyNamespace: "uniwork-office-dev", safeStorage: fake.safeStorage, fileSystem: fake.fileSystem, restrictFile: async () => undefined } as const;
  const store = createSafeStorageDraftKeyStore(options);
  const [first, second] = await Promise.all([store.getOrCreate("namespace-a"), store.getOrCreate("namespace-a")]);
  expect(first).toHaveLength(32);
  expect(first).toEqual(second);
  await expect(createSafeStorageDraftKeyStore(options).getOrCreate("namespace-a")).resolves.toEqual(first);
  await expect(store.getOrCreate("namespace-b")).resolves.not.toEqual(first);
});

it("rejects an invalid key namespace without revealing path data", () => {
  const fake = fakeStore();
  expect(() => createSafeStorageDraftKeyStore({ userDataDirectory: "D:/test", channel: "dev", keyNamespace: "bad/namespace", safeStorage: fake.safeStorage, fileSystem: fake.fileSystem })).toThrow(DraftKeyStoreError);
});

it("resolves whoami through the absolute Windows System32 path", () => {
  expect(windowsWhoamiPath("C:\\Windows")).toBe("C:\\Windows\\System32\\whoami.exe");
  expect(windowsWhoamiPath("D:\\Windows")).toBe("D:\\Windows\\System32\\whoami.exe");
  expect(windowsSystemPath("icacls.exe", "C:\\Windows")).toBe("C:\\Windows\\System32\\icacls.exe");
  expect(() => windowsWhoamiPath("Windows")).toThrowError(DraftKeyStoreError);
  expect(() => windowsWhoamiPath("")).toThrowError(DraftKeyStoreError);
  expect(() => windowsSystemPath("whoami", "C:\\Windows")).toThrowError(DraftKeyStoreError);
  const original = process.env.SystemRoot;
  try {
    delete process.env.SystemRoot;
    expect(() => windowsWhoamiPath()).toThrowError(DraftKeyStoreError);
  } finally {
    if (original !== undefined) process.env.SystemRoot = original;
  }
});

it("hands icacls the extended-length form of a key path", () => {
  expect(windowsAclPath(String.raw`C:\Users\a\draft-keys\x.key`)).toBe(String.raw`\\?\C:\Users\a\draft-keys\x.key`);
  expect(windowsAclPath("D:/deep/dir/x.key")).toBe(String.raw`\\?\D:\deep\dir\x.key`);
  expect(windowsAclPath(String.raw`\\server\share\x.key`)).toBe(String.raw`\\?\UNC\server\share\x.key`);
  expect(windowsAclPath(String.raw`\\?\C:\x.key`)).toBe(String.raw`\\?\C:\x.key`);
});

// Regression: a userData directory deep enough that the draft key temp file
// passes MAX_PATH made the real icacls fail, so every draft checkpoint (and the
// protective checkpoint a local Save writes first) failed as locked.
it.runIf(process.platform === "win32")("creates a draft key with the real Windows ACL under a path past MAX_PATH", async () => {
  const root = mkdtempSync(join(tmpdir(), "uniwork-keystore-"));
  try {
    const userDataDirectory = join(root, "d".repeat(80), "e".repeat(80));
    const store = createSafeStorageDraftKeyStore({ userDataDirectory, channel: "dev", keyNamespace: "uniwork-office-dev", safeStorage: fakeStore().safeStorage });
    const namespace = "a".repeat(64);
    const key = await store.getOrCreate(namespace);
    expect(key.byteLength).toBe(32);
    expect(await store.get(namespace)).toEqual(key);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
