/** @vitest-environment jsdom */
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import i18n from "i18next";
import { parseDocx } from "@uniwork/office-upstream/docs-renderer-editor";
import { createByteDocumentSession, type OpenedBytes } from "./session";
import { OpenByteDocument } from "./open-document";
import type { RendererBridge } from "../app";
import { bytesChecksum, docxSource, docxIdentity, zipParts, installDocxGeometry } from "../../test/docx-fixture";

installDocxGeometry();
const original = { dataBase64: Buffer.from(docxSource).toString("base64"), checksum: bytesChecksum(docxSource) };
const handle = `file_${"x".repeat(40)}`;
const newHandle = `file_${"y".repeat(40)}`;
type SavePayload = { dataBase64: string; documentId: string; intentId: string; idempotencyKey: string; checksum: string; handle: string };

function harness(handler: (channel: string, payload: SavePayload) => Promise<unknown>, opened: OpenedBytes = original) {
  let nativeSave: ((event: { documentId: string }) => void) | undefined;
  const call = vi.fn(async (channel: string, payload: SavePayload) => channel === "desktop:draft-list" ? { drafts: [] } : handler(channel, payload));
  const bridge = { call, onOfficeSaveRequested: (listener: typeof nativeSave) => { nativeSave = listener; return () => { nativeSave = undefined; }; } } as unknown as RendererBridge;
  const identity = { ...docxIdentity, documentId: opened.localHandle ?? "doc" };
  const session = createByteDocumentSession(bridge, identity, opened);
  const rebound = vi.fn();
  render(<OpenByteDocument bridge={bridge} identity={identity} session={session} title="Original.docx" onBack={() => undefined} onLocalFileRebound={rebound} />);
  return { session, call, rebound, nativeSave: (documentId = identity.documentId) => nativeSave?.({ documentId }) };
}

const cloudReceipt = (payload: SavePayload) => ({ documentId: payload.documentId, intentId: payload.intentId, idempotencyKey: payload.idempotencyKey, checksum: payload.checksum, versionId: "v2", revision: "2" });
const localReceipt = (payload: SavePayload, target = handle) => ({ opened: true, metadata: { handle: target, name: target === newHandle ? "Copy.docx" : "Original.docx", checksum: bytesChecksum(Buffer.from(payload.dataBase64, "base64")), byteLength: Buffer.from(payload.dataBase64, "base64").length, modifiedAtMs: 20.75 } });

it("commits real edited bytes once through native Save and preserves every untouched OOXML part", async () => {
  const { session, call, nativeSave } = harness(async (channel, payload) => channel === "desktop:office-save" ? cloudReceipt(payload) : {});
  await screen.findByTestId("docx-document-surface", {}, { timeout: 10000 });
  act(() => session.editor.commands?.setHeading(2));
  act(() => nativeSave());
  await waitFor(() => expect(session.coordinator.getState().lastSavedGeneration).toBe(1));
  expect(session.coordinator.getState().state).toBe("saved");
  const saves = call.mock.calls.filter(([channel]) => channel === "desktop:office-save");
  expect(saves).toHaveLength(1);
  const saved = Uint8Array.from(Buffer.from(saves[0]![1].dataBase64, "base64"));
  expect(saves[0]![1].checksum).toBe(bytesChecksum(saved));
  expect((await parseDocx(saved)).blocks[0]).toMatchObject({ type: "heading", level: 2 });
  const before = zipParts(docxSource), after = zipParts(saved);
  expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
  expect(after.get("word/document.xml")).not.toEqual(before.get("word/document.xml"));
  for (const [name, value] of before) if (name !== "word/document.xml") expect(after.get(name), name).toEqual(value);
  const reopened = createByteDocumentSession({ call: call as never }, { ...docxIdentity, baseVersionId: "v2", baseRevision: "2" }, { dataBase64: Buffer.from(saved).toString("base64"), checksum: bytesChecksum(saved) });
  await reopened.openEditor();
  expect(reopened.editor.commands?.getState().headingLevel).toBe(2);
  expect(reopened.coordinator.getState().dirtyGeneration).toBe(0);
  reopened.dispose();
});

