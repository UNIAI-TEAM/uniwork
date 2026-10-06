/** @vitest-environment node */
// UNI-927 X2 (R2-4): a LOCAL .pptx draft must be offered again after a kill +
// relaunch. Everything but the generated pptx artifact is real: the pptx session,
// the main-process file registry, opened-document contexts, the draft IPC
// handlers and the encrypted draft store. A relaunch is a NEW registry (new file
// handle for the same path), a new opened-documents map and a new store over the
// same draft directory and key store.
import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OfficeIdentity } from "@uniwork/core/office";
import type { OpenedPptxLike, PptxEdit, PptxTxnRequest } from "@uniwork/office-engine/pptx";
import { makeFakePptxBytes } from "../../../../packages/office-engine/test/fake-pptx-fixtures";
import { createFileIpcHandlers, createDraftIpcHandlers } from "../../main/ipc";
import { FileHandleRegistry, type OpenFileMetadata } from "../../main/files/registry";
import { createProtectedFileCheckpoints, discardProtectedCheckpoint, localDraftBase, localDraftIdentity, type ProtectedCheckpointRef } from "../../main/files/protected-files";
import { createOpenedDocuments } from "../../main/opened-documents";
import { createDesktopDraftStore } from "../../main/drafts/store";
import { createFakeDraftKeyStore } from "../../main/drafts/test-fake";
import { createDesktopPptxAdapter } from "./pptx-adapter";
import { createWebPptxSessionRuntime } from "./pptx-runtime";
import { createPptxDocumentSession } from "./pptx-session";
import type { LibraryBridge } from "../library/model";

vi.mock("@uniwork/office-upstream/pptx-renderer", async () => {
  const fakes = await import("../../../../packages/office-engine/test/fake-pptx-engine");
  const engine = fakes.createFakePptxEngine();
  const ops = fakes.createFakePptxOps();
  return {
    openPptx: (bytes: Uint8Array) => engine.openPptx(bytes),
    savePptx: (opened: OpenedPptxLike) => engine.savePptx(opened),
    commitSaved: (opened: OpenedPptxLike) => engine.commitSaved?.(opened),
    reparseDeck: (opened: OpenedPptxLike) => engine.reparseDeck?.(opened) ?? opened,
    listSlideLayouts: (archive: unknown) => engine.listSlideLayouts?.(archive) ?? [],
    runTxn: (opened: OpenedPptxLike, request: PptxTxnRequest) => ops.runTxn(opened, request),
    getSlideNotes: () => "",
    buildRenderSlide: () => ({ nodes: [] }),
    HeuristicMetrics: class HeuristicMetrics {},
  };
});

const capability = { format: "pptx", operation: "edit", host: "desktop", engineBuild: "t", contractRevision: "office-editor-host/1", status: "available", fidelityWarnings: [] } as never;
const box = (xPx: number): PptxEdit => ({ op: "add_element", slideIndex: 0, kind: "rect", xPx, yPx: 1, wPx: 10, hPx: 10 });
const scope = { sessionId: "desktop-dev-session", deploymentId: "local-device", accountId: "local:0123456789abcdef0123456789abcdef", generation: 1 };
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });

/** One app process as electron-main wires it for local files. */
async function harness() {
  const root = resolve(".test-artifacts", "pptx-local-recovery", crypto.randomUUID());
  roots.push(root);
  await fs.mkdir(root, { recursive: true });
  const path = join(root, "Deck.pptx");
  await fs.writeFile(path, makeFakePptxBytes());
  const keyStore = createFakeDraftKeyStore();

  async function launch() {
    const store = createDesktopDraftStore({ rootDirectory: join(root, "drafts"), keyStore });
    const registry = new FileHandleRegistry({ sessionId: scope.sessionId });
    const documents = createOpenedDocuments({ sessionFor: () => scope, onClosed: (id) => { registry.revoke(id); pendingRows.delete(id); } });
    const pendingRows = new Map<string, ProtectedCheckpointRef>();
    const protect = createProtectedFileCheckpoints({ store, scope: () => scope, identityFor: (handle) => registry.identityFor(handle) });
    const setLocalDocument = (metadata: OpenFileMetadata) => {
      if (!documents.open(metadata.handle, "local", localDraftIdentity(scope, registry.identityFor(metadata.handle), metadata))) throw new Error("document_context_refused");
    };
    let deletion: Promise<void> | undefined;
    const files = createFileIpcHandlers({
      registry,
      session: () => scope,
      isOpened: (handle) => documents.context(handle)?.kind === "local",
      onOpened: setLocalDocument,
      beginSave: documents.beginSave,
      checkpoint: async (metadata, bytes) => { pendingRows.set(metadata.handle, await protect(metadata, bytes)); },
      onSaveConfirmed: (metadata) => {
        if (!documents.context(metadata.handle)) setLocalDocument(metadata);
        else documents.rebase(metadata.handle, localDraftBase(metadata));
        const ref = pendingRows.get(metadata.handle);
        if (!ref) return;
        pendingRows.delete(metadata.handle);
        deletion = discardProtectedCheckpoint(store, scope, ref).catch(() => undefined);
      },
    });
    const drafts = createDraftIpcHandlers({
      store,
      context: (documentId) => documents.context(documentId),
      accountSession: () => scope,
      localSession: () => scope,
      beginCheckpoint: documents.beginCheckpoint,
      liveAccess: async () => "edit",
      currentBase: (documentId) => documents.context(documentId)?.identity.base,
    });
    const handlers = { ...files, ...drafts } as unknown as Record<string, (payload: unknown) => Promise<unknown>>;
    const bridge: LibraryBridge = { call: (async (channel: string, payload: unknown) => {
      const handler = handlers[channel];
      if (!handler) throw new Error(`Unexpected IPC: ${channel}`);
      const result = await handler(payload);
      await deletion;
      return result;
    }) as LibraryBridge["call"] };

    /** The renderer open: bytes + the identity desktop-workspace builds for a local file. */
    const open = async () => {
      // argv / Recent open: main registers the path (new handle), the file-open
      // command records the draft context and hands the bytes over.
      const registered = await registry.openPath(path);
      const opened = await files["desktop:file-open"]({ sessionGeneration: "desktop-dev-session", handle: registered.handle });
      const metadata = opened.metadata;
      const bytes = await registry.read(metadata.handle);
      const identity: OfficeIdentity = { deploymentId: "local", accountId: "local", organizationId: "local", workspaceId: "local", documentId: metadata.handle, generation: 1, baseRevision: String(Math.trunc(metadata.modifiedAtMs)), baseVersionId: metadata.checksum };
      const session = createPptxDocumentSession(bridge, identity, { format: "pptx", dataBase64: Buffer.from(bytes).toString("base64"), checksum: metadata.checksum, localHandle: metadata.handle }, (onDirty) => createDesktopPptxAdapter({ identity, runtime: createWebPptxSessionRuntime({ documentId: metadata.handle }), readBytes: async () => bytes, capability, onDirty }));
      await session.openEditor();
      return { session, metadata, store };
    };
    return { open, store, registry };
  }
  return { launch, path };
}

