/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import i18n from "i18next";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DesktopDraftMetadata, DesktopSessionMetadata } from "../shared/ipc";
import { App, type RendererBridge } from "./app";
import { bytesChecksum, docxSource, installDocxGeometry } from "../test/docx-fixture";
import { settleDocxSessions } from "../test/settle-sessions";

installDocxGeometry();
const fixtureBase64 = Buffer.from(docxSource).toString("base64");
const fixtureChecksum = bytesChecksum(docxSource);

const sessions = vi.hoisted(() => new Map<string, import("./office/session").ByteDocumentSession>());
vi.mock("./office/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./office/session")>();
  return { ...actual, createByteDocumentSession: (...args: Parameters<typeof actual.createByteDocumentSession>) => {
    const session = actual.createByteDocumentSession(...args);
    // A document reopened under the same id replaces the entry; keep the old
    // session reachable so teardown still settles its load.
    const previous = sessions.get(args[1].documentId);
    if (previous) sessions.set(`${args[1].documentId}#replaced${sessions.size}`, previous);
    sessions.set(args[1].documentId, session);
    return session;
  } };
});
beforeEach(() => sessions.clear());
afterEach(() => settleDocxSessions(sessions));

function harness(options: { failSave?: boolean; failLogout?: boolean; readOnly?: boolean; beforeTabsUpdate?: () => Promise<void>; beforeSave?: () => Promise<void> } = {}) {
  const checksum = fixtureChecksum;
  const documents = Array.from({ length: 10 }, (_, index) => ({ id: `doc-${index}`, workspaceId: "ws", title: `Plan${index}.docx`, kind: "file", format: "docx", version: 1, revision: "1", updatedAt: "2026-10-01T00:00:00Z", ownerKind: null, canEdit: true, downloadAvailable: true }));
  let account = "account";
  let savedChecksum = checksum;
  let savedVersion = 1;
  let savedRevision = "1";
  let sessionListener: ((value: DesktopSessionMetadata) => void) | undefined;
  let nativeSave: ((value: { documentId: string }) => void) | undefined;
  let hostLeave: ((value: { requestId: string; reason: "close" }) => void) | undefined;
  const drafts = new Map<string, DesktopDraftMetadata>();
  const call = vi.fn(async (channel: string, payload: unknown) => {
    const request = payload as { documentId?: string; draftId?: string; intentId?: string; idempotencyKey?: string; generation?: number };
    if (channel === "desktop:auth-config") return { clientId: "uniwork-office-dev", deploymentId: "lane" };
    if (channel === "desktop:auth-session") return { status: "signed-in", deploymentId: "lane", accountId: account };
    if (channel === "desktop:library-context") return { deployments: [{ id: "lane", name: "Server" }], accounts: [{ id: account, name: account }], organizations: [{ id: "org", name: "Org" }], workspaces: [{ id: "ws", name: "Workspace" }] };
    if (channel === "desktop:library-list") return { documents, nextCursor: null, engineAvailable: true };
    if (channel === "desktop:office-open") return { document: { ...documents.find((entry) => entry.id === request.documentId), version: savedVersion, revision: savedRevision, canEdit: !options.readOnly }, dataBase64: fixtureBase64, checksum: savedChecksum, filename: "Plan.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
    if (channel === "desktop:tabs-update") { await options.beforeTabsUpdate?.(); return { updated: true }; }
    if (channel === "desktop:draft-list") return { drafts: [...drafts.values()].filter((row) => row.identity.accountId === account && (!request.documentId || row.identity.documentId === request.documentId)) };
    if (channel === "desktop:draft-checkpoint") {
      const parts = request.draftId!.split(":");
      drafts.set(request.draftId!, {
        draftId: request.draftId!, generation: request.generation!, checksum, byteLength: docxSource.length, updatedAt: Date.now(),
        identity: { deploymentId: "lane", accountId: account, organizationId: "org", workspaceId: "ws", documentId: request.documentId!, base: { version: parts.at(-2)!, revision: parts.at(-1)! } },
      });
      return { stored: true, generation: request.generation };
    }
    if (channel === "desktop:draft-discard") return { discarded: drafts.get(request.draftId!)?.generation === request.generation && drafts.delete(request.draftId!) };
    if (channel === "desktop:office-save") {
      await options.beforeSave?.();
      if (options.failSave) throw new Error("save refused");
      savedChecksum = (payload as { checksum: string }).checksum;
      savedVersion = 2; savedRevision = "2";
      return { documentId: request.documentId, intentId: request.intentId, idempotencyKey: request.idempotencyKey, versionId: String(savedVersion), revision: savedRevision, checksum: savedChecksum };
    }
    if (channel === "desktop:auth-logout") {
      if (options.failLogout) throw new Error("logout unavailable");
      return { status: "signed-out" };
    }
    if (channel === "desktop:leave-resolved") return { resolved: true };
    return { updated: true };
  });
  const bridge: RendererBridge = {
    call: call as RendererBridge["call"],
    onSessionChanged: (listener) => { sessionListener = listener; return () => undefined; },
    onOfficeSaveRequested: (listener) => { nativeSave = listener; return () => undefined; },
    onLeaveRequested: (listener) => { hostLeave = listener; return () => undefined; },
  };
  const rendered = render(<App bridge={bridge} />);
  return { ...rendered, call, native: (id: string) => act(() => nativeSave?.({ documentId: id })), leave: () => act(() => hostLeave?.({ requestId: "leave-test", reason: "close" })), switchAccount: () => act(() => { account = "second-account"; sessionListener?.({ status: "signed-in", deploymentId: "lane", accountId: account }); }) };
}

async function open(index: number) {
  fireEvent.click(await screen.findByRole("tab", { name: i18n.t("officeDesktop.tabs.library") }));
  const library = screen.getByRole("tabpanel");
  await within(library).findByText(`Plan${index}.docx`);
  fireEvent.click(within(library).getAllByRole("button", { name: i18n.t("officeDesktop.library.open") })[index]!);
  return screen.findByRole("tab", { name: new RegExp(`Plan${index}\\.docx`) });
}

/** Simulate an engine edit through its snapshot contract, without wiring G4-06b. */
async function edit(id: string) {
  const session = sessions.get(id)!;
  await session.openEditor();
  const snapshot = await session.editor.captureSnapshot();
  vi.spyOn(session.editor, "captureSnapshot").mockResolvedValue({ ...snapshot, generation: 1 });
  vi.spyOn(session.editor, "getDirtyGeneration").mockReturnValue(1);
  act(() => session.coordinator.markDirty(1));
}

it("keeps sessions mounted across switch and library navigation, deduplicates, and closes a clean tab", async () => {
  const { call, container } = harness();
  await open(0);
  const firstSession = sessions.get("doc-0");
  await open(1);
  expect(container.querySelector("#desktop-panel-doc-0")).toHaveAttribute("hidden");
  expect(container.querySelector("#desktop-panel-doc-0")).toHaveAttribute("inert");
  await open(0);
  expect(sessions.get("doc-0")).toBe(firstSession);
  expect(call.mock.calls.filter(([channel]) => channel === "desktop:office-open")).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: i18n.t("officeDesktop.tabs.close", { name: "Plan0.docx" }) }));
  await waitFor(() => expect(container.querySelector("#desktop-panel-doc-0")).toBeNull());
  expect(screen.getByRole("tab", { name: /Plan1/ })).toHaveAttribute("aria-selected", "true");
});

