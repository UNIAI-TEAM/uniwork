/** @vitest-environment jsdom */
import { promises as fs } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { createByteDocumentSession } from "./session";
import { createOfficeIpcHandlers, createDraftIpcHandlers, type DesktopOfficeTransport } from "../../main/ipc";
import { createDesktopDraftStore } from "../../main/drafts/store";
import { createFakeDraftKeyStore } from "../../main/drafts/test-fake";
import { docxSource, docxIdentity, bytesChecksum, installDocxGeometry } from "../../test/docx-fixture";
import type { DraftIdentity } from "@uniwork/core/office/draft-recovery";
import type { LibraryBridge } from "../library/model";
import type { DesktopLibraryDocument } from "../../shared/ipc";

installDocxGeometry();

it("recovers cloud draft B against the numeric document version after confirmed Save A", async () => {
  const root = resolve(".test-artifacts", "cloud-save-recovery", crypto.randomUUID());
  await fs.mkdir(root, { recursive: true });
  const keyStore = createFakeDraftKeyStore();
  const scope = { sessionId: "desktop-dev-session", deploymentId: "lane", accountId: "account", generation: 1 };
  let document: DesktopLibraryDocument = { id: "doc", workspaceId: "ws", title: "Cloud.docx", kind: "file", format: "docx", version: 1, revision: "1", updatedAt: new Date(0).toISOString(), ownerKind: null, canEdit: true, downloadAvailable: true };
  let savedBytes = docxSource.slice();
  let saves = 0;
  const unused = async (): Promise<never> => { throw new Error("Unexpected library operation"); };
  // In-memory cloud bytes/receipts isolate the renderer/main context seam.
  // The real store encrypts drafts; live ACL is injected edit here, so this
  // test deliberately makes no claim about production liveDraftAccess.
  const transport: DesktopOfficeTransport = {
    context: unused, list: unused, create: unused, download: unused,
    open: async () => ({ document: { ...document }, dataBase64: Buffer.from(savedBytes).toString("base64"), filename: document.title, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", checksum: bytesChecksum(savedBytes) }),
    save: async (request) => {
      expect(request.baseRevision).toBe(document.revision);
      savedBytes = Uint8Array.from(Buffer.from(request.dataBase64, "base64"));
      expect(request.checksum).toBe(bytesChecksum(savedBytes));
      saves++;
      document = { ...document, version: document.version + 1, revision: String(Number(document.revision) + 1) };
      return { documentId: document.id, intentId: request.intentId, idempotencyKey: request.idempotencyKey, versionId: `version-id-${document.version}`, revision: document.revision, checksum: request.checksum };
    },
  };
  async function open() {
    const store = createDesktopDraftStore({ rootDirectory: root, keyStore });
    let active: DraftIdentity | undefined;
    const office = createOfficeIpcHandlers({ transport, isSignedIn: () => true, onDocumentOpened: (opened) => {
      active = { deploymentId: "lane", accountId: "account", organizationId: "org", workspaceId: opened.workspaceId, documentId: opened.id, base: { revision: opened.revision, version: String(opened.version) } };
    } });
    const drafts = createDraftIpcHandlers({ store, context: () => active ? { session: scope, identity: active } : undefined, liveAccess: async () => "edit" });
    const handlers = { ...office, ...drafts } as unknown as Record<string, (payload: unknown) => Promise<unknown>>;
    const bridge: LibraryBridge = { call: (async (channel: string, payload: unknown) => {
      const handler = handlers[channel];
      if (!handler) throw new Error(`Unexpected IPC: ${channel}`);
      return handler(payload);
    }) as LibraryBridge["call"] };
    const opened = await office["desktop:office-open"]({ sessionGeneration: scope.sessionId, workspaceId: "ws", documentId: "doc" });
    const session = createByteDocumentSession(bridge, { ...docxIdentity, baseRevision: opened.document.revision, baseVersionId: String(opened.document.version) }, opened);
    await session.openEditor();
    return session;
  }
  let first: Awaited<ReturnType<typeof open>> | undefined;
  let fresh: Awaited<ReturnType<typeof open>> | undefined;
  try {
    first = await open();
    first.editor.commands!.setHeading(2);
    expect(await first.coordinator.save()).toMatchObject({ accepted: true, receipt: { versionId: "version-id-2", revision: "2" } });
    const savedA = savedBytes.slice();
    first.editor.commands!.setHeading(3);
    expect(await first.keepDraft()).toBe(true);
    expect(savedBytes).toEqual(savedA);
    first.dispose();
    fresh = await open();
    expect(fresh.editor.commands!.getState().headingLevel).toBe(2);
    const offered = await fresh.listDrafts();
    expect(offered).toMatchObject({ status: "found", conflict: false });
    if (offered.status !== "found") throw new Error("Cloud draft B missing");
    expect(offered.metadata.identity.base).toEqual({ revision: "2", version: "2" });
    expect(await fresh.recoverDraft(offered.metadata)).toBe(true);
    expect(fresh.editor.commands!.getState().headingLevel).toBe(3);
    expect(fresh.coordinator.getState()).toMatchObject({ state: "dirty", lastSavedGeneration: 0 });
    expect(savedBytes).toEqual(savedA);
    expect(saves).toBe(1);
  } finally { first?.dispose(); fresh?.dispose(); await fs.rm(root, { recursive: true, force: true }); }
});