it("keeps N+1 dirty while Save N is in flight and refuses a second Save", async () => {
  let complete!: () => void;
  const { session, call } = harness(async (channel, payload) => channel === "desktop:office-save" ? new Promise((resolve) => { complete = () => resolve(cloudReceipt(payload)); }) : {});
  await screen.findByTestId("docx-document-surface");
  act(() => session.editor.commands?.setHeading(2));
  let first!: ReturnType<typeof session.coordinator.save>;
  act(() => { first = session.coordinator.save("button"); });
  await waitFor(() => expect(complete).toBeTypeOf("function"));
  act(() => session.editor.commands?.setHeading(3));
  await expect(session.coordinator.save("shortcut")).resolves.toMatchObject({ accepted: false, reason: "saving" });
  await act(async () => { complete(); await first; });
  expect(session.coordinator.getState()).toMatchObject({ state: "dirty", lastSavedGeneration: 1, dirtyGeneration: 2 });
  const request = call.mock.calls.find(([channel]) => channel === "desktop:office-save")![1];
  expect((await parseDocx(Buffer.from(request.dataBase64, "base64"))).blocks[0]).toMatchObject({ type: "heading", level: 2 });
  expect(session.editor.commands?.getState().headingLevel).toBe(3);
});

it("rebinds Save As to the confirmed new file and routes later Save and drafts to it", async () => {
  const { session, call, rebound, nativeSave } = harness(async (channel, payload) => {
    if (channel === "desktop:file-save-as") return localReceipt(payload, newHandle);
    if (channel === "desktop:file-open") return { ...localReceipt({ ...payload, dataBase64: original.dataBase64 }, newHandle), dataBase64: original.dataBase64 };
    if (channel === "desktop:file-save") return localReceipt(payload, newHandle);
    if (channel === "desktop:draft-checkpoint") return { stored: true, generation: 3 };
    return {};
  }, { ...original, localHandle: handle });
  await screen.findByTestId("docx-document-surface");
  act(() => session.editor.commands?.setHeading(2));
  fireEvent.click(screen.getByRole("button", { name: i18n.t("officeDesktop.library.saveAs") }));
  await waitFor(() => expect(rebound).toHaveBeenCalledWith({ handleId: newHandle, displayName: "Copy.docx" }));
  expect(session.localHandle).toBe(newHandle);
  expect(session.coordinator.getState()).toMatchObject({ dirtyGeneration: 1, lastSavedGeneration: 1, identity: { documentId: newHandle, baseRevision: "20" } });
  expect(call.mock.calls.some(([channel]) => channel === "desktop:file-save")).toBe(false);
  expect(screen.getByText("Copy.docx")).toBeInTheDocument();
  act(() => session.editor.commands?.setHeading(3));
  await act(async () => { await session.keepDraft(); });
  expect(call.mock.calls.find(([channel]) => channel === "desktop:draft-checkpoint")?.[1]).toMatchObject({ draftId: `${newHandle}:${session.coordinator.getState().identity.baseVersionId}:20` });
  act(() => nativeSave(newHandle));
  await waitFor(() => expect(call.mock.calls.find(([channel]) => channel === "desktop:file-save")?.[1]).toMatchObject({ handle: newHandle }));
});

it("cancels a clean Save As without rebinding, leaving the document clean and writable", async () => {
  const { session, call, rebound } = harness(async () => ({ opened: false }), { ...original, localHandle: handle });
  await screen.findByTestId("docx-document-surface");
  await act(async () => { await expect(session.saveAs()).resolves.toEqual({ accepted: false, reason: "cancelled" }); });
  expect(session.localHandle).toBe(handle);
  expect(session.coordinator.getState()).toMatchObject({ state: "ready", dirtyGeneration: 0, lastSavedGeneration: 0 });
  expect(rebound).not.toHaveBeenCalled();
  expect(call.mock.calls.filter(([channel]) => channel === "desktop:file-save-as")).toHaveLength(1);
  act(() => session.editor.commands?.setHeading(2));
  expect(session.coordinator.getState()).toMatchObject({ state: "dirty", dirtyGeneration: 1 });
});

it("shows a reasoned corrupt-file error with no Save", async () => {
  const broken = harness(async () => ({}), { dataBase64: "AQID", checksum: bytesChecksum(new Uint8Array([1, 2, 3])) });
  expect(await screen.findByTestId("office-open-error")).toHaveTextContent(/.+/);
  expect(document.querySelector(".ProseMirror")).toBeNull();
  expect(screen.queryByRole("button", { name: i18n.t("office.save.save") })).toBeNull();
  await expect(broken.session.coordinator.save()).resolves.toMatchObject({ accepted: false });
});

