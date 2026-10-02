import { expect, it, vi } from "vitest";
import { createByteDocumentSession } from "./session";
import { createByteTestEditor } from "../../test/byte-editor";

const identity = { deploymentId: "lane", accountId: "account", organizationId: "org", workspaceId: "ws", documentId: "doc", generation: 1, baseRevision: "2", baseVersionId: "v2" };
const checksum = "sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
const opened = { dataBase64: "aGVsbG8=", checksum };

async function openSession(...args: Parameters<typeof createByteDocumentSession>) {
  const session = createByteDocumentSession(args[0], args[1], args[2], { createEditor: createByteTestEditor });
  await session.openEditor();
  return session;
}

it("sends the opened snapshot once through coordinator save and blocks a concurrent menu save", async () => {
  let complete!: (value: unknown) => void;
  const call = vi.fn((channel: string) => {
    if (channel === "desktop:draft-list") return Promise.resolve({ drafts: [] });
    if (channel === "desktop:draft-discard") return Promise.resolve({ discarded: true });
    return new Promise((resolve) => { complete = resolve; });
  });
  const session = await openSession({ call: call as never }, identity, opened);
  session.coordinator.markDirty(1);
  const first = session.coordinator.save("button");
  await vi.waitFor(() => expect(call).toHaveBeenCalledOnce());
  await expect(session.coordinator.save("menu")).resolves.toMatchObject({ accepted: false, reason: "saving" });
  const request = call.mock.calls[0] as unknown as [string, { intentId: string; idempotencyKey: string; dataBase64: string }];
  expect(request[0]).toBe("desktop:office-save");
  expect(request[1].dataBase64).toBe(opened.dataBase64);
  complete({ documentId: "doc", intentId: request[1].intentId, idempotencyKey: request[1].idempotencyKey, revision: "3", versionId: "v3", checksum });
  await expect(first).resolves.toMatchObject({ accepted: true });
  expect(session.coordinator.getState().identity.baseVersionId).toBe("v3");
});

it("routes local Save to the original opaque handle and records a confirmed save", async () => {
  const handle = `file_${"x".repeat(40)}`;
  const call = vi.fn(async () => ({ opened: true, metadata: { handle, name: "Local.docx", byteLength: 5, modifiedAtMs: 10, checksum } }));
  const session = await openSession({ call: call as never }, { ...identity, documentId: handle, baseRevision: "0" }, { ...opened, localHandle: handle });
  session.coordinator.markDirty(1);
  await expect(session.coordinator.save("menu")).resolves.toMatchObject({ accepted: true });
  expect(call).toHaveBeenCalledWith("desktop:file-save", expect.objectContaining({ handle, dataBase64: "aGVsbG8=" }));
  expect(session.coordinator.getState().lastSavedGeneration).toBe(session.coordinator.getState().dirtyGeneration);
});

it("saves a local file even when the captured revision is not an integer", async () => {
  const handle = `file_${"y".repeat(40)}`;
  const call = vi.fn(async () => ({ opened: true, metadata: { handle, name: "Local.docx", byteLength: 5, modifiedAtMs: 1759322123456.789, checksum } }));
  const session = await openSession({ call: call as never }, { ...identity, documentId: handle, baseRevision: "1759322123455" }, { ...opened, localHandle: handle });
  session.coordinator.markDirty(1);
  await expect(session.coordinator.save("button")).resolves.toMatchObject({ accepted: true });
  expect(call).toHaveBeenCalledWith("desktop:file-save", expect.objectContaining({ handle }));
  expect(session.coordinator.getState().identity.baseRevision).toBe("1759322123456");
});

const draft = { draftId: "doc:v2:2", identity: { deploymentId: "lane", accountId: "account", organizationId: "org", workspaceId: "ws", documentId: "doc", base: { revision: "2", version: "v2" } }, generation: 3, checksum: `sha256:${"c".repeat(64)}`, byteLength: 5, updatedAt: 7 };

function bridgeWith(handler: (channel: string, payload: unknown) => Promise<unknown>) {
  const calls: Array<{ channel: string; payload: unknown }> = [];
  return { calls, bridge: { call: (async (channel: string, payload: unknown) => { calls.push({ channel, payload }); return handler(channel, payload); }) as never } };
}

it("keeps a draft through the typed checkpoint and raises the generation floor", async () => {
  const { bridge, calls } = bridgeWith(async (channel) => {
    if (channel === "desktop:draft-list") return { drafts: [draft] };
    if (channel === "desktop:draft-checkpoint") return { stored: true, generation: 4 };
    throw new Error(`unexpected ${channel}`);
  });
  const session = await openSession(bridge, identity, opened);
  session.coordinator.markDirty(2);
  await expect(session.keepDraft()).resolves.toBe(true);
  expect(calls.find((call) => call.channel === "desktop:draft-checkpoint")?.payload).toMatchObject({ draftId: "doc:v2:2", generation: 4, dataBase64: "aGVsbG8=" });
});

