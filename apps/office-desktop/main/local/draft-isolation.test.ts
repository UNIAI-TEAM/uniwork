import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDesktopDraftStore, type DraftKeyStore } from "../drafts/store";
import { createFakeDraftKeyStore } from "../drafts/test-fake";
import { decryptDraft, encryptDraft } from "../drafts/crypto";
import { createSafeStorageDraftKeyStore } from "../drafts/keystore";
import { localDraftIdentity } from "../files/protected-files";
import type { DraftIdentity, DraftSession } from "../../../../packages/core/office/draft-recovery";

const roots: string[] = [];
async function root(): Promise<string> { const path = resolve(".test-artifacts", `isolation-${Date.now()}-${Math.random().toString(16).slice(2)}`); await fs.mkdir(path, { recursive: true }); roots.push(path); return path; }
afterEach(async () => { while (roots.length) await fs.rm(roots.pop()!, { recursive: true, force: true }); });

const DEVICE_ID = "e".repeat(32);
const accountSession: DraftSession = { sessionId: "session-1", deploymentId: "dep", accountId: "account-a", generation: 1 };
const deviceSession: DraftSession = { sessionId: "session-1", deploymentId: "local-device", accountId: `local:${DEVICE_ID}`, generation: 1 };
const accountIdentity: DraftIdentity = { deploymentId: "dep", accountId: "account-a", organizationId: "org", workspaceId: "ws", documentId: "doc-account", base: { revision: "1", version: "v1" } };
const deviceIdentity = localDraftIdentity({ sessionId: "session-1", deploymentId: "local-device", accountId: `local:${DEVICE_ID}`, generation: 1 }, "local:path-hash", { handle: "file_abcdefghijklmnopqrstuvwxyzABCDEF", name: "local.docx", byteLength: 5, modifiedAtMs: 77, checksum: `sha256:${"a".repeat(64)}` });

function namespaces(keyStore: DraftKeyStore): { store: DraftKeyStore; seen: string[] } {
  const seen: string[] = [];
  return {
    seen,
    store: {
      async get(namespace) { seen.push(`get:${namespace}`); return keyStore.get(namespace); },
      async getOrCreate(namespace) { seen.push(`create:${namespace}`); return keyStore.getOrCreate(namespace); },
      async delete(namespace) { seen.push(`delete:${namespace}`); return keyStore.delete?.(namespace); },
    },
  };
}

