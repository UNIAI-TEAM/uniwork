import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import { expect, it, vi } from "vitest";
import { createDesktopDraftStore } from "./drafts/store";
import { createFakeDraftKeyStore } from "./drafts/test-fake";
import { createDraftIpcHandlers, createOfficeIpcHandlers } from "./ipc";
import { createOpenedDocuments } from "./opened-documents";
import { createDocumentLeaveEvidence } from "./document-leave";
import { createDesktopHost, WINDOW_WEB_PREFERENCES } from "./index";
import { FileHandleRegistry } from "./files/registry";

const sessionGeneration = "session_1234";
const base = { version: "1", revision: "1" };
async function harness() {
  const parent = resolve("../../.uniwork-dev-run/document-tabs");
  await fs.mkdir(parent, { recursive: true });
  const rootDirectory = await fs.mkdtemp(join(parent, "case-"));
  const store = createDesktopDraftStore({ rootDirectory, keyStore: createFakeDraftKeyStore() });
  let session = { sessionId: sessionGeneration, deploymentId: "dep", accountId: "account-a", generation: 1 };
  const documents = createOpenedDocuments({ sessionFor: () => session });
  for (const documentId of ["a", "b"]) documents.open(documentId, "cloud", { deploymentId: "dep", accountId: "account-a", organizationId: "org", workspaceId: "ws", documentId, base });
  documents.update({ documentIds: ["a", "b"], activeDocumentId: "b" });
  const access = vi.fn(async (_id: string) => "edit" as const);
  const handlers = createDraftIpcHandlers({ store, context: documents.context, accountSession: () => session, liveAccess: access, beginCheckpoint: documents.beginCheckpoint });
  const checkpoint = (documentId: string, dataBase64: string) => handlers["desktop:draft-checkpoint"]({ sessionGeneration, documentId, draftId: `draft-${documentId}`, generation: 1, dataBase64 });
  const recover = (documentId: string) => handlers["desktop:draft-recover"]({ sessionGeneration, documentId, draftId: `draft-${documentId}`, currentBase: base });
  return { store, documents, handlers, checkpoint, recover, access, changeAccount: () => { session = { ...session, accountId: "account-b", generation: 2 }; } };
}

it("checkpoints and recovers A independently while B is selected, with document-specific live ACL", async () => {
  const h = await harness();
  await h.checkpoint("a", "YQ==");
  await h.checkpoint("b", "Yg==");
  expect(h.documents.activeDocumentId()).toBe("b");
  await expect(h.recover("a")).resolves.toMatchObject({ status: "recovered", dataBase64: "YQ==" });
  await expect(h.recover("b")).resolves.toMatchObject({ status: "recovered", dataBase64: "Yg==" });
  expect(h.access.mock.calls.map(([id]) => id)).toEqual(["a", "b"]);
  await expect(h.handlers["desktop:draft-list"]({ sessionGeneration, documentId: "a" })).resolves.toMatchObject({ drafts: [{ draftId: "draft-a" }] });
  await expect(h.handlers["desktop:draft-list"]({ sessionGeneration })).resolves.toMatchObject({ drafts: expect.any(Array) });
  const all = await h.handlers["desktop:draft-list"]({ sessionGeneration });
  expect(all?.drafts).toHaveLength(2);
  await expect(h.handlers["desktop:draft-discard"]({ sessionGeneration, documentId: "b", draftId: "draft-a", generation: 1 })).rejects.toMatchObject({ code: "forbidden" });
});

it("rejects unknown, closed and stale-account document operations instead of using the active tab", async () => {
  const h = await harness();
  await h.checkpoint("a", "YQ==");
  await expect(h.checkpoint("unknown", "YQ==")).rejects.toMatchObject({ code: "token_expired" });
  h.documents.update({ documentIds: ["b"], activeDocumentId: "b" });
  await expect(h.checkpoint("a", "YQ==")).rejects.toMatchObject({ code: "token_expired" });
  await expect(h.recover("a")).rejects.toMatchObject({ code: "token_expired" });
  await expect(h.handlers["desktop:draft-list"]({ sessionGeneration, documentId: "a" })).rejects.toMatchObject({ code: "token_expired" });
  await expect(h.handlers["desktop:draft-discard"]({ sessionGeneration, documentId: "a", draftId: "draft-a", generation: 1 })).rejects.toMatchObject({ code: "token_expired" });
  // Omitting documentId explicitly selects the account-level offer.
  await expect(h.handlers["desktop:draft-discard"]({ sessionGeneration, draftId: "draft-a", generation: 1 })).resolves.toEqual({ discarded: true });
  h.changeAccount();
  await expect(h.checkpoint("b", "Yg==")).rejects.toMatchObject({ code: "token_expired" });
  await expect(h.recover("b")).rejects.toMatchObject({ code: "token_expired" });
});

