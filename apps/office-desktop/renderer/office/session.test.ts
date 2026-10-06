import { expect, it, vi } from "vitest";
import { createByteDocumentSession } from "./session";
import { createByteTestEditor } from "../../test/byte-editor";
import { createDesktopPdfSurface } from "./pdf-surface";

const identity = { deploymentId: "lane", accountId: "account", organizationId: "org", workspaceId: "ws", documentId: "doc", generation: 1, baseRevision: "2", baseVersionId: "v2" };
const checksum = "sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
const opened = { format: "docx" as const, data: Uint8Array.from(Buffer.from("aGVsbG8=", "base64")), checksum };

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
  const request = call.mock.calls[0] as unknown as [string, { intentId: string; idempotencyKey: string; data: Uint8Array }];
  expect(request[0]).toBe("desktop:office-save");
  expect(request[1].data).toEqual(opened.data);
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
  expect(call).toHaveBeenCalledWith("desktop:file-save", expect.objectContaining({ handle, data: Uint8Array.from(Buffer.from("aGVsbG8=", "base64")) }));
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

it("carries a refused local Save's code to the save error instead of office_unknown_error", async () => {
  const handle = `file_${"z".repeat(40)}`;
  const call = vi.fn(async () => ({ opened: false, code: "file_locked" }));
  const session = await openSession({ call: call as never }, { ...identity, documentId: handle, baseRevision: "0" }, { ...opened, localHandle: handle });
  session.coordinator.markDirty(1);
  await expect(session.coordinator.save("menu")).resolves.toMatchObject({ accepted: false });
  expect(session.coordinator.getState().error).toMatchObject({ code: "file_locked" });
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
  expect(calls.find((call) => call.channel === "desktop:draft-checkpoint")?.payload).toMatchObject({ documentId: identity.documentId, draftId: "doc:v2:2", generation: 4, data: Uint8Array.from(Buffer.from("aGVsbG8=", "base64")) });
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
    if (channel === "desktop:draft-recover") return { status: "recovered", metadata: draft, data: Uint8Array.from(Buffer.from("d29ybGQ=", "base64")) };
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
    if (channel === "desktop:draft-recover") return { status: "recovered", metadata: localRow, data: Uint8Array.from(Buffer.from("d29ybGQ=", "base64")) };
    return {};
  });
  const session = await openSession(bridge, localIdentity, { ...opened, localHandle: handle });
  expect(session.localHandle).toBe(handle);
  expect(session.canSave).toBe(true);
  session.coordinator.markDirty(1);
  await expect(session.keepDraft()).resolves.toBe(true);
  expect(calls.find((call) => call.channel === "desktop:draft-checkpoint")?.payload).toMatchObject({ data: opened.data });
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
    return { ok: true, operation: "edit", data: opened.data };
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

it("forwards the pdf engine-operation facet so the note panel gets a provider (F-14)", async () => {
  const call = vi.fn(async (_channel: string, payload: unknown) => {
    const request = payload as { operation: string };
    if (request.operation === "open") return { ok: true, operation: "open", probe: { pageCount: 1 }, pageSizes: [{ width: 595.28, height: 841.89 }] };
    return { ok: true, operation: "edit", data: opened.data, warnings: [] };
  });
  const session = createByteDocumentSession({ call: call as never }, identity, { ...opened, format: "pdf" }, { createEditor: async (settings) => createDesktopPdfSurface(settings) });
  await session.openEditor();
  expect(session.editor.submitEngineOperations).toBeTypeOf("function");
  const result = await session.editor.submitEngineOperations?.([{ op: "addNote", attributes: { note: { pageIndex: 0, rect: [10, 20, 34, 44], contents: "Ghi chu" } } }]);
  expect(result).toEqual({ skipped: [] });
  const edit = call.mock.calls.find(([channel, payload]) => channel === "desktop:engine-call" && (payload as { operation: string }).operation === "edit");
  expect(edit?.[1]).toMatchObject({ operation: "edit", args: { edits: [{ op: "addNote", attributes: { note: { pageIndex: 0, contents: "Ghi chu" } } }] } });
  expect(session.coordinator.getState().dirtyGeneration).toBe(1);
});
it("forwards the pdf find facet so desktop search reaches the engine text layer (F-13)", async () => {
  const call = vi.fn(async (_channel: string, payload: unknown) => {
    const request = payload as { operation: string; args: { geometry?: boolean } };
    if (request.operation === "open") return { ok: true, operation: "open", probe: { pageCount: 1 }, pageSizes: [{ width: 100, height: 100 }] };
    const charBoxes = request.args.geometry ? [{ x: 0, y: 10, width: 8, height: 8 }, { x: 8, y: 10, width: 8, height: 8 }] : [];
    return { ok: true, operation: "text", pageCount: 1, pages: [{ page: 1, width: 100, height: 100, text: "Bao cao", charBoxes }] };
  });
  const session = createByteDocumentSession({ call: call as never }, identity, { ...opened, format: "pdf" }, { createEditor: async (settings) => createDesktopPdfSurface(settings) });
  await session.openEditor();
  expect(session.editor.searchText).toBeTypeOf("function");
  const hits = await session.editor.searchText!("bao");
  expect(hits).toHaveLength(1);
  expect(hits[0]).toMatchObject({ page: 1, start: 0, end: 3, text: "Bao" });
  expect(hits[0]!.quads).toEqual([[0, 82, 16, 90]]);
  expect(call.mock.calls.some(([channel, payload]) => channel === "desktop:engine-call" && (payload as { operation: string }).operation === "text")).toBe(true);
});
it("forwards the pdf form and saved-note readers so the panels leave their loading state (R18-2)", async () => {
  const call = vi.fn(async () => ({ ok: true, operation: "open", probe: { pageCount: 1 }, pageSizes: [{ width: 100, height: 100 }] }));
  const session = createByteDocumentSession({ call: call as never }, identity, { ...opened, format: "pdf" }, { createEditor: async (settings) => createDesktopPdfSurface(settings) });
  expect(session.editor.readFormFields).toBeUndefined();
  await session.openEditor();
  expect(session.editor.readFormFields).toBeTypeOf("function");
  expect(session.editor.readSavedNotes).toBeTypeOf("function");
  // The fixture bytes are not a parseable PDF: the readers reject, as on web, so the panels show their error (R-3).
  await expect(session.editor.readFormFields!()).rejects.toThrow();
  await expect(session.editor.readSavedNotes!()).rejects.toThrow();
});