it("scopes Ctrl+S and native Save to the selected document and disables them on Library", async () => {
  const h = harness();
  await open(0); await open(1);
  await edit("doc-0"); await edit("doc-1");
  fireEvent.keyDown(window, { key: "s", ctrlKey: true });
  await waitFor(() => expect(h.call.mock.calls.filter(([channel]) => channel === "desktop:office-save")).toHaveLength(1));
  expect(h.call.mock.calls.find(([channel]) => channel === "desktop:office-save")?.[1]).toMatchObject({ documentId: "doc-1" });
  expect(sessions.get("doc-0")!.coordinator.getState().state).toBe("dirty");
  h.native("doc-0");
  await act(async () => { await Promise.resolve(); });
  expect(h.call.mock.calls.filter(([channel]) => channel === "desktop:office-save")).toHaveLength(1);
  fireEvent.click(screen.getByRole("tab", { name: i18n.t("officeDesktop.tabs.library") }));
  fireEvent.keyDown(window, { key: "s", ctrlKey: true }); h.native("doc-1");
  await act(async () => { await Promise.resolve(); });
  expect(h.call.mock.calls.filter(([channel]) => channel === "desktop:office-save")).toHaveLength(1);
});

it("waits for native registration before opening and then registers the live document set", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const h = harness({ beforeTabsUpdate: () => gate });
  await screen.findByText("Plan0.docx");
  fireEvent.click(screen.getAllByRole("button", { name: i18n.t("officeDesktop.library.open") })[0]!);
  expect(h.call.mock.calls.filter(([channel]) => channel === "desktop:office-open")).toHaveLength(0);
  await act(async () => { release(); await gate; });
  await screen.findByRole("tab", { name: /Plan0/ });
  await waitFor(() => expect(h.call).toHaveBeenCalledWith("desktop:tabs-update", expect.objectContaining({ documentIds: ["doc-0"], activeDocumentId: "doc-0" })));
});

