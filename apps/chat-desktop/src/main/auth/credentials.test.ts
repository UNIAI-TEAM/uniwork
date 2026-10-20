import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CredentialStoreError,
  createCredentialStore,
  type SafeStorageLike,
  type StoredCredential,
} from "./credentials";

/** reversible stand-in for DPAPI/Keychain: never leaves the plaintext readable */
function fakeSafeStorage(overrides: Partial<SafeStorageLike> = {}): SafeStorageLike {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (text) =>
      Buffer.from(`ENC1${Buffer.from(text).toString("base64")}`.split("").reverse().join("")),
    decryptString: (buf) => {
      const raw = buf.toString().split("").reverse().join("");
      if (!raw.startsWith("ENC1")) throw new Error("bad ciphertext");
      return Buffer.from(raw.slice(4), "base64").toString();
    },
    ...overrides,
  };
}

const credential = (refreshToken = "rt_secret_value_1"): StoredCredential => ({
  deploymentId: "default",
  apiOrigin: "https://uniwork.example",
  clientId: "uniwork-chat-desktop",
  accountId: "acc_1",
  deviceSessionId: "dev_1",
  sessionId: "sess_1",
  refreshToken,
  refreshExpiresAt: 1_900_000_000_000,
});

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "uw-cred-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const authDir = () => join(dir, "unichat-auth");
const sessionFile = () => join(authDir(), "session.bin");
const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(CredentialStoreError);
    return (error as CredentialStoreError).code;
  }
  throw new Error("expected a CredentialStoreError");
};