it("forwards the pdf byte-change notify so undo/redo refresh the shared editor (G-1)", async () => {
  let edited = false;
  const call = vi.fn(async (_channel: string, payload: unknown) => {
    const request = payload as { operation: string };
    if (request.operation === "edit") { edited = true; return { ok: true, operation: "edit", data: Uint8Array.from(Buffer.from("JVBERi0y", "base64")) }; }
    return { ok: true, operation: "open", probe: { pageCount: edited ? 2 : 1 }, pageSizes: [] };
  });
  const session = createByteDocumentSession({ call: call as never }, identity, { ...opened, format: "pdf" }, { createEditor: async (settings) => createDesktopPdfSurface(settings) });
  expect(session.editor.subscribe).toBeUndefined();
  await session.openEditor();
  const changes = vi.fn();
  const unsubscribe = session.editor.subscribe!(changes);
  await session.editor.submitEngineOperations!([{ op: "a" }]);
  const afterEdit = session.editor.getDirtyGeneration();
  session.editor.undo!();
  await vi.waitFor(() => expect(changes).toHaveBeenCalledTimes(2));
  expect(session.editor.getDirtyGeneration()).toBe(afterEdit + 1);
  expect(session.editor.getPdfSnapshot!()?.pageCount).toBe(2);
  // The history depth reaches the shared editor through the session (UNI-954).
  expect(session.editor.canUndo!()).toBe(false);
  expect(session.editor.canRedo!()).toBe(true);
  unsubscribe();
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

it("re-captures a checkpoint whose capture resolved after the Save, so the row under the new base is post-save (T09 settle gate)", async () => {
  const text = (value: string) => new TextEncoder().encode(value);
  const live = { bytes: text("A") };
  let holdNext: Promise<void> | null = null;
  let held = false;
  let releaseSave!: () => void;
  let saveEntered = false;
  let savedChecksum = opened.checksum;
  const rows = new Map<string, string>();
  const call = vi.fn(async (channel: string, payload: Record<string, unknown>) => {
    if (channel === "desktop:draft-list") return { drafts: [] };
    if (channel === "desktop:draft-checkpoint") { rows.set(payload.draftId as string, payload.data as string); return { stored: true, generation: payload.generation }; }
    if (channel === "desktop:office-open") return { data: opened.data, checksum: savedChecksum, document: { id: "doc", workspaceId: "ws", title: "Cloud.docx", kind: "file", format: "docx", version: 3, revision: "3", updatedAt: new Date(0).toISOString(), ownerKind: null, canEdit: true, downloadAvailable: true }, filename: "Cloud.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
    if (channel === "desktop:office-save") {
      saveEntered = true;
      savedChecksum = payload.checksum as string;
      await new Promise<void>((resolve) => { releaseSave = resolve; });
      return { documentId: "doc", intentId: payload.intentId, idempotencyKey: payload.idempotencyKey, revision: "3", versionId: "v3", checksum: payload.checksum };
    }
    throw new Error(`unexpected ${channel}`);
  });
  const session = createByteDocumentSession({ call: call as never }, identity, opened, {
    createEditor: async () => ({
      ...(await createByteTestEditor({ documentId: "doc", readBytes: async () => text("A"), generation: 0 })),
      // Reads the live bytes now; the one-shot hold resolves them later.
      captureSnapshot: async () => {
        const value = live.bytes.slice();
        const hold = holdNext;
        if (hold) { holdNext = null; held = true; await hold; }
        return { value, generation: 0, fingerprint: "f", checksumSha256: "sha256:f", sizeBytes: value.length };
      },
    }),
  });
  await session.openEditor();
  session.coordinator.markDirty(1);
  const saving = session.coordinator.save("button");
  await vi.waitFor(() => expect(saveEntered).toBe(true));
  live.bytes = text("B");
  session.coordinator.markDirty(2);
  let releaseCapture!: () => void;
  holdNext = new Promise<void>((resolve) => { releaseCapture = resolve; });
  const checkpointing = session.coordinator.checkpoint();
  await vi.waitFor(() => expect(held).toBe(true));
  releaseSave();
  await expect(saving).resolves.toMatchObject({ accepted: true });
  // Typing continues after the held read: only a re-capture can see it.
  live.bytes = text("C");
  releaseCapture();
  await checkpointing;
  expect(rows.get("doc:3:3")).toEqual(new TextEncoder().encode("C"));
});

it("releases a blocked Save at once and retries it as a fresh intent (T09)", async () => {
  let refuse = true;
  const call = vi.fn(async (channel: string, payload: { intentId?: string; idempotencyKey?: string }) => {
    if (channel === "desktop:draft-list") return { drafts: [] };
    if (channel === "desktop:draft-discard") return { discarded: true };
    if (channel === "desktop:office-open") return {
      ...opened,
      document: { id: "doc", workspaceId: "ws", title: "Cloud.docx", kind: "file", format: "docx", version: 3, revision: "3", updatedAt: new Date(0).toISOString(), ownerKind: null, canEdit: true, downloadAvailable: true },
      filename: "Cloud.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };
    if (channel === "desktop:office-save") {
      if (refuse) { refuse = false; throw Object.assign(new Error("quota_exceeded"), { code: "quota_exceeded" }); }
      return { documentId: "doc", intentId: payload.intentId, idempotencyKey: payload.idempotencyKey, revision: "3", versionId: "v3", checksum };
    }
    throw new Error(`unexpected ${channel}`);
  });
  const session = await openSession({ call: call as never }, identity, opened);
  session.coordinator.markDirty(1);
  await expect(session.coordinator.save("button")).resolves.toEqual({ accepted: false, reason: "blocked" });
  await expect(session.coordinator.save("retry")).resolves.toMatchObject({ accepted: true });
  const saves = call.mock.calls.filter(([channel]) => channel === "desktop:office-save").map(([, payload]) => payload);
  expect(saves).toHaveLength(2);
  expect(saves[1]?.idempotencyKey).not.toBe(saves[0]?.idempotencyKey);
});

it("writes a checkpoint under the saved base once the bound runs out while the post-Save context refresh never answers (N2)", async () => {
  const text = (value: string) => new TextEncoder().encode(value);
  const live = { bytes: text("A") };
  let openAsked = false;
  const rows = new Map<string, string>();
  const call = vi.fn(async (channel: string, payload: Record<string, unknown>) => {
    if (channel === "desktop:draft-list") return { drafts: [] };
    if (channel === "desktop:draft-discard") return { discarded: true };
    if (channel === "desktop:draft-checkpoint") { rows.set(payload.draftId as string, payload.data as string); return { stored: true, generation: payload.generation }; }
    // main's read-only context refresh never answers.
    if (channel === "desktop:office-open") { openAsked = true; return new Promise(() => undefined); }
    if (channel === "desktop:office-save") return { documentId: "doc", intentId: payload.intentId, idempotencyKey: payload.idempotencyKey, revision: "3", versionId: "v3", checksum: payload.checksum };
    throw new Error(`unexpected ${channel}`);
  });
  const session = createByteDocumentSession({ call: call as never }, identity, opened, {
    saveSettleMaxWaitMs: 20,
    createEditor: async () => ({
      ...(await createByteTestEditor({ documentId: "doc", readBytes: async () => text("A"), generation: 0 })),
      captureSnapshot: async () => {
        const value = live.bytes.slice();
        return { value, generation: 0, fingerprint: "f", checksumSha256: "sha256:f", sizeBytes: value.length };
      },
    }),
  });
  await session.openEditor();
  session.coordinator.markDirty(1);
  void session.coordinator.save("button");
  await vi.waitFor(() => expect(openAsked).toBe(true));
  live.bytes = text("B");
  session.coordinator.markDirty(2);
  await session.coordinator.checkpoint();
  expect(rows.get("doc:v3:3")).toEqual(new TextEncoder().encode("B"));
});
