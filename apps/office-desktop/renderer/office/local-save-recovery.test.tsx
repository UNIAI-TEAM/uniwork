/** @vitest-environment jsdom */
import { promises as fs } from "node:fs";
import { resolve, join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
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
  const controls = { refreshError: false, refreshWait: undefined as Promise<void> | undefined, refreshCalls: 0, checkpointCalls: 0 };
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
      if (channel === "desktop:draft-checkpoint") controls.checkpointCalls++;
      if (channel === "desktop:file-open") {
        controls.refreshCalls++;
        await controls.refreshWait;
        if (controls.refreshError) throw new Error("Read-only context refresh refused");
      }
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
  return { open, writes, path, controls };
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
    expect(await reopened.session.recoverDraft(offered.metadata)).toBe("recovered");
    expect(reopened.session.editor.commands!.getState().headingLevel).toBe(3);
    expect(reopened.session.coordinator.getState()).toMatchObject({ state: "dirty", lastSavedGeneration: 0 });
    expect(await fs.readFile(harness.path)).toEqual(savedA);
    expect(harness.writes).toHaveLength(1);
  } finally { first.session.dispose(); reopened?.session.dispose(); }
});

it("consumes the recovered local draft after its confirmed Save", async () => {
  const harness = await localHarness();
  const first = await harness.open();
  let reopened: Awaited<ReturnType<typeof harness.open>> | undefined;
  try {
    first.session.editor.commands!.setHeading(2);
    expect(await first.session.keepDraft()).toBe(true);
    first.session.dispose();
    reopened = await harness.open();
    const offered = await reopened.session.listDrafts();
    expect(offered).toMatchObject({ status: "found", conflict: false });
    if (offered.status !== "found") throw new Error("Recovered local draft missing");
    expect(await reopened.session.recoverDraft(offered.metadata)).toBe("recovered");
    expect(await reopened.session.coordinator.save()).toMatchObject({ accepted: true });
    expect(await reopened.session.listDrafts()).toEqual({ status: "none" });
  } finally { first.session.dispose(); reopened?.session.dispose(); }
});

it("retains a confirmed Save when context refresh fails and retries before a later checkpoint", async () => {
  const harness = await localHarness();
  const first = await harness.open();
  let reopened: Awaited<ReturnType<typeof harness.open>> | undefined;
  try {
    harness.controls.refreshError = true;
    first.session.editor.commands!.setHeading(2);
    expect(await first.session.coordinator.save()).toMatchObject({ accepted: true });
    expect(first.session.coordinator.getState()).toMatchObject({ dirtyGeneration: 1, lastSavedGeneration: 1 });
    const savedA = await fs.readFile(harness.path);
    first.session.editor.commands!.setHeading(3);
    expect(await first.session.keepDraft()).toBe(false);
    expect(harness.controls.checkpointCalls).toBe(0);
    expect(await first.store.list({ session: { sessionId: "desktop-dev-session", deploymentId: "lane", accountId: "account", generation: 1 } })).toHaveLength(0);
    expect(harness.writes).toHaveLength(1);
    harness.controls.refreshError = false;
    expect(await first.session.keepDraft()).toBe(true);
    first.session.dispose();
    reopened = await harness.open();
    const offered = await reopened.session.listDrafts();
    expect(offered).toMatchObject({ status: "found", conflict: false });
    if (offered.status !== "found") throw new Error("Protected draft B missing");
    expect(await reopened.session.recoverDraft(offered.metadata)).toBe("recovered");
    expect(reopened.session.editor.commands!.getState().headingLevel).toBe(3);
    expect(await fs.readFile(harness.path)).toEqual(savedA);
    expect(harness.writes).toHaveLength(1);
  } finally { first.session.dispose(); reopened?.session.dispose(); }
});

it("does not recreate a draft for snapshot N after its pending local Save is confirmed", async () => {
  const harness = await localHarness();
  const first = await harness.open();
  let release!: () => void;
  harness.controls.refreshWait = new Promise<void>((resolve) => { release = resolve; });
  try {
    first.session.editor.commands!.setHeading(2);
    const saving = first.session.coordinator.save();
    await vi.waitFor(() => expect(harness.controls.refreshCalls).toBe(1));
    const snapshotN = await first.session.editor.captureSnapshot();
    vi.spyOn(first.session.editor, "captureSnapshot").mockResolvedValue(snapshotN);
    const checkpointing = first.session.coordinator.checkpoint();
    release();
    expect(await saving).toMatchObject({ accepted: true });
    await checkpointing;
    expect(harness.controls.checkpointCalls).toBe(0);
    expect(await first.session.listDrafts()).toEqual({ status: "none" });
    expect(harness.writes).toHaveLength(1);
  } finally { release(); first.session.dispose(); }
});

it("defers an N+1 checkpoint during context refresh and refuses another Save", async () => {
  const harness = await localHarness();
  const first = await harness.open();
  let reopened: Awaited<ReturnType<typeof harness.open>> | undefined;
  let release!: () => void;
  harness.controls.refreshWait = new Promise<void>((resolve) => { release = resolve; });
  try {
    first.session.editor.commands!.setHeading(2);
    const saving = first.session.coordinator.save();
    await vi.waitFor(() => expect(harness.controls.refreshCalls).toBe(1));
    first.session.editor.commands!.setHeading(3);
    const snapshotB = await first.session.editor.captureSnapshot();
    vi.spyOn(first.session.editor, "captureSnapshot").mockResolvedValue(snapshotB);
    let checkpointDone = false;
    const checkpointing = first.session.coordinator.checkpoint().then(() => { checkpointDone = true; });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(checkpointDone).toBe(false);
    expect(harness.controls.checkpointCalls).toBe(0);
    expect(await first.session.coordinator.save("shortcut")).toMatchObject({ accepted: false, reason: "saving" });
    release();
    expect(await saving).toMatchObject({ accepted: true });
    await checkpointing;
    expect(first.session.coordinator.getState()).toMatchObject({ state: "dirty", lastSavedGeneration: 1, dirtyGeneration: 2 });
    first.session.dispose();
    reopened = await harness.open();
    const offered = await reopened.session.listDrafts();
    expect(offered).toMatchObject({ status: "found", conflict: false });
    if (offered.status !== "found") throw new Error("Protected draft B missing");
    expect(await reopened.session.recoverDraft(offered.metadata)).toBe("recovered");
    expect(reopened.session.editor.commands!.getState().headingLevel).toBe(3);
    expect(harness.writes).toHaveLength(1);
  } finally { release(); first.session.dispose(); reopened?.session.dispose(); }
});