it("withholds recovery bytes if account changes during the live ACL lookup", async () => {
  const h = await harness();
  await h.checkpoint("a", "YQ==");
  h.access.mockImplementation(async () => { h.changeAccount(); return "edit"; });
  await expect(h.recover("a")).rejects.toMatchObject({ code: "token_expired" });
});

it("global leave checks inactive A even after active B has saved or discarded", async () => {
  const h = await harness();
  await h.checkpoint("a", "YQ==");
  await h.checkpoint("b", "Yg==");
  const evidence = createDocumentLeaveEvidence({ documents: h.documents, store: h.store, saveBusy: () => false });
  const issuedAt = Date.now();
  h.documents.noteConfirmedSave("b");
  await expect(evidence.confirmSave(issuedAt)).resolves.toBe(false);
  h.documents.noteConfirmedSave("a");
  await expect(evidence.confirmSave(issuedAt)).resolves.toBe(true);
  await expect(evidence.confirmKeep()).resolves.toBe(true);
  await h.handlers["desktop:draft-discard"]({ sessionGeneration, documentId: "b", draftId: "draft-b", generation: 1 });
  await expect(evidence.confirmDiscard()).resolves.toBe(false);
  await h.handlers["desktop:draft-discard"]({ sessionGeneration, documentId: "a", draftId: "draft-a", generation: 1 });
  await expect(evidence.confirmDiscard()).resolves.toBe(true);
  await expect(evidence.confirmKeep()).resolves.toBe(true);
  const busy = createDocumentLeaveEvidence({ documents: h.documents, store: h.store, saveBusy: () => true });
  await expect(busy.confirmSave(issuedAt)).resolves.toBe(false);
  vi.spyOn(h.store, "list").mockRejectedValue(new Error("read failed"));
  await expect(evidence.confirmKeep()).resolves.toBe(false);
  await expect(evidence.confirmDiscard()).resolves.toBe(false);
  await expect(evidence.confirmSave(issuedAt)).resolves.toBe(false);
});

it("native Save emits only the tab selected through validated IPC, and Library emits nothing", async () => {
  const h = await harness();
  const send = vi.fn();
  let nativeSave: (() => void) | undefined;
  const host = createDesktopHost({
    sender: { senderId: 1, expectedSenderId: 1, frameId: 0, expectedFrameId: 0, origin: "uniwork-office-app://app", expectedOrigin: "uniwork-office-app://app", sessionGeneration },
    window: { webPreferences: WINDOW_WEB_PREFERENCES, webContents: { on: vi.fn(), setWindowOpenHandler: vi.fn(), send }, loadURL: vi.fn(), setUserDataDirectory: vi.fn(), onNativeSave: (listener) => { nativeSave = listener; } },
    handlers: { "desktop:tabs-update": (request) => ({ updated: h.documents.update(request) }) },
    activeDocumentId: h.documents.activeDocumentId,
  });
  nativeSave?.();
  expect(send).toHaveBeenLastCalledWith("desktop:office-save-requested", { documentId: "b" });
  await expect(host.dispatch("desktop:tabs-update", { sessionGeneration, documentIds: ["a", "b"], activeDocumentId: "a" })).resolves.toEqual({ updated: true });
  nativeSave?.();
  expect(send).toHaveBeenLastCalledWith("desktop:office-save-requested", { documentId: "a" });
  await host.dispatch("desktop:tabs-update", { sessionGeneration, documentIds: ["a", "b"], activeDocumentId: null });
  send.mockClear();
  nativeSave?.();
  expect(send).not.toHaveBeenCalled();
});

