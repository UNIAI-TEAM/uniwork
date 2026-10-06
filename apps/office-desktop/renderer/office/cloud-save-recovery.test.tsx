/** @vitest-environment jsdom */
import { promises as fs } from "node:fs";
import { resolve } from "node:path";
import { expect, it, vi } from "vitest";
import { createByteDocumentSession } from "./session";
import { createOfficeIpcHandlers, createDraftIpcHandlers, type DesktopOfficeTransport } from "../../main/ipc";
import { createDesktopDraftStore } from "../../main/drafts/store";
import { createFakeDraftKeyStore } from "../../main/drafts/test-fake";
import { docxSource, docxIdentity, bytesChecksum, installDocxGeometry } from "../../test/docx-fixture";
import type { DraftIdentity } from "@uniwork/core/office/draft-recovery";
import type { LibraryBridge } from "../library/model";
import type { DesktopLibraryDocument, DesktopOfficeOpenResponse } from "../../shared/ipc";

installDocxGeometry();

async function cloudHarness() {
  const root = resolve(".test-artifacts", "cloud-save-recovery", crypto.randomUUID());
  await fs.mkdir(root, { recursive: true });
  const keyStore = createFakeDraftKeyStore();
  const scope = { sessionId: "desktop-dev-session", deploymentId: "lane", accountId: "account", generation: 1 };
  let document: DesktopLibraryDocument = { id: "doc", workspaceId: "ws", title: "Cloud.docx", kind: "file", format: "docx", version: 1, revision: "1", updatedAt: new Date(0).toISOString(), ownerKind: null, canEdit: true, downloadAvailable: true };
  let savedBytes = docxSource.slice();
  let saves = 0;
  let refreshes = 0;
  const controls: { refreshError?: Error; refreshWait?: Promise<void>; modify?: (opened: DesktopOfficeOpenResponse) => DesktopOfficeOpenResponse } = {};
  const checkpoints: unknown[] = [];
  const sessions: ReturnType<typeof createByteDocumentSession>[] = [];
  const unused = async (): Promise<never> => { throw new Error("Unexpected library operation"); };
  // In-memory cloud bytes/receipts isolate the renderer/main context seam.
  // The real store encrypts drafts; live ACL is injected edit here, so this
  // test deliberately makes no claim about production liveDraftAccess.
  const transport: DesktopOfficeTransport = {
    context: unused, publicConfig: unused, list: unused, create: unused, download: unused, officeJob: unused, openContext: unused,
    open: async () => {
      if (saves) {
        refreshes++;
        await controls.refreshWait;
        if (controls.refreshError) throw controls.refreshError;
      }
      const opened: DesktopOfficeOpenResponse = { document: { ...document }, dataBase64: Buffer.from(savedBytes).toString("base64"), filename: document.title, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", checksum: bytesChecksum(savedBytes) };
      return controls.modify?.(opened) ?? opened;
    },
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
      if (channel === "desktop:draft-checkpoint") checkpoints.push(payload);
      const handler = handlers[channel];
      if (!handler) throw new Error(`Unexpected IPC: ${channel}`);
      return handler(payload);
    }) as LibraryBridge["call"] };
    const opened = await office["desktop:office-open"]({ sessionGeneration: scope.sessionId, workspaceId: "ws", documentId: "doc" });
    const session = createByteDocumentSession(bridge, { ...docxIdentity, baseRevision: opened.document.revision, baseVersionId: String(opened.document.version) }, { ...opened, format: "docx" });
    sessions.push(session);
    await session.openEditor();
    return session;
  }
  return {
    open, controls, checkpoints,
    get savedBytes() { return savedBytes.slice(); },
    get saves() { return saves; },
    get refreshes() { return refreshes; },
    async cleanup() { for (const session of sessions) session.dispose(); await fs.rm(root, { recursive: true, force: true }); },
  };
}

async function assertFreshRecovery(harness: Awaited<ReturnType<typeof cloudHarness>>, savedA: Uint8Array) {
  const fresh = await harness.open();
  expect(fresh.editor.commands!.getState().headingLevel).toBe(2);
  const offered = await fresh.listDrafts();
  expect(offered).toMatchObject({ status: "found", conflict: false });
  if (offered.status !== "found") throw new Error("Cloud draft B missing");
  expect(offered.metadata.identity.base).toEqual({ revision: "2", version: "2" });
  expect(await fresh.recoverDraft(offered.metadata)).toBe("recovered");
  expect(fresh.editor.commands!.getState().headingLevel).toBe(3);
  expect(fresh.coordinator.getState()).toMatchObject({ state: "dirty", lastSavedGeneration: 0 });
  expect(harness.savedBytes).toEqual(savedA);
  expect(harness.saves).toBe(1);
}

