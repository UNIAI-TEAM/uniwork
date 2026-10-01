import { afterEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import { createDesktopDraftStore, DRAFT_TEMP_PREFIX } from "./store";
import { createFakeDraftKeyStore } from "./test-fake";
import { checksum, decryptDraft, encryptDraft } from "./crypto";
import { DraftRecoveryError, type DraftIdentity, type DraftSession } from "../../../../packages/core/office/draft-recovery";
import { runDraftRecoveryAdapterBehaviorSuite, type DraftRecoveryBehaviorHarness } from "../../../../packages/core/office/draft-recovery.behavior";

const roots: string[] = [];
async function root(): Promise<string> { const path = resolve(".test-artifacts", `draft-${Date.now()}-${Math.random().toString(16).slice(2)}`); await fs.mkdir(path, { recursive: true }); roots.push(path); return path; }
afterEach(async () => { while (roots.length) await fs.rm(roots.pop()!, { recursive: true, force: true }); });

const identity: DraftIdentity = { deploymentId: "dep", accountId: "a", organizationId: "org", workspaceId: "ws", documentId: "doc", base: { revision: "r1", version: "v1" } };
const session: DraftSession = { sessionId: "session-a", deploymentId: "dep", accountId: "a", generation: 1 };

describe("desktop protected drafts", () => {
  it("passes the shared Q8 adapter behavior suite", async () => {
    const store = createDesktopDraftStore({ rootDirectory: await root(), keyStore: createFakeDraftKeyStore() });
    const harnessFactory = (): DraftRecoveryBehaviorHarness => ({ adapter: store, sessions: { accountA: { sessionId: "session-a", deploymentId: "deployment-test", accountId: "account-a", generation: 1 }, accountB: { sessionId: "session-b", deploymentId: "deployment-test", accountId: "account-b", generation: 1 }, accountAAfterRestart: { sessionId: "session-a-restart", deploymentId: "deployment-test", accountId: "account-a", generation: 2 } }, revoke: (sessionId) => store.revokeSession(sessionId), setLocked: (locked) => store.setLocked(locked), failNextCheckpoint: () => store.failNextCheckpoint() });
    const report = await runDraftRecoveryAdapterBehaviorSuite(harnessFactory);
    expect(report.passed.length).toBeGreaterThan(10);
  });
  it("computes a stable ciphertext checksum", () => expect(checksum(new Uint8Array([1, 2]))).toMatch(/^sha256:[0-9a-f]{64}$/));
  it("encrypts/authenticates with identity and base AAD", () => {
    const key = new Uint8Array(32).fill(7); const plaintext = new TextEncoder().encode("secret");
    const encrypted = encryptDraft(key, plaintext, identity, 1, (size) => new Uint8Array(size).fill(4));
    expect(encrypted.ciphertext).not.toEqual(plaintext);
    expect(decryptDraft(key, encrypted, identity, 1)).toEqual(plaintext);
    expect(() => decryptDraft(key, encrypted, { ...identity, accountId: "b" }, 1)).toThrow();
    expect(() => decryptDraft(key, encrypted, identity, 2)).toThrow();
    expect(() => encryptDraft(new Uint8Array(4), plaintext, identity, 1)).toThrow();
    expect(() => decryptDraft(key, { nonce: new Uint8Array(1), ciphertext: new Uint8Array(1) }, identity, 1)).toThrow();
  });

  it("round-trips encrypted plaintext and isolates account/base", async () => {
    const store = createDesktopDraftStore({ rootDirectory: await root(), keyStore: createFakeDraftKeyStore(), randomBytes: (size) => new Uint8Array(size).fill(8) });
    const bytes = new TextEncoder().encode("draft bytes");
    const metadata = await store.checkpointPlaintext({ session, identity, draftId: "draft-1", generation: 1, plaintext: bytes });
    const recovered = await store.recoverPlaintext({ session, lookup: identity, currentBase: identity.base, liveAccess: "edit" });
    expect(recovered).toMatchObject({ metadata: { checksum: metadata.checksum } });
    if (recovered.status === "recovered") expect(new TextDecoder().decode(recovered.plaintext)).toBe("draft bytes");
    const accountB: DraftSession = { ...session, accountId: "b", sessionId: "session-b" };
    await expect(store.list({ session: accountB, lookup: identity })).rejects.toMatchObject({ code: "forbidden" });
    const conflict = await store.recover({ session, lookup: identity, currentBase: { revision: "changed", version: "v1" }, liveAccess: "edit" });
    expect(conflict.status).toBe("conflict");
  });

  it("serializes overlapping checkpoints so an older generation cannot win", async () => {
    const store = createDesktopDraftStore({ rootDirectory: await root(), keyStore: createFakeDraftKeyStore(), randomBytes: (size) => new Uint8Array(size).fill(9) });
    const older = store.checkpointPlaintext({ session, identity, draftId: "race", generation: 2, plaintext: new TextEncoder().encode("gen2") });
    const newer = store.checkpointPlaintext({ session, identity, draftId: "race", generation: 3, plaintext: new TextEncoder().encode("gen3") });
    await Promise.all([older, newer]);
    const recovered = await store.recoverPlaintext({ session, lookup: { ...identity, draftId: "race" }, currentBase: identity.base, liveAccess: "edit" });
    expect(recovered.status).toBe("recovered");
    if (recovered.status === "recovered") {
      expect(recovered.metadata.generation).toBe(3);
      expect(new TextDecoder().decode(recovered.plaintext)).toBe("gen3");
    }
  });

  it("refuses compare-and-delete when a draft id is ambiguous", async () => {
    const store = createDesktopDraftStore({ rootDirectory: await root(), keyStore: createFakeDraftKeyStore() });
    const otherIdentity: DraftIdentity = { ...identity, documentId: "other-doc" };
    await store.checkpointPlaintext({ session, identity, draftId: "duplicate", generation: 1, plaintext: new TextEncoder().encode("one") });
    await store.checkpointPlaintext({ session, identity: otherIdentity, draftId: "duplicate", generation: 1, plaintext: new TextEncoder().encode("two") });
    await expect(store.deleteDurable({ session, draftId: "duplicate", generation: 1 })).rejects.toMatchObject({ code: "forbidden" });
    expect((await store.list({ session, lookup: identity })).some((row) => row.draftId === "duplicate")).toBe(true);
    expect((await store.list({ session, lookup: otherIdentity })).some((row) => row.draftId === "duplicate")).toBe(true);
  });

  it("atomically preserves the previous row and cleans plaintext temps", async () => {
    const rootPath = await root(); const store = createDesktopDraftStore({ rootDirectory: rootPath, tempDirectory: rootPath, keyStore: createFakeDraftKeyStore() });
    await store.checkpointPlaintext({ session, identity, draftId: "draft-1", generation: 1, plaintext: new TextEncoder().encode("old") });
    store.failNextCheckpoint();
    await expect(store.checkpointPlaintext({ session, identity, draftId: "draft-1", generation: 2, plaintext: new TextEncoder().encode("new") })).rejects.toMatchObject({ code: "storage_unavailable" });
    const recovered = await store.recoverPlaintext({ session, lookup: identity, currentBase: identity.base, liveAccess: "edit" });
    expect(recovered.status).toBe("recovered");
    if (recovered.status === "recovered") expect(new TextDecoder().decode(recovered.plaintext)).toBe("old");
    await store.withPlaintextTemp(new TextEncoder().encode("temporary"), async (path) => { expect(await fs.readFile(path, "utf8")).toBe("temporary"); return undefined; });
    expect((await fs.readdir(rootPath)).some((entry) => entry.startsWith(DRAFT_TEMP_PREFIX))).toBe(false);
    expect((await fs.readdir(rootPath)).some((entry) => entry.startsWith("uniwork-office-draft-"))).toBe(false);
  });

  it("checkpoint scheduler writes only its durable draft row", async () => {
    const rootPath = await root(); const targetPath = join(rootPath, "target.docx");
    const writeFile = vi.spyOn(fs, "writeFile");
    const store = createDesktopDraftStore({ rootDirectory: rootPath, keyStore: createFakeDraftKeyStore() });
    store.scheduleCheckpoint({ session, identity, draftId: "draft-1", generation: 1, plaintext: new TextEncoder().encode("local") }, true);
    await store.flushScheduled();
    expect((await store.list({ session, lookup: identity })).length).toBe(1);
    expect(writeFile.mock.calls.some(([path]) => String(path) === targetPath)).toBe(false);
    writeFile.mockRestore();
  });

  it("returns locked rather than an empty draft for a corrupt record", async () => {
    const rootPath = await root(); const store = createDesktopDraftStore({ rootDirectory: rootPath, keyStore: createFakeDraftKeyStore() });
    await store.checkpointPlaintext({ session, identity, draftId: "draft-1", generation: 1, plaintext: new TextEncoder().encode("old") });
    const namespace = (await fs.readdir(rootPath))[0]!; const record = join(rootPath, namespace, (await fs.readdir(join(rootPath, namespace)))[0]!);
    await fs.writeFile(record, "not-json");
    await expect(store.recover({ session, lookup: identity, currentBase: identity.base, liveAccess: "edit" })).rejects.toMatchObject({ code: "draft_recovery_locked" });
    expect(DraftRecoveryError).toBeDefined();
  });

  it("does not treat an adapter ciphertext row as plaintext", async () => {
    const store = createDesktopDraftStore({ rootDirectory: await root(), keyStore: createFakeDraftKeyStore() });
    await store.checkpoint({ session, snapshot: { draftId: "raw", identity, generation: 1, checksum: "sha256:raw", ciphertext: new Uint8Array([1, 2, 3]) } });
    const result = await store.recoverPlaintext({ session, lookup: identity, currentBase: identity.base, liveAccess: "edit" });
    expect(result.status).toBe("locked");
  });
});