it("keeps all leave choices blocked during an inactive checkpoint, and keep blocked after failure", async () => {
  const h = await harness();
  let reject!: (reason: Error) => void;
  vi.spyOn(h.store, "checkpointPlaintext").mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
  const checkpoint = h.checkpoint("a", "YQ==");
  const refused = expect(checkpoint).rejects.toMatchObject({ code: "storage_unavailable" });
  const evidence = createDocumentLeaveEvidence({ documents: h.documents, store: h.store, saveBusy: () => false });
  await expect(evidence.confirmKeep()).resolves.toBe(false);
  await expect(evidence.confirmSave(Date.now())).resolves.toBe(false);
  await expect(evidence.confirmDiscard()).resolves.toBe(false);
  reject(new Error("disk full"));
  await refused;
  await expect(evidence.confirmKeep()).resolves.toBe(false);
  await expect(evidence.confirmSave(Date.now())).resolves.toBe(false);
  await expect(evidence.confirmDiscard()).resolves.toBe(true);
});

it("does not use a Save N receipt to confirm a newer checkpoint N+1", async () => {
  const h = await harness();
  await h.checkpoint("a", "YQ==");
  const issuedAt = Date.now();
  const confirmSaveN = h.documents.beginSave("a");
  await h.handlers["desktop:draft-checkpoint"]({ sessionGeneration, documentId: "a", draftId: "draft-a", generation: 2, dataBase64: "Yg==" });
  confirmSaveN();
  const evidence = createDocumentLeaveEvidence({ documents: h.documents, store: h.store, saveBusy: () => false });
  await expect(evidence.confirmSave(issuedAt)).resolves.toBe(false);
  h.documents.beginSave("a")();
  await expect(evidence.confirmSave(issuedAt)).resolves.toBe(true);
});

it("registers created DOCX documents and rejects late cloud opens from the previous account", async () => {
  const response = { document: { id: "a", workspaceId: "ws", title: "A.docx", kind: "file", format: "docx", version: 1, revision: "1", updatedAt: "2026-10-02T00:00:00Z", ownerKind: null, canEdit: true, downloadAvailable: true }, filename: "A.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", dataBase64: "YQ==", checksum: `sha256:${"a".repeat(64)}` };
  let session = { sessionId: sessionGeneration, deploymentId: "dep", accountId: "account-a", generation: 1 };
  const onDocumentOpened = vi.fn();
  const handlers = createOfficeIpcHandlers({ session: () => session, onDocumentOpened, transport: { create: async () => response, open: async () => { session = { ...session, accountId: "account-b" }; return response; } } as never });
  await handlers["desktop:library-create"]({ sessionGeneration, workspaceId: "ws", title: "A.docx", format: "docx" });
  expect(onDocumentOpened).toHaveBeenCalledWith(response.document);
  onDocumentOpened.mockClear();
  await expect(handlers["desktop:office-open"]({ sessionGeneration, workspaceId: "ws", documentId: "a" })).rejects.toMatchObject({ code: "login_required" });
  expect(onDocumentOpened).not.toHaveBeenCalled();
});

it("reopening one local path reuses its opaque handle until the tab closes", async () => {
  const parent = resolve("../../.uniwork-dev-run/document-tabs");
  await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(join(parent, "local-"));
  const path = join(root, "A.docx");
  await fs.writeFile(path, "document");
  const registry = new FileHandleRegistry({ sessionId: sessionGeneration });
  const first = await registry.openPath(path);
  expect((await registry.openEvent(path)).handle).toBe(first.handle);
  expect(registry.size).toBe(1);
  registry.revoke(first.handle);
  expect((await registry.openPath(path)).handle).not.toBe(first.handle);
});

it("a global leave snapshot cannot omit a tab removed while the dialog was open", async () => {
  const h = await harness();
  await h.checkpoint("a", "YQ==");
  const evidence = createDocumentLeaveEvidence({ documents: h.documents, store: h.store, saveBusy: () => false });
  evidence.capture("close");
  h.documents.update({ documentIds: ["b"], activeDocumentId: "b" });
  await expect(evidence.confirmKeep()).resolves.toBe(false);
  await expect(evidence.confirmDiscard()).resolves.toBe(false);
  await expect(evidence.confirmSave(Date.now())).resolves.toBe(false);
});

it("requires an unsaved checkpoint row for Keep while allowing a clean or confirmed-saved document", async () => {
  const h = await harness();
  const evidence = createDocumentLeaveEvidence({ documents: h.documents, store: h.store, saveBusy: () => false });
  await expect(evidence.confirmKeep()).resolves.toBe(true);
  await h.checkpoint("a", "YQ==");
  vi.spyOn(h.store, "list").mockResolvedValue([]);
  await expect(evidence.confirmKeep()).resolves.toBe(false);
  h.documents.beginSave("a")();
  await expect(evidence.confirmKeep()).resolves.toBe(true);
});