it("reports a failed keep and refuses recovery when the store refuses", async () => {
  const failing = bridgeWith(async (channel) => {
    if (channel === "desktop:draft-list") return { drafts: [] };
    throw Object.assign(new Error("draft operation refused"), { code: "storage_unavailable" });
  });
  const session = await openSession(failing.bridge, identity, opened);
  // A clean document has nothing to keep; only unsaved work asks for a write.
  await expect(session.keepDraft()).resolves.toBe(true);
  session.coordinator.markDirty(1);
  await expect(session.keepDraft()).resolves.toBe(false);
  await expect(session.recoverDraft(draft)).resolves.toBe(false);
  await expect(session.discardDraft()).resolves.toBe(true);
});

it("lists drafts and distinguishes conflict, locked, blocked and unavailable stores", async () => {
  const conflicting = bridgeWith(async (channel) => (channel === "desktop:draft-list" ? { drafts: [{ ...draft, identity: { ...draft.identity, base: { revision: "9", version: "v9" } } }] } : {}));
  await expect(createByteDocumentSession(conflicting.bridge, identity, opened).listDrafts()).resolves.toMatchObject({ status: "found", conflict: true });
  const matching = bridgeWith(async (channel) => (channel === "desktop:draft-list" ? { drafts: [draft] } : {}));
  await expect(createByteDocumentSession(matching.bridge, identity, opened).listDrafts()).resolves.toMatchObject({ status: "found", conflict: false });
  const empty = bridgeWith(async (channel) => (channel === "desktop:draft-list" ? { drafts: [] } : {}));
  await expect(createByteDocumentSession(empty.bridge, identity, opened).listDrafts()).resolves.toEqual({ status: "none" });
  const locked = bridgeWith(async () => { throw Object.assign(new Error("draft operation refused"), { code: "draft_recovery_locked" }); });
  await expect(createByteDocumentSession(locked.bridge, identity, opened).listDrafts()).resolves.toEqual({ status: "locked" });
  const blocked = bridgeWith(async () => { throw Object.assign(new Error("draft operation refused"), { code: "token_expired" }); });
  await expect(createByteDocumentSession(blocked.bridge, identity, opened).listDrafts()).resolves.toEqual({ status: "blocked" });
  const unavailable = bridgeWith(async () => { throw new Error("boom"); });
  await expect(createByteDocumentSession(unavailable.bridge, identity, opened).listDrafts()).resolves.toEqual({ status: "unavailable" });
});

it("recovers the chosen draft into the editor bytes and discards only that row", async () => {
  const { bridge, calls } = bridgeWith(async (channel) => {
    if (channel === "desktop:draft-list") return { drafts: [draft] };
    if (channel === "desktop:draft-recover") return { status: "recovered", metadata: draft, dataBase64: "d29ybGQ=" };
    if (channel === "desktop:draft-discard") return { discarded: true };
    return {};
  });
  const session = await openSession(bridge, identity, opened);
  await expect(session.recoverDraft(draft)).resolves.toBe(true);
  expect((await session.editor.captureSnapshot()).value).toEqual(Uint8Array.from([119, 111, 114, 108, 100]));
  expect(session.coordinator.getState().state).toBe("dirty");
  await expect(session.discardDraft()).resolves.toBe(true);
  expect(calls.find((call) => call.channel === "desktop:draft-discard")?.payload).toMatchObject({ draftId: "doc:v2:2", generation: 3 });
});

it("checkpoints unsaved local work before Save and recovers it in a new session", async () => {
  const handle = `file_${"x".repeat(40)}`;
  const localIdentity = { ...identity, documentId: handle, baseRevision: "10", baseVersionId: checksum };
  const localRow = { draftId: `${handle}:10`, identity: { deploymentId: "lane", accountId: "account", organizationId: "local", workspaceId: "local", documentId: handle, base: { revision: "10", version: checksum } }, generation: 1, checksum: `sha256:${"d".repeat(64)}`, byteLength: 5, updatedAt: 3 };
  const { bridge, calls } = bridgeWith(async (channel) => {
    if (channel === "desktop:draft-list") return { drafts: [localRow] };
    if (channel === "desktop:draft-checkpoint") return { stored: true, generation: 2 };
    if (channel === "desktop:draft-recover") return { status: "recovered", metadata: localRow, dataBase64: "d29ybGQ=" };
    return {};
  });
  const session = await openSession(bridge, localIdentity, { ...opened, localHandle: handle });
  expect(session.localHandle).toBe(handle);
  expect(session.canSave).toBe(true);
  session.coordinator.markDirty(1);
  await expect(session.keepDraft()).resolves.toBe(true);
  expect(calls.find((call) => call.channel === "desktop:draft-checkpoint")?.payload).toMatchObject({ dataBase64: opened.dataBase64 });
  expect(calls.some((call) => /file-save|office-save/.test(call.channel))).toBe(false);
  const restarted = await openSession(bridge, localIdentity, { ...opened, localHandle: handle });
  await expect(restarted.recoverDraft(localRow)).resolves.toBe(true);
  expect((await restarted.editor.captureSnapshot()).value).toEqual(Uint8Array.from([119, 111, 114, 108, 100]));

  // A refused checkpoint must not claim that unsaved local work is protected.
  const empty = bridgeWith(async (channel) => (channel === "desktop:draft-list" ? { drafts: [] } : {}));
  const bare = await openSession(empty.bridge, localIdentity, { ...opened, localHandle: handle });
  bare.coordinator.markDirty(1);
  await expect(bare.keepDraft()).resolves.toBe(false);
});
