import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { type DraftIdentity, type DraftSession } from "../../../packages/core/office/draft-recovery";
import { createDesktopDraftStore, type DesktopDraftStore } from "./drafts/store";
import { createSafeStorageDraftKeyStore } from "./drafts/keystore";
import { createDraftIpcHandlers } from "./ipc";
import { assertRecoveryActionAllowed } from "./lifecycle";

const DEPLOYMENT = "deployment-a";
const WORKSPACE = "ws-1";
const DOCUMENT = "doc-1";
const BASE = { revision: "7", version: "v7" };
const OTHER_BASE = { revision: "8", version: "v8" };
const SESSION_GENERATION = "desktop-dev-session";

const bytes = (...values: number[]) => Uint8Array.from(values);
const encoded = (value: Uint8Array) => Buffer.from(value).toString("base64");

function identity(accountId: string, base = BASE, documentId = DOCUMENT): DraftIdentity {
  return { deploymentId: DEPLOYMENT, accountId, organizationId: "org-1", workspaceId: WORKSPACE, documentId, base };
}

function session(accountId: string, generation = 1): DraftSession {
  return { sessionId: SESSION_GENERATION, deploymentId: DEPLOYMENT, accountId, generation };
}

async function harness() {
  const parent = resolve(process.cwd(), "../../.uniwork-dev-run/q8");
  await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(join(parent, "case-"));
  const keyRoot = join(root, "user-data");
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Uint8Array.from(Buffer.from(value)),
    decryptString: (value: Uint8Array) => Buffer.from(value).toString(),
  };
  const keyStore = createSafeStorageDraftKeyStore({ userDataDirectory: keyRoot, channel: "dev", keyNamespace: "uniwork-office-dev", safeStorage, restrictFile: async () => undefined });
  const store: DesktopDraftStore = createDesktopDraftStore({ rootDirectory: join(root, "drafts"), keyStore });
  const live = { session: session("account-a"), identity: identity("account-a"), acl: "edit" as "edit" | "none" };
  const handlers = createDraftIpcHandlers({
    store,
    context: () => ({ session: live.session, identity: live.identity }),
    accountSession: () => live.session,
    liveAccess: async () => live.acl,
    currentBase: () => live.identity.base,
  });
  const checkpoint = async (value: Uint8Array, draftId: string, generation = 1) => {
    await handlers["desktop:draft-checkpoint"]({ sessionGeneration: SESSION_GENERATION, documentId: DOCUMENT, draftId, generation, dataBase64: encoded(value) });
  };
  const list = () => handlers["desktop:draft-list"]({ sessionGeneration: SESSION_GENERATION, documentId: DOCUMENT });
  const recover = (draftId: string, base = BASE) => handlers["desktop:draft-recover"]({ sessionGeneration: SESSION_GENERATION, documentId: DOCUMENT, draftId, currentBase: base });
  const draftFiles = async () => {
    const namespaces = await fs.readdir(join(root, "drafts"), { withFileTypes: true });
    const files: string[] = [];
    for (const namespace of namespaces) if (namespace.isDirectory()) for (const file of await fs.readdir(join(root, "drafts", namespace.name))) files.push(join(root, "drafts", namespace.name, file));
    return files;
  };
  const keyFiles = async () => {
    const directory = join(keyRoot, "draft-keys", "dev", "uniwork-office-dev");
    return fs.readdir(directory).then((files) => files.map((file) => join(directory, file))).catch(() => []);
  };
  return { root, store, live, handlers, checkpoint, list, recover, draftFiles, keyFiles };
}