it("renders document content without editing or save controls when permission is read-only", async () => {
  const { session, call } = harness(async () => ({}), { ...original, canSave: false });
  expect(await screen.findByTestId("docx-readonly-surface")).toBeInTheDocument();
  expect(document.querySelector('.ProseMirror[contenteditable="false"]')).not.toBeNull();
  expect(document.querySelector('.ProseMirror[contenteditable="true"]')).toBeNull();
  expect(screen.queryByTestId("docx-formatting-toolbar")).toBeNull();
  await expect(session.coordinator.save()).resolves.toMatchObject({ accepted: false, reason: "readonly" });
  expect(call.mock.calls.some(([channel]) => /save/.test(channel))).toBe(false);
});

it("retains edits made during Save As after rebinding the new file", async () => {
  let complete!: () => void;
  const { session } = harness(async (channel, payload) => {
    if (channel === "desktop:file-save-as") return new Promise((resolve) => { complete = () => resolve(localReceipt(payload, newHandle)); });
    if (channel === "desktop:file-open") return localReceipt({ ...payload, dataBase64: original.dataBase64 }, newHandle);
    return {};
  }, { ...original, localHandle: handle });
  await screen.findByTestId("docx-document-surface");
  act(() => session.editor.commands?.setHeading(2));
  let first!: ReturnType<typeof session.saveAs>;
  act(() => { first = session.saveAs(); });
  await waitFor(() => expect(complete).toBeTypeOf("function"));
  act(() => session.editor.commands?.setHeading(3));
  await act(async () => { complete(); await expect(first).resolves.toMatchObject({ accepted: true }); });
  expect(session.coordinator.getState()).toMatchObject({ state: "dirty", lastSavedGeneration: 1, dirtyGeneration: 2, identity: { documentId: newHandle } });
  expect(session.editor.commands?.getState().headingLevel).toBe(3);
});

it("restores a real protected draft into a fresh editor and leaves it unsaved", async () => {
  let checkpointBytes = "";
  const draft = { draftId: "doc:v1:1", identity: { deploymentId: "lane", accountId: "account", organizationId: "org", workspaceId: "ws", documentId: "doc", base: { revision: "1", version: "v1" } }, generation: 3, checksum: original.checksum, byteLength: docxSource.length, updatedAt: 10 };
  const call = vi.fn(async (channel: string, payload: { dataBase64: string }) => {
    if (channel === "desktop:draft-list") return { drafts: [] };
    if (channel === "desktop:draft-checkpoint") { checkpointBytes = payload.dataBase64; return { stored: true, generation: 3 }; }
    if (channel === "desktop:draft-recover") return { status: "recovered", metadata: draft, dataBase64: checkpointBytes };
    return {};
  });
  const session = createByteDocumentSession({ call: call as never }, docxIdentity, original);
  await session.openEditor();
  session.editor.commands?.setHeading(2);
  await expect(session.keepDraft()).resolves.toBe(true);
  session.dispose();
  const restarted = createByteDocumentSession({ call: call as never }, docxIdentity, original);
  try {
    await expect(restarted.recoverDraft(draft)).resolves.toBe(true);
    expect(restarted.editor.commands?.getState().headingLevel).toBe(2);
    expect(restarted.coordinator.getState()).toMatchObject({ state: "dirty", dirtyGeneration: 1, lastSavedGeneration: 0 });
    expect(call.mock.calls.some(([channel]) => /office-save|file-save/.test(channel))).toBe(false);
  } finally { restarted.dispose(); }
});

it("refuses a receipt for another document without clearing dirty work", async () => {
  const { session, call } = harness(async (channel, payload) => channel === "desktop:office-save" ? { ...cloudReceipt(payload), documentId: "other-doc" } : {});
  await screen.findByTestId("docx-document-surface");
  act(() => session.editor.commands?.setHeading(2));
  await act(async () => { await expect(session.coordinator.save()).resolves.toMatchObject({ accepted: false, reason: "error" }); });
  expect(session.coordinator.getState()).toMatchObject({ lastSavedGeneration: 0, dirtyGeneration: 1 });
  expect(call.mock.calls.filter(([channel]) => channel === "desktop:office-save")).toHaveLength(1);
});