it("recovers cloud draft B against the numeric document version after confirmed Save A", async () => {
  const harness = await cloudHarness();
  try {
    const first = await harness.open();
    first.editor.commands!.setHeading(2);
    expect(await first.coordinator.save()).toMatchObject({ accepted: true, receipt: { versionId: "version-id-2", revision: "2" } });
    const savedA = harness.savedBytes;
    first.editor.commands!.setHeading(3);
    expect(await first.keepDraft()).toBe(true);
    expect(harness.savedBytes).toEqual(savedA);
    first.dispose();
    await assertFreshRecovery(harness, savedA);
  } finally { await harness.cleanup(); }
});

it("retains a confirmed cloud receipt on refresh failure and refuses draft writes until retry succeeds", async () => {
  const harness = await cloudHarness();
  try {
    const first = await harness.open();
    first.editor.commands!.setHeading(2);
    harness.controls.refreshError = new Error("offline");
    expect(await first.coordinator.save()).toMatchObject({ accepted: true, receipt: { revision: "2" } });
    expect(first.coordinator.getState()).toMatchObject({ dirtyGeneration: 1, lastSavedGeneration: 1 });
    const savedA = harness.savedBytes;
    first.editor.commands!.setHeading(3);
    expect(await first.keepDraft()).toBe(false);
    expect(harness.checkpoints).toHaveLength(0);
    harness.controls.refreshError = undefined;
    expect(await first.keepDraft()).toBe(true);
    first.dispose();
    await assertFreshRecovery(harness, savedA);
  } finally { await harness.cleanup(); }
});

it.each(["document", "workspace", "revision", "checksum", "permission"] as const)("refuses a mismatched cloud %s refresh without invalidating the confirmed Save", async (field) => {
  const harness = await cloudHarness();
  try {
    const first = await harness.open();
    first.editor.commands!.setHeading(2);
    harness.controls.modify = (opened) => {
      if (field === "checksum") return { ...opened, checksum: `sha256:${"0".repeat(64)}` };
      return { ...opened, document: { ...opened.document, ...(field === "document" ? { id: "other" } : field === "workspace" ? { workspaceId: "other" } : field === "revision" ? { revision: "99" } : { canEdit: false }) } };
    };
    expect(await first.coordinator.save()).toMatchObject({ accepted: true, receipt: { revision: "2" } });
    const savedA = harness.savedBytes;
    first.editor.commands!.setHeading(3);
    expect(await first.keepDraft()).toBe(false);
    expect(harness.checkpoints).toHaveLength(0);
    harness.controls.modify = undefined;
    expect(await first.keepDraft()).toBe(true);
    first.dispose();
    await assertFreshRecovery(harness, savedA);
  } finally { await harness.cleanup(); }
});

it("defers cloud N+1 checkpoint during refresh, blocks a second Save, and preserves typed edits", async () => {
  const harness = await cloudHarness();
  let release!: () => void;
  harness.controls.refreshWait = new Promise<void>((resolve) => { release = resolve; });
  try {
    const first = await harness.open();
    first.editor.commands!.setHeading(2);
    const saving = first.coordinator.save();
    await vi.waitFor(() => expect(harness.refreshes).toBe(1));
    const savedA = harness.savedBytes;
    first.editor.commands!.setHeading(3);
    const keeping = first.keepDraft();
    expect(await first.coordinator.save()).toMatchObject({ accepted: false, reason: "saving" });
    expect(harness.checkpoints).toHaveLength(0);
    release();
    expect(await saving).toMatchObject({ accepted: true });
    expect(await keeping).toBe(true);
    expect(first.editor.commands!.getState().headingLevel).toBe(3);
    first.dispose();
    await assertFreshRecovery(harness, savedA);
  } finally { release(); await harness.cleanup(); }
});

it("does not recreate a cloud checkpoint for snapshot N once Save N completes", async () => {
  const harness = await cloudHarness();
  let release!: () => void;
  harness.controls.refreshWait = new Promise<void>((resolve) => { release = resolve; });
  try {
    const first = await harness.open();
    first.editor.commands!.setHeading(2);
    const saving = first.coordinator.save();
    await vi.waitFor(() => expect(harness.refreshes).toBe(1));
    const checkpointing = first.coordinator.checkpoint();
    expect(harness.checkpoints).toHaveLength(0);
    release();
    expect(await saving).toMatchObject({ accepted: true });
    await checkpointing;
    expect(harness.checkpoints).toHaveLength(0);
    expect(await first.listDrafts()).toEqual({ status: "none" });
    expect(harness.saves).toBe(1);
  } finally { release(); await harness.cleanup(); }
});