it("Q8 logout keeps the ciphertext and its key while every draft command fails closed", async () => {
  const q8 = await harness();
  await q8.checkpoint(bytes(1, 2, 3), "draft-a");
  const [rowFile] = await q8.draftFiles();
  expect(rowFile).toBeDefined();
  expect(await q8.keyFiles()).toHaveLength(1);
  const before = await fs.readFile(rowFile!, "utf8");

  // Logout: no live session and no live account scope remain in main.
  const detached = createDraftIpcHandlers({ store: q8.store, context: () => undefined, accountSession: () => undefined, currentBase: () => BASE });
  await expect(detached["desktop:draft-checkpoint"]({ sessionGeneration: SESSION_GENERATION, documentId: DOCUMENT, draftId: "draft-a", generation: 2, dataBase64: encoded(bytes(9)) })).rejects.toMatchObject({ code: "token_expired" });
  await expect(detached["desktop:draft-list"]({ sessionGeneration: SESSION_GENERATION })).rejects.toMatchObject({ code: "token_expired" });
  await expect(detached["desktop:draft-recover"]({ sessionGeneration: SESSION_GENERATION, documentId: DOCUMENT, draftId: "draft-a", currentBase: BASE })).rejects.toMatchObject({ code: "token_expired" });

  expect(await fs.readFile(rowFile!, "utf8")).toBe(before);
  expect(await q8.keyFiles()).toHaveLength(1);
});

it("Q8 account B sees neither account A payload nor metadata", async () => {
  const q8 = await harness();
  await q8.checkpoint(bytes(1, 2, 3), "draft-a");
  // Account-level offer before a document is open.
  q8.live.session = session("account-b");
  q8.live.identity = identity("account-b");
  await expect(q8.list()).resolves.toEqual({ drafts: [] });
  // Document-bound view of the same document id under account B.
  await expect(q8.recover("draft-a")).resolves.toMatchObject({ status: "missing" });
  // The A row and key are intact and are not readable from B's session.
  expect(await q8.draftFiles()).toHaveLength(1);
  await expect(q8.store.recoverPlaintext({ session: session("account-b"), lookup: { deploymentId: DEPLOYMENT, accountId: "account-b", organizationId: "org-1", workspaceId: WORKSPACE, documentId: DOCUMENT, draftId: "draft-a" }, currentBase: BASE, liveAccess: "edit" })).resolves.toMatchObject({ status: "missing" });
  // A itself can still see exactly its own row, with payload intact.
  q8.live.session = session("account-a");
  q8.live.identity = identity("account-a");
  await expect(q8.list()).resolves.toMatchObject({ drafts: [{ draftId: "draft-a" }] });
  await expect(q8.recover("draft-a")).resolves.toMatchObject({ status: "recovered", dataBase64: encoded(bytes(1, 2, 3)) });
});

it("Q8 login A recovers only with a live session, a live edit ACL and the matching base pair", async () => {
  const q8 = await harness();
  await q8.checkpoint(bytes(4, 5, 6), "draft-a");
  await expect(q8.recover("draft-a")).resolves.toMatchObject({ status: "recovered", metadata: { draftId: "draft-a" }, dataBase64: encoded(bytes(4, 5, 6)) });

  // Live ACL revoked -> blocked, bytes withheld, draft kept.
  q8.live.acl = "none";
  await expect(q8.recover("draft-a")).resolves.toMatchObject({ status: "blocked", reason: "edit_acl_missing" });
  expect(await q8.draftFiles()).toHaveLength(1);
  q8.live.acl = "edit";

  // The live document moved on (new server base) -> explicit conflict, no
  // bytes, draft kept: main compares the draft against the live base, never
  // against a base supplied by the renderer.
  q8.live.identity = identity("account-a", OTHER_BASE);
  await expect(q8.recover("draft-a", BASE)).resolves.toMatchObject({ status: "conflict", currentBase: OTHER_BASE, draftBase: BASE });
  expect(await q8.draftFiles()).toHaveLength(1);
  q8.live.identity = identity("account-a", BASE);

  // A newer session generation is accepted; an older one is stale.
  const newer = createDraftIpcHandlers({ store: q8.store, context: () => ({ session: session("account-a", 3), identity: identity("account-a") }), liveAccess: async () => "edit", currentBase: () => BASE });
  await expect(newer["desktop:draft-recover"]({ sessionGeneration: SESSION_GENERATION, documentId: DOCUMENT, draftId: "draft-a", currentBase: BASE })).resolves.toMatchObject({ status: "recovered" });
  const stale = createDraftIpcHandlers({ store: q8.store, context: () => ({ session: session("account-a", 2), identity: identity("account-a") }), liveAccess: async () => "edit", currentBase: () => BASE });
  await expect(stale["desktop:draft-recover"]({ sessionGeneration: SESSION_GENERATION, documentId: DOCUMENT, draftId: "draft-a", currentBase: BASE })).rejects.toMatchObject({ code: "token_expired" });
});