describe("local:<device> draft namespace isolation", () => {
  it("never lists or recovers the other scope's rows", async () => {
    const rootDirectory = await root();
    const store = createDesktopDraftStore({ rootDirectory, keyStore: createFakeDraftKeyStore() });
    await store.checkpointPlaintext({ session: deviceSession, identity: deviceIdentity, draftId: "device-draft", generation: 1, plaintext: new TextEncoder().encode("device bytes") });
    await store.checkpointPlaintext({ session: accountSession, identity: accountIdentity, draftId: "account-draft", generation: 1, plaintext: new TextEncoder().encode("account bytes") });

    const accountRows = await store.list({ session: accountSession });
    expect(accountRows.map((row) => row.draftId)).toEqual(["account-draft"]);
    const deviceRows = await store.list({ session: deviceSession });
    expect(deviceRows.map((row) => row.draftId)).toEqual(["device-draft"]);

    const deviceLookup = { deploymentId: deviceIdentity.deploymentId, accountId: deviceIdentity.accountId, organizationId: deviceIdentity.organizationId, workspaceId: deviceIdentity.workspaceId, documentId: deviceIdentity.documentId };
    const accountLookup = { deploymentId: accountIdentity.deploymentId, accountId: accountIdentity.accountId, organizationId: accountIdentity.organizationId, workspaceId: accountIdentity.workspaceId, documentId: accountIdentity.documentId };
    await expect(store.recover({ session: accountSession, lookup: deviceLookup, currentBase: deviceIdentity.base, liveAccess: "edit" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(store.recover({ session: deviceSession, lookup: accountLookup, currentBase: accountIdentity.base, liveAccess: "edit" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(store.recoverPlaintext({ session: accountSession, lookup: deviceLookup, currentBase: deviceIdentity.base, liveAccess: "edit" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(store.list({ session: { ...accountSession, sessionId: "session-1" }, lookup: deviceLookup })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("derives different key namespaces for the two scopes and binds the ciphertext to its identity", async () => {
    const rootDirectory = await root();
    const fake = createFakeDraftKeyStore();
    const { store: keyStore, seen } = namespaces(fake);
    const store = createDesktopDraftStore({ rootDirectory, keyStore });
    await store.checkpointPlaintext({ session: deviceSession, identity: deviceIdentity, draftId: "device-draft", generation: 1, plaintext: new TextEncoder().encode("device bytes") });
    await store.checkpointPlaintext({ session: accountSession, identity: accountIdentity, draftId: "account-draft", generation: 1, plaintext: new TextEncoder().encode("account bytes") });
    const deviceNamespace = seen.find((entry) => entry.startsWith("create:"))!;
    const accountNamespace = seen.filter((entry) => entry.startsWith("create:"))[1]!;
    expect(deviceNamespace).not.toBe(accountNamespace);

    const deviceKey = await fake.getOrCreate(deviceNamespace.slice("create:".length));
    const accountKey = await fake.getOrCreate(accountNamespace.slice("create:".length));
    const ciphertext = new TextEncoder().encode("bound");
    const encrypted = encryptDraft(deviceKey, ciphertext, deviceIdentity, 3, (size) => new Uint8Array(size).fill(9));
    expect(() => decryptDraft(accountKey, encrypted, deviceIdentity, 3)).toThrow();
    expect(() => decryptDraft(deviceKey, encrypted, accountIdentity, 3)).toThrow();
    expect(new TextDecoder().decode(decryptDraft(deviceKey, encrypted, deviceIdentity, 3))).toBe("bound");
  });

  it("never writes the protected draft as plaintext on disk", async () => {
    const rootDirectory = await root();
    const store = createDesktopDraftStore({ rootDirectory, keyStore: createFakeDraftKeyStore() });
    await store.checkpointPlaintext({ session: deviceSession, identity: deviceIdentity, draftId: "device-draft", generation: 1, plaintext: new TextEncoder().encode("top secret local bytes") });
    const namespaces = await fs.readdir(rootDirectory);
    expect(namespaces).toHaveLength(1);
    const files = await fs.readdir(join(rootDirectory, namespaces[0]!));
    expect(files).toHaveLength(1);
    const raw = await fs.readFile(join(rootDirectory, namespaces[0]!, files[0]!), "utf8");
    expect(raw).not.toContain("top secret local bytes");
    expect(raw).not.toContain("device bytes");
  });

  it("reports a typed reason and writes no fallback when the OS key store is unavailable", async () => {
    const rootDirectory = await root();
    const keyStore = createSafeStorageDraftKeyStore({
      userDataDirectory: join(rootDirectory, "keys"),
      channel: "dev",
      keyNamespace: "uniwork-office-test",
      safeStorage: {
        isEncryptionAvailable: () => false,
        encryptString: () => { throw new Error("encrypt must not be reached"); },
        decryptString: () => { throw new Error("decrypt must not be reached"); },
      },
    });
    await expect(keyStore.getOrCreate("local-device")).rejects.toMatchObject({ code: "locked" });
    const store = createDesktopDraftStore({ rootDirectory: join(rootDirectory, "drafts"), keyStore });
    await expect(store.checkpointPlaintext({ session: deviceSession, identity: deviceIdentity, draftId: "device-draft", generation: 1, plaintext: new TextEncoder().encode("must not be stored") }))
      .rejects.toMatchObject({ code: "draft_recovery_locked" });
    await expect(fs.readdir(join(rootDirectory, "drafts"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