it("closes an unchanged readonly document without a dirty leave prompt", async () => {
  const h = harness({ readOnly: true });
  await open(0);
  expect(screen.getByRole("tab", { name: /Plan0/ })).not.toHaveAttribute("data-dirty", "true");
  fireEvent.keyDown(window, { key: "w", ctrlKey: true });
  await waitFor(() => expect(h.container.querySelector("#desktop-panel-doc-0")).toBeNull());
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("shows dirty state, cancels dirty close and keeps a failed dialog Save open", async () => {
  const h = harness({ failSave: true });
  await open(0);
  await edit("doc-0");
  expect(screen.getByRole("tab", { name: /Plan0/ })).toHaveTextContent("Plan0.docx");
  fireEvent.keyDown(window, { key: "w", ctrlKey: true });
  await screen.findByRole("dialog");
  fireEvent.click(within(screen.getByRole("dialog")).getAllByRole("button", { name: i18n.t("office.leave.stay") }).at(-1)!);
  // The kept-mounted Track changes popover is a closed role="dialog" too; the leave dialog must be gone.
  await waitFor(() => expect(document.querySelector('[role="dialog"]:not([data-slot="popover-content"])')).toBeNull());
  expect(screen.getByRole("tab", { name: /Plan0/ })).toBeInTheDocument();
  // After initial recovery and cancellation settle, create a durable checkpoint
  // so Discard exercises row consumption without depending on its timer.
  await act(async () => { expect(await sessions.get("doc-0")!.keepDraft()).toBe(true); });
  fireEvent.keyDown(window, { key: "w", ctrlKey: true });
  await screen.findByRole("dialog");
  fireEvent.click(screen.getByRole("button", { name: i18n.t("office.leave.save") }));
  await screen.findByText(i18n.t("office.leave.write_failed"), undefined, { timeout: 10_000 });
  expect(h.container.querySelector("#desktop-panel-doc-0")).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: i18n.t("office.leave.discard") }));
  await waitFor(() => expect(h.container.querySelector("#desktop-panel-doc-0")).toBeNull(), { timeout: 10_000 });
  // The 2s keep-draft interval may store a newer generation of the same row
  // while the dialog Save fails; Discard consumes whichever one is durable.
  const stored = h.call.mock.calls.filter(([channel]) => channel === "desktop:draft-checkpoint").map(([, request]) => (request as { generation: number }).generation);
  expect(h.call).toHaveBeenCalledWith("desktop:draft-discard", expect.objectContaining({ documentId: "doc-0", draftId: "doc-0:1:1", generation: Math.max(...stored) }));
});

it("saves all dirty documents from one window leave dialog", async () => {
  const h = harness();
  await open(0); await open(1);
  await edit("doc-0"); await edit("doc-1");
  h.leave();
  expect(await screen.findAllByRole("dialog")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: i18n.t("office.leave.save") }));
  await waitFor(() => expect(h.call).toHaveBeenCalledWith("desktop:leave-resolved", expect.objectContaining({ requestId: "leave-test", choice: "save", proceeded: true })), { timeout: 10_000 });
  expect(h.call.mock.calls.filter(([channel]) => channel === "desktop:office-save").map(([, request]) => (request as { documentId: string }).documentId)).toEqual(["doc-0", "doc-1"]);
});