describe("credential store", () => {
  it("round-trips a credential through safeStorage", () => {
    const store = createCredentialStore({ userDataDir: dir, safeStorage: fakeSafeStorage() });
    expect(store.load()).toBeNull();
    store.save(credential());
    expect(store.load()).toEqual(credential());
  });

  it("never writes the refresh token in plaintext", () => {
    const store = createCredentialStore({ userDataDir: dir, safeStorage: fakeSafeStorage() });
    store.save(credential("rt_secret_value_1"));
    store.save(credential("rt_secret_value_2"));
    for (const name of readdirSync(authDir())) {
      expect(readFileSync(join(authDir(), name)).toString()).not.toContain("rt_secret_value");
    }
  });

  it("refuses the Linux basic_text backend (no plaintext fallback)", () => {
    const store = createCredentialStore({
      userDataDir: dir,
      safeStorage: fakeSafeStorage({ getSelectedStorageBackend: () => "basic_text" }),
    });
    expect(codeOf(() => store.save(credential()))).toBe("keyring_unavailable");
    expect(() => store.load()).toThrowError(/keyring_unavailable/);
    expect(() => readFileSync(sessionFile())).toThrow();
  });

  it("refuses when encryption is unavailable or the backend probe throws", () => {
    const store = createCredentialStore({
      userDataDir: dir,
      safeStorage: fakeSafeStorage({ isEncryptionAvailable: () => false }),
    });
    expect(codeOf(() => store.save(credential()))).toBe("keyring_unavailable");
    const throwing = createCredentialStore({
      userDataDir: dir,
      safeStorage: fakeSafeStorage({
        getSelectedStorageBackend: () => {
          throw new Error("not on Linux");
        },
        isEncryptionAvailable: () => {
          throw new Error("not ready");
        },
      }),
    });
    expect(codeOf(() => throwing.load())).toBe("keyring_unavailable");
  });

  it("keeps the file and reports keystore_locked when decryption fails (locked keyring)", () => {
    const writer = createCredentialStore({ userDataDir: dir, safeStorage: fakeSafeStorage() });
    writer.save(credential());
    const locked = createCredentialStore({
      userDataDir: dir,
      safeStorage: fakeSafeStorage({
        decryptString: () => {
          throw new Error("keychain access denied");
        },
      }),
    });
    expect(codeOf(() => locked.load())).toBe("keystore_locked");
    // the refresh token survives: once the keyring opens again it is still there
    expect(readdirSync(authDir())).toEqual(["session.bin"]);
    expect(writer.load()).toEqual(credential());
  });

  it("a keychain that locks at save time reports keystore_locked, never io", () => {
    let locked = false;
    const base = fakeSafeStorage();
    const store = createCredentialStore({
      userDataDir: dir,
      safeStorage: fakeSafeStorage({
        encryptString: (text) => {
          if (locked) throw new Error("keychain access denied");
          return base.encryptString(text);
        },
      }),
    });
    store.save(credential("rt_secret_value_1"));
    const before = readFileSync(sessionFile());
    locked = true;
    expect(codeOf(() => store.save(credential("rt_secret_value_2")))).toBe("keystore_locked");
    locked = false;
    // refused before any write: no replacement and no leftover temp file
    expect(store.load()?.refreshToken).toBe("rt_secret_value_1");
    expect(readFileSync(sessionFile())).toEqual(before);
    expect(readdirSync(authDir())).toEqual(["session.bin"]);
  });

  it("a filesystem failure at save time is still io", () => {
    const store = createCredentialStore({ userDataDir: dir, safeStorage: fakeSafeStorage() });
    // a file sits where the credential directory belongs: the write cannot land
    writeFileSync(authDir(), "not a directory");
    expect(codeOf(() => store.save(credential()))).toBe("io");
  });

  it("rejects a credential with a missing or empty field without writing", () => {
    const store = createCredentialStore({ userDataDir: dir, safeStorage: fakeSafeStorage() });
    expect(codeOf(() => store.save({ ...credential(), refreshToken: "" }))).toBe("io");
    expect(codeOf(() => store.save({ ...credential(), refreshExpiresAt: Number.NaN }))).toBe("io");
    expect(readdirSync(dir)).toEqual([]);
  });

  it("a fresh save replaces a credential the keyring can no longer decrypt", () => {
    // written under an old OS key; the current key cannot open it
    const old = createCredentialStore({ userDataDir: dir, safeStorage: fakeSafeStorage() });
    old.save(credential("rt_secret_value_old"));
    writeFileSync(sessionFile(), Buffer.from("bytes from another key"));
    const store = createCredentialStore({ userDataDir: dir, safeStorage: fakeSafeStorage() });
    expect(() => store.load()).toThrow(CredentialStoreError);
    expect(store.canStore()).toBe(true);
    store.save(credential("rt_secret_value_new"));
    expect(store.load()?.refreshToken).toBe("rt_secret_value_new");
  });

  it("canStore() is false without usable encryption and writes nothing", () => {
    const cases: Partial<SafeStorageLike>[] = [
      { isEncryptionAvailable: () => false },
      { getSelectedStorageBackend: () => "basic_text" },
      {
        encryptString: () => {
          throw new Error("keychain access denied");
        },
      },
    ];
    for (const overrides of cases) {
      const store = createCredentialStore({ userDataDir: dir, safeStorage: fakeSafeStorage(overrides) });
      expect(store.canStore()).toBe(false);
    }
    expect(readdirSync(dir)).toEqual([]);
  });

  it("drops a file that decrypts to garbage or to a foreign shape", () => {
    const store = createCredentialStore({ userDataDir: dir, safeStorage: fakeSafeStorage() });
    store.save(credential());
    writeFileSync(sessionFile(), fakeSafeStorage().encryptString("{not json"));
    expect(store.load()).toBeNull();
    expect(readdirSync(authDir())).toEqual([]);
    store.save(credential());
    writeFileSync(sessionFile(), fakeSafeStorage().encryptString(JSON.stringify({ version: 1, credential: { x: 1 } })));
    expect(store.load()).toBeNull();
    store.save(credential());
    writeFileSync(sessionFile(), fakeSafeStorage().encryptString(JSON.stringify({ version: 1, credential: null })));
    expect(store.load()).toBeNull();
    store.save(credential());
    writeFileSync(sessionFile(), fakeSafeStorage().encryptString("null"));
    expect(store.load()).toBeNull();
    expect(readdirSync(authDir())).toEqual([]);
  });

  it("leaves a newer-format file alone and reads as signed out", () => {
    const store = createCredentialStore({ userDataDir: dir, safeStorage: fakeSafeStorage() });
    store.save(credential());
    const newer = fakeSafeStorage().encryptString(JSON.stringify({ version: 99, credential: {} }));
    writeFileSync(sessionFile(), newer);
    expect(store.load()).toBeNull();
    expect(readFileSync(sessionFile())).toEqual(newer);
  });

  it("never resurrects a rotated-out refresh token (no backup copy)", () => {
    const store = createCredentialStore({ userDataDir: dir, safeStorage: fakeSafeStorage() });
    store.save(credential("rt_secret_value_1"));
    store.save(credential("rt_secret_value_2"));
    expect(readdirSync(authDir())).toEqual(["session.bin"]);
    expect(store.load()?.refreshToken).toBe("rt_secret_value_2");
  });

  it("clear removes the credential and tolerates a missing file", () => {
    const store = createCredentialStore({ userDataDir: dir, safeStorage: fakeSafeStorage() });
    store.clear();
    store.save(credential());
    store.clear();
    expect(store.load()).toBeNull();
    expect(readdirSync(authDir())).toEqual([]);
  });
});
