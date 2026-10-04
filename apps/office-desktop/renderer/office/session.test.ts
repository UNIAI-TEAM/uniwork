import { expect, it, vi } from "vitest";
import { createByteDocumentSession } from "./session";
import { createByteTestEditor } from "../../test/byte-editor";
import { createDesktopPdfSurface } from "./pdf-surface";

const identity = { deploymentId: "lane", accountId: "account", organizationId: "org", workspaceId: "ws", documentId: "doc", generation: 1, baseRevision: "2", baseVersionId: "v2" };
const checksum = "sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
const opened = { format: "docx" as const, dataBase64: "aGVsbG8=", checksum };

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
    if (channel === "desktop:office-open") return Promise.resolve({
      ...opened,
      document: { id: "doc", workspaceId: "ws", title: "Cloud.docx", kind: "file", format: "docx", version: 3, revision: "3", updatedAt: new Date(0).toISOString(), ownerKind: null, canEdit: true, downloadAvailable: true },
      filename: "Cloud.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    if (channel === "desktop:office-save") return new Promise((resolve) => { complete = resolve; });
    throw new Error(`unexpected ${channel}`);
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
  await expect(first).resolves.toMatchObject({ accepted: true, receipt: { revision: "3", versionId: "v3" } });
  expect(session.coordinator.getState().identity).toMatchObject({ baseRevision: "3", baseVersionId: "v3" });
  expect(call).toHaveBeenCalledWith("desktop:office-open", { sessionGeneration: "desktop-dev-session", workspaceId: "ws", documentId: "doc" });
  expect(call.mock.calls.filter(([channel]) => channel === "desktop:office-save")).toHaveLength(1);
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
  return { calls, bridge: { call: async (channel: string, payload: unknown) => { calls.push({ channel, payload }); return handler(channel, payload); } } };
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
  expect(calls.find((call) => call.channel === "desktop:draft-checkpoint")?.payload).toMatchObject({ documentId: identity.documentId, draftId: "doc:v2:2", generation: 4, dataBase64: "aGVsbG8=" });
  expect(calls.find((call) => call.channel === "desktop:draft-list")?.payload).toMatchObject({ documentId: identity.documentId });
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
  await expect(session.recoverDraft(draft)).resolves.toBe("failed");
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

it("reports a locked store as its own recover outcome instead of a generic failure", async () => {
  const refused = bridgeWith(async (channel) => {
    if (channel === "desktop:draft-list") return { drafts: [draft] };
    if (channel === "desktop:draft-recover") return { status: "locked", metadata: draft, code: "draft_recovery_locked" };
    return {};
  });
  await expect(createByteDocumentSession(refused.bridge, identity, opened).recoverDraft(draft)).resolves.toBe("locked");
  const thrown = bridgeWith(async (channel) => {
    if (channel === "desktop:draft-list") return { drafts: [draft] };
    throw Object.assign(new Error("draft operation refused"), { code: "draft_recovery_locked" });
  });
  await expect(createByteDocumentSession(thrown.bridge, identity, opened).recoverDraft(draft)).resolves.toBe("locked");
});

it("recovers the chosen draft into the editor bytes and discards only that row", async () => {
  const { bridge, calls } = bridgeWith(async (channel) => {
    if (channel === "desktop:draft-list") return { drafts: [draft] };
    if (channel === "desktop:draft-recover") return { status: "recovered", metadata: draft, dataBase64: "d29ybGQ=" };
    if (channel === "desktop:draft-discard") return { discarded: true };
    return {};
  });
  const session = await openSession(bridge, identity, opened);
  await expect(session.recoverDraft(draft)).resolves.toBe("recovered");
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
  await expect(restarted.recoverDraft(localRow)).resolves.toBe("recovered");
  expect((await restarted.editor.captureSnapshot()).value).toEqual(Uint8Array.from([119, 111, 114, 108, 100]));

  // A refused checkpoint must not claim that unsaved local work is protected.
  const empty = bridgeWith(async (channel) => (channel === "desktop:draft-list" ? { drafts: [] } : {}));
  const bare = await openSession(empty.bridge, localIdentity, { ...opened, localHandle: handle });
  bare.coordinator.markDirty(1);
  await expect(bare.keepDraft()).resolves.toBe(false);
});

it("FE-R1-03 accepts Keep once the editor-owned local checkpoint seam supplies a durable row", async () => {
  // UNI-835 / G4-06b 526c3f44 owns the edit-to-checkpoint call. This test pins
  // the tab session seam; actual editor creation of that row awaits root merge.
  const handle = `file_${"q".repeat(40)}`;
  const localIdentity = { ...identity, documentId: handle, baseRevision: "10", baseVersionId: checksum };
  const { bridge, calls } = bridgeWith(async (channel) => {
    if (channel === "desktop:draft-checkpoint") return { stored: true, generation: 1 };
    if (channel === "desktop:draft-list") return { drafts: [] };
    return {};
  });
  const session = await openSession(bridge, localIdentity, { ...opened, localHandle: handle });
  session.coordinator.markDirty(1);
  await expect(session.keepDraft()).resolves.toBe(true);
  expect(calls.filter((call) => call.channel === "desktop:draft-checkpoint")).toHaveLength(1);
});

it("forwards the pdf lane edit and snapshot facets through the session facade", async () => {
  const call = vi.fn(async (_channel: string, payload: unknown) => {
    const request = payload as { operation: string };
    if (request.operation === "open") return { ok: true, operation: "open", probe: { pageCount: 3 } };
    return { ok: true, operation: "edit", dataBase64: opened.dataBase64 };
  });
  const session = createByteDocumentSession({ call: call as never }, identity, { ...opened, format: "pdf" }, { createEditor: async (settings) => createDesktopPdfSurface(settings) });
  await session.openEditor();
  expect(session.editor.edit).toBeTypeOf("function");
  expect(session.editor.getPdfSnapshot).toBeTypeOf("function");
  expect(session.editor.subscribeDirty).toBeTypeOf("function");
  expect(session.editor.openOutcome?.()).toMatchObject({ outcome: "opened" });
  expect(session.editor.getPdfSnapshot?.()).toMatchObject({ pageCount: 3, pages: [{ pageNumber: 1 }, { pageNumber: 2 }, { pageNumber: 3 }] });
  await session.editor.edit?.([{ op: "delete_page", target: { page: 1 } }]);
  expect(call.mock.calls.some(([channel, payload]) => channel === "desktop:engine-call" && (payload as { operation: string }).operation === "edit")).toBe(true);
  expect(session.editor.getDirtyGeneration()).toBe(1);
  expect(session.coordinator.getState().dirtyGeneration).toBe(1);
});

it("forwards the pdf renderer and real page sizes so the shared canvas draws pages (U1/U2)", async () => {
  const call = vi.fn(async (_channel: string, payload: unknown) => {
    const request = payload as { operation: string };
    if (request.operation === "open") return { ok: true, operation: "open", probe: { pageCount: 1 }, pageSizes: [{ width: 595.28, height: 841.89 }] };
    return { ok: true, operation: "render", pngBase64: "iVBORw0KGgo=", width: 595, height: 842 };
  });
  const session = createByteDocumentSession({ call: call as never }, identity, { ...opened, format: "pdf" }, { createEditor: async (settings) => createDesktopPdfSurface(settings) });
  await session.openEditor();
  expect(session.editor.renderer).toBeTypeOf("object");
  expect(session.editor.getCanvasPages?.()).toEqual([{ pageNumber: 1, width: 595.28, height: 841.89, rotation: 0, boxes: [] }]);
  const rendered = await session.editor.renderer!.renderPage({ pageNumber: 1, width: 595.28, height: 841.89, scale: 1 });
  expect(rendered.src).toBe("data:image/png;base64,iVBORw0KGgo=");
});