it("answers a host leave immediately with Stay while retaining the existing dirty-tab dialog", async () => {
  const h = harness();
  await open(0); await edit("doc-0");
  fireEvent.keyDown(window, { key: "w", ctrlKey: true });
  const dialog = await screen.findByRole("dialog");
  h.leave();
  await waitFor(() => expect(h.call).toHaveBeenCalledWith("desktop:leave-resolved", expect.objectContaining({ requestId: "leave-test", choice: "stay", proceeded: false })));
  expect(screen.getByRole("dialog")).toBe(dialog);
  expect(h.container.querySelector("#desktop-panel-doc-0")).not.toBeNull();
  fireEvent.click(within(dialog).getAllByRole("button", { name: i18n.t("office.leave.stay") }).at(-1)!);
  expect(h.call.mock.calls.filter(([channel]) => channel === "desktop:leave-resolved")).toHaveLength(1);
});

it("answers a clean host close with Keep without discarding retained drafts", async () => {
  const h = harness();
  await open(0);
  h.leave();
  await waitFor(() => expect(h.call).toHaveBeenCalledWith("desktop:leave-resolved", expect.objectContaining({ choice: "keep", proceeded: true })));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(h.call.mock.calls.filter(([channel]) => channel === "desktop:draft-discard")).toHaveLength(0);
});

it("retains a saving tab and its session when its close shortcut is pressed", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const h = harness({ beforeSave: () => gate });
  await open(0); await edit("doc-0");
  const dispose = vi.spyOn(sessions.get("doc-0")!, "dispose");
  fireEvent.keyDown(window, { key: "s", ctrlKey: true });
  await waitFor(() => expect(h.call.mock.calls.some(([channel]) => channel === "desktop:office-save")).toBe(true));
  fireEvent.keyDown(window, { key: "w", ctrlKey: true });
  expect(screen.queryByRole("dialog")).toBeNull();
  const closeButton = screen.getByRole("button", { name: i18n.t("officeDesktop.tabs.close", { name: "Plan0.docx" }) });
  expect(closeButton).toHaveAttribute("aria-disabled", "true");
  fireEvent.click(closeButton);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(dispose).not.toHaveBeenCalled();
  await act(async () => { release(); await gate; });
  await waitFor(() => expect(closeButton).toHaveAttribute("aria-disabled", "false"));
  fireEvent.keyDown(window, { key: "w", ctrlKey: true });
  await waitFor(() => expect(h.container.querySelector("#desktop-panel-doc-0")).toBeNull());
});

it("limits documents to eight and supports cycling and numeric shortcuts", async () => {
  const h = harness();
  for (let index = 0; index < 8; index++) await open(index);
  fireEvent.keyDown(window, { key: "1", ctrlKey: true });
  expect(screen.getByRole("tab", { name: /Plan0/ })).toHaveAttribute("aria-selected", "true");
  fireEvent.keyDown(window, { key: "Tab", ctrlKey: true, shiftKey: true });
  expect(screen.getByRole("tab", { name: i18n.t("officeDesktop.tabs.library") })).toHaveAttribute("aria-selected", "true");
  fireEvent.click(screen.getAllByRole("button", { name: i18n.t("officeDesktop.library.open") })[8]!);
  expect(await screen.findByText(i18n.t("officeDesktop.tabs.limit"))).toBeInTheDocument();
  expect(h.call.mock.calls.filter(([channel]) => channel === "desktop:office-open")).toHaveLength(8);
}, 30_000);

it("unmounts every tab on an account change and preserves tabs when logout fails", async () => {
  const h = harness({ failLogout: true });
  await open(0); await open(1);
  const dispose = vi.spyOn(sessions.get("doc-0")!, "dispose");
  const accountMenu = screen.getByRole("button", { name: i18n.t("officeDesktop.tabs.account", { name: "account" }) });
  fireEvent.click(accountMenu);
  fireEvent.click(await screen.findByRole("menuitem", { name: i18n.t("officeDesktop.tabs.signOut") }));
  await screen.findByText(i18n.t("officeDesktop.library.actionError"));
  expect(h.container.querySelector("#desktop-panel-doc-0")).not.toBeNull();
  h.switchAccount();
  await waitFor(() => expect(h.container.querySelector("#desktop-panel-doc-0")).toBeNull());
  expect(dispose).toHaveBeenCalled();
});
