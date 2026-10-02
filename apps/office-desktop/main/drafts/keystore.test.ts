import { expect, it } from "vitest";
import { createSafeStorageDraftKeyStore, DraftKeyStoreError, windowsSystemPath, windowsWhoamiPath, type DraftKeyFileSystem, type DraftSafeStorage } from "./keystore";

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