const elementCount = (session: { editor: { slides(): Array<{ elements: unknown[] }> } }) => session.editor.slides()[0]?.elements.length ?? 0;

describe("desktop local pptx draft recovery across a relaunch (R2-4)", () => {
  it("offers the unsaved edits again for the same path under a NEW file handle, with no conflict", async () => {
    const app = await harness();
    const first = await (await app.launch()).open();
    const baseCount = elementCount(first.session);
    await first.session.editor.edit([box(1)]);
    await first.session.editor.edit([box(2)]);
    expect(await first.session.keepDraft()).toBe(true);
    first.session.dispose(); // the kill: nothing was saved

    const second = await (await app.launch()).open();
    expect(second.metadata.handle).not.toBe(first.metadata.handle);
    expect(elementCount(second.session)).toBe(baseCount);
    const offered = await second.session.listDrafts();
    expect(offered).toMatchObject({ status: "found", conflict: false });
    if (offered.status !== "found") throw new Error("draft not offered");
    await expect(second.session.recoverDraft(offered.metadata)).resolves.toBe("recovered");
    expect(elementCount(second.session)).toBe(baseCount + 2);
    second.session.dispose();
  });

  it("recovers the edits made AFTER an ordinary Save, against the saved file, once", async () => {
    const app = await harness();
    const first = await (await app.launch()).open();
    const baseCount = elementCount(first.session);
    await first.session.editor.edit([box(1)]);
    await expect(first.session.coordinator.save("button")).resolves.toMatchObject({ accepted: true });
    await first.session.editor.edit([box(2)]);
    expect(await first.session.keepDraft()).toBe(true);
    first.session.dispose();

    const second = await (await app.launch()).open();
    expect(elementCount(second.session)).toBe(baseCount + 1);
    const offered = await second.session.listDrafts();
    expect(offered).toMatchObject({ status: "found", conflict: false });
    if (offered.status !== "found") throw new Error("draft not offered");
    await expect(second.session.recoverDraft(offered.metadata)).resolves.toBe("recovered");
    expect(elementCount(second.session)).toBe(baseCount + 2);
    second.session.dispose();
  });

  it("is a conflict, never a recoverable draft, when the file changed outside the app", async () => {
    const app = await harness();
    const first = await (await app.launch()).open();
    await first.session.editor.edit([box(1)]);
    expect(await first.session.keepDraft()).toBe(true);
    first.session.dispose();
    await fs.writeFile(app.path, makeFakePptxBytes({ slides: [{ elements: [] }] })); // another program saved a different deck

    const second = await (await app.launch()).open();
    const offered = await second.session.listDrafts();
    expect(offered).toMatchObject({ status: "found", conflict: true });
    if (offered.status !== "found") throw new Error("draft not offered");
    await expect(second.session.recoverDraft(offered.metadata)).resolves.toBe("failed");
    second.session.dispose();
  });

  it("offers nothing after the edits were saved and the app relaunched", async () => {
    const app = await harness();
    const first = await (await app.launch()).open();
    await first.session.editor.edit([box(1)]);
    expect(await first.session.keepDraft()).toBe(true);
    await expect(first.session.coordinator.save("button")).resolves.toMatchObject({ accepted: true });
    first.session.dispose();

    const second = await (await app.launch()).open();
    await expect(second.session.listDrafts()).resolves.toEqual({ status: "none" });
    second.session.dispose();
  });
});
