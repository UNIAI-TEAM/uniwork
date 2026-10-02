/** @vitest-environment jsdom */
import { promises as fs } from "node:fs";
import { resolve, join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createByteDocumentSession } from "./session";
import { createFileIpcHandlers, createDraftIpcHandlers } from "../../main/ipc";
import { FileHandleRegistry, type OpenFileMetadata } from "../../main/files/registry";
import { createProtectedFileCheckpoints, discardProtectedCheckpoint, localDraftIdentity, type ProtectedCheckpointRef } from "../../main/files/protected-files";
import { createDesktopDraftStore } from "../../main/drafts/store";
import { createFakeDraftKeyStore } from "../../main/drafts/test-fake";
import { docxSource, docxIdentity, installDocxGeometry } from "../../test/docx-fixture";
import type { DraftIdentity } from "@uniwork/core/office/draft-recovery";
import type { LibraryBridge } from "../library/model";

installDocxGeometry();
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });

async function localHarness() {
  const root = resolve(".test-artifacts", "local-save-recovery", crypto.randomUUID());
  roots.push(root);
  await fs.mkdir(root, { recursive: true });
  const path = join(root, "Original.docx");
  await fs.writeFile(path, docxSource);
  const keyStore = createFakeDraftKeyStore();
  const scope = { sessionId: "desktop-dev-session", deploymentId: "lane", accountId: "account", generation: 1 };
  const writes: string[] = [];
  async function open() {
    const store = createDesktopDraftStore({ rootDirectory: join(root, "drafts"), keyStore });
    const registry = new FileHandleRegistry({ sessionId: scope.sessionId });
    let active: DraftIdentity | undefined;
    let protectedRow: ProtectedCheckpointRef | undefined;
    let deletion: Promise<void> | undefined;
    const bind = (metadata: OpenFileMetadata) => { active = localDraftIdentity(scope, registry.identityFor(metadata.handle), metadata); };
    const protect = createProtectedFileCheckpoints({ store, scope: () => scope, identityFor: (handle) => registry.identityFor(handle) });
    const files = createFileIpcHandlers({ registry, onOpened: bind,
      checkpoint: async (metadata, bytes) => { bind(metadata); protectedRow = await protect(metadata, bytes); },
      onSaveConfirmed: () => { if (protectedRow) deletion = discardProtectedCheckpoint(store, scope, protectedRow); protectedRow = undefined; },
    });
    const drafts = createDraftIpcHandlers({ store, context: () => active ? { session: scope, identity: active } : undefined, liveAccess: async () => "edit" });
    const handlers = { ...files, ...drafts } as unknown as Record<string, (payload: unknown) => Promise<unknown>>;
    const bridge: LibraryBridge = { call: (async (channel: string, payload: unknown) => {
      if (channel === "desktop:file-save") writes.push(channel);
      const handler = handlers[channel];
      if (!handler) throw new Error(`Unexpected IPC: ${channel}`);
      const result = await handler(payload);
      await deletion;
      return result;
    }) as LibraryBridge["call"] };
    const metadata = await registry.openPath(path);
    bind(metadata);
    const session = createByteDocumentSession(bridge,
      { ...docxIdentity, documentId: metadata.handle, baseVersionId: metadata.checksum, baseRevision: String(Math.trunc(metadata.modifiedAtMs)) },
      { localHandle: metadata.handle, checksum: metadata.checksum, dataBase64: Buffer.from(await registry.read(metadata.handle)).toString("base64") });
    await session.openEditor();
    return { session, store, registry, active: () => active! };
  }
  return { open, writes, path };
}

it("recovers edit B after ordinary local Save A against the newly saved file base", async () => {
  const harness = await localHarness();
  const first = await harness.open();
  let reopened: Awaited<ReturnType<typeof harness.open>> | undefined;
  try {
    first.session.editor.commands!.setHeading(2);
    expect(await first.session.coordinator.save("menu")).toMatchObject({ accepted: true });
    const savedA = await fs.readFile(harness.path);
    first.session.editor.commands!.setHeading(3);
    expect(await first.session.keepDraft()).toBe(true);
    expect(await fs.readFile(harness.path)).toEqual(savedA);
    first.session.dispose();
    reopened = await harness.open();
    expect(reopened.registry).not.toBe(first.registry);
    expect(reopened.store).not.toBe(first.store);
    expect(reopened.session.editor.commands!.getState().headingLevel).toBe(2);
    const offered = await reopened.session.listDrafts();
    expect(offered).toMatchObject({ status: "found", conflict: false });
    if (offered.status !== "found") throw new Error("Protected draft B missing");
    expect(offered.metadata.identity.base).toEqual(reopened.active().base);
    expect(await reopened.session.recoverDraft(offered.metadata)).toBe(true);
    expect(reopened.session.editor.commands!.getState().headingLevel).toBe(3);
    expect(reopened.session.coordinator.getState()).toMatchObject({ state: "dirty", lastSavedGeneration: 0 });
    expect(await fs.readFile(harness.path)).toEqual(savedA);
    expect(harness.writes).toHaveLength(1);
  } finally { first.session.dispose(); reopened?.session.dispose(); }
});