it("Q8 disk-full, key-lost and corrupt never create an empty replacement draft", async () => {
  const q8 = await harness();
  await q8.checkpoint(bytes(7), "draft-a");
  const [rowFile] = await q8.draftFiles();
  const before = await fs.readFile(rowFile!, "utf8");

  // Disk full: the checkpoint is refused and the confirmed row is untouched.
  q8.store.failNextCheckpoint();
  await expect(q8.checkpoint(bytes(8), "draft-a", 2)).rejects.toMatchObject({ code: "storage_unavailable" });
  expect(await fs.readFile(rowFile!, "utf8")).toBe(before);

  // Key lost: recovery is locked and a new checkpoint cannot mint a key.
  const [keyFile] = await q8.keyFiles();
  await fs.rm(keyFile!);
  await expect(q8.recover("draft-a")).resolves.toMatchObject({ status: "locked", code: "draft_recovery_locked" });
  await expect(q8.checkpoint(bytes(9), "draft-a", 2)).rejects.toMatchObject({ code: "draft_recovery_locked" });
  expect(await fs.readFile(rowFile!, "utf8")).toBe(before);
  expect(await q8.keyFiles()).toHaveLength(0);
});

it("Q8 a corrupt envelope is a typed locked state and is never replaced", async () => {
  const q8 = await harness();
  await q8.checkpoint(bytes(1), "draft-a");
  const [rowFile] = await q8.draftFiles();
  await fs.writeFile(rowFile!, "{ not-json");
  await expect(q8.list()).resolves.toEqual({ drafts: [], locked: true });
  await expect(q8.recover("draft-a")).rejects.toMatchObject({ code: "draft_recovery_locked" });
  await expect(q8.checkpoint(bytes(2), "draft-a", 2)).rejects.toMatchObject({ code: "draft_recovery_locked" });
  expect(await fs.readFile(rowFile!, "utf8")).toBe("{ not-json");
});

it("Q8 a draft id alone cannot consume another document's row, and the account offer can discard without an open document", async () => {
  const q8 = await harness();
  await q8.checkpoint(bytes(1), "draft-a");
  const otherDocument = createDraftIpcHandlers({ store: q8.store, context: () => ({ session: session("account-a"), identity: identity("account-a", BASE, "doc-2") }), currentBase: () => BASE });
  await expect(otherDocument["desktop:draft-discard"]({ sessionGeneration: SESSION_GENERATION, documentId: "doc-2", draftId: "draft-a", generation: 1 })).rejects.toMatchObject({ code: "forbidden" });
  expect(await q8.draftFiles()).toHaveLength(1);
  const accountOffer = createDraftIpcHandlers({ store: q8.store, context: () => undefined, accountSession: () => session("account-a"), currentBase: () => BASE });
  await expect(accountOffer["desktop:draft-discard"]({ sessionGeneration: SESSION_GENERATION, draftId: "draft-a", generation: 1 })).resolves.toEqual({ discarded: true });
  expect(await q8.draftFiles()).toHaveLength(0);
});

it("Q8 a blocked or locked draft has no export, copy or clipboard path", () => {
  const metadata = { draftId: "draft-a", identity: identity("account-a"), generation: 1, checksum: `sha256:${"a".repeat(64)}`, byteLength: 3, updatedAt: 1 };
  for (const result of [{ status: "blocked", metadata, reason: "edit_acl_missing" } as const, { status: "locked", metadata, code: "draft_recovery_locked" } as const]) {
    for (const action of ["export", "copy", "clipboard"] as const) {
      expect(() => assertRecoveryActionAllowed(result, action)).toThrowError("draft operation refused");
    }
  }
  expect(() => assertRecoveryActionAllowed({ status: "missing" }, "export")).not.toThrow();
});
