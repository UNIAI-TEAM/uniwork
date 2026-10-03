/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import i18n from "i18next";
import { beforeEach, expect, it, vi } from "vitest";
import type { DesktopSessionMetadata, RecentFile } from "../shared/ipc";
import { App, type RendererBridge } from "./app";

const sessions = vi.hoisted(() => new Map<string, import("./office/session").ByteDocumentSession>());
vi.mock("./office/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./office/session")>();
  return { ...actual, createByteDocumentSession: (...args: Parameters<typeof actual.createByteDocumentSession>) => {
    const session = actual.createByteDocumentSession(...args);
    sessions.set(args[1].documentId, session);
    return session;
  } };
});
beforeEach(() => sessions.clear());

/** Every channel a signed-out device may legitimately use; anything else in a
 * local-mode test is a network path and fails the test. */
const LOCAL_CHANNELS = new Set(["desktop:auth-config", "desktop:auth-session", "desktop:local-state", "desktop:local-mode", "desktop:recent-list", "desktop:recent-open", "desktop:recent-remove", "desktop:file-pick-open", "desktop:file-create", "desktop:file-open", "desktop:file-save", "desktop:file-save-as", "desktop:draft-list", "desktop:draft-recover", "desktop:draft-discard", "desktop:draft-checkpoint", "desktop:tabs-update"]);

const checksum = `sha256:${"a".repeat(64)}`;
const fileMeta = (handle: string, name = "Local.docx", extra: Record<string, unknown> = {}) => ({ handle, name, byteLength: 5, modifiedAtMs: 1_000, checksum, ...extra });
const recent = (id: string, name: string, missing = false, directory = "…\\Docs"): RecentFile => ({ id, name, directory, modifiedAtMs: 1, updatedAt: 2, missing });
const RECENT_ID = `recent_${"c".repeat(32)}`;
const MISSING_ID = `recent_${"d".repeat(32)}`;

function harness(options: { localMode?: boolean; signedIn?: boolean; files?: RecentFile[]; strict?: boolean; failAuthConfig?: boolean; recentMissing?: boolean } = {}) {
  const calls: Array<{ channel: string; payload: unknown }> = [];
  let sessionListener: ((metadata: DesktopSessionMetadata) => void) | undefined;
  let fileListener: ((event: { handle: string }) => void) | undefined;
  let loginListener: ((event: { reason: "signed_out" | "deployment_mismatch" | "account_mismatch" }) => void) | undefined;
  let leaveListener: ((event: { requestId: string; reason: "close" | "logout" | "update" }) => void) | undefined;
  const response: (channel: string, payload: Record<string, unknown>) => unknown = (channel, payload) => {
    switch (channel) {
      case "desktop:auth-config": return { clientId: "uniwork-office-dev", deploymentId: "lane" };
      case "desktop:auth-session": return options.signedIn ? { status: "signed-in", accountId: "account-1", deploymentId: "lane" } : { status: "signed-out" };
      case "desktop:local-state": return { localMode: options.localMode === true };
      case "desktop:local-mode": return { localMode: payload.local };
      case "desktop:auth-logout": return { status: "signed-out" };
      case "desktop:library-context": return { deployments: [{ id: "lane", name: "Server" }], accounts: [{ id: "account-1", name: "Me" }], organizations: [{ id: "org-1", name: "Acme" }], workspaces: [{ id: "ws-1", name: "Team" }] };
      case "desktop:library-list": return { documents: [], nextCursor: null, engineAvailable: true };
      case "desktop:recent-list": return { files: options.files ?? [] };
      case "desktop:recent-remove": return { removed: true };
      case "desktop:recent-open": return options.recentMissing ? { opened: false, missing: true } : { opened: true, metadata: fileMeta(`file_${"e".repeat(32)}`, "Recent.docx"), dataBase64: "aGVsbG8=" };
      case "desktop:file-pick-open": return { opened: true, metadata: fileMeta(`file_${"f".repeat(32)}`, "Local.docx"), dataBase64: "aGVsbG8=" };
      case "desktop:file-open": return { opened: true, metadata: fileMeta(String(payload.handle), "Opened.docx"), dataBase64: "aGVsbG8=" };
      case "desktop:file-create": return { opened: true, metadata: fileMeta(`file_${"1".repeat(32)}`, "Untitled.docx", { untitled: true, modifiedAtMs: 0 }), dataBase64: "aGVsbG8=" };
      case "desktop:file-save": return { opened: true, metadata: fileMeta(String(payload.handle)) };
      case "desktop:file-save-as": return { opened: true, metadata: fileMeta(`file_${"2".repeat(32)}`, "copy.docx") };
      case "desktop:tabs-update": return { updated: true };
      case "desktop:draft-list": return { drafts: [] };
      default: return {};
    }
  };
  const call = vi.fn(async (channel: string, payload: unknown) => {
    calls.push({ channel, payload });
    if (options.strict && !LOCAL_CHANNELS.has(channel)) throw new Error(`unexpected network channel ${channel}`);
    if (options.failAuthConfig && channel === "desktop:auth-config") throw new Error("no transport");
    return response(channel, (payload ?? {}) as Record<string, unknown>);
  });
  const bridge: RendererBridge = {
    call: call as RendererBridge["call"],
    onSessionChanged: (listener) => { sessionListener = listener; return () => undefined; },
    onFileOpenRequested: (listener) => { fileListener = listener; return () => undefined; },
    onLoginRequested: (listener) => { loginListener = listener; return () => undefined; },
    onLeaveRequested: (listener) => { leaveListener = listener; return () => undefined; },
  };
  const rendered = render(<App bridge={bridge} />);
  return {
    ...rendered,
    call,
    calls,
    channels: () => calls.map((entry) => entry.channel),
    emitSession: (metadata: DesktopSessionMetadata) => act(() => sessionListener?.(metadata)),
    emitFile: (handle: string) => act(() => fileListener?.({ handle })),
    emitLoginRequest: () => act(() => loginListener?.({ reason: "signed_out" })),
    emitLeave: (reason: "close" | "logout" | "update" = "close") => act(() => leaveListener?.({ requestId: "leave-r5", reason })),
  };
}

async function enterLocal(h: ReturnType<typeof harness>) {
  // With the boot gate the first paint is settled init: a remembered-local
  // device is already on the local home, a first run shows the sign-in card.
  await waitFor(() => expect(h.container.querySelector('[data-local-home="true"]') ?? screen.queryByRole("button", { name: i18n.t("officeDesktop.login.useLocal") })).not.toBeNull());
  if (h.container.querySelector('[data-local-home="true"]')) return;
  fireEvent.click(screen.getByRole("button", { name: i18n.t("officeDesktop.login.useLocal") }));
  await waitFor(() => expect(h.container.querySelector('[data-local-home="true"]')).not.toBeNull());
}

/** Simulate an engine edit that keeps producing new dirty generations, so a
 * later Save (or Save As) still sees a matching snapshot. */
async function edit(id: string) {
  const session = sessions.get(id)!;
  let generation = 1;
  const capture = session.editor.captureSnapshot.bind(session.editor);
  vi.spyOn(session.editor, "getDirtyGeneration").mockImplementation(() => generation);
  vi.spyOn(session.editor, "captureSnapshot").mockImplementation(async () => ({ ...(await capture()), generation }));
  act(() => session.coordinator.markDirty(generation));
  return { bump: () => { generation += 1; act(() => session.coordinator.markDirty(generation)); } };
}

it("offers the local choices on the first run and remembers the device mode", async () => {
  const h = harness();
  await screen.findByText(i18n.t("officeDesktop.login.localNote"));
  expect(h.container.querySelector("[data-login-state='signed-out']")).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: i18n.t("officeDesktop.login.useLocal") }));
  await screen.findByText(i18n.t("officeDesktop.local.empty"));
  await waitFor(() => expect(h.call).toHaveBeenCalledWith("desktop:local-mode", expect.objectContaining({ local: true })));
  expect(screen.getByRole("tab", { name: i18n.t("officeDesktop.tabs.local") })).toBeInTheDocument();
  expect(screen.queryByRole("tab", { name: i18n.t("officeDesktop.tabs.library") })).toBeNull();
});

it("opens the local home directly when the device chose it last time", async () => {
  const h = harness({ localMode: true });
  await screen.findByText(i18n.t("officeDesktop.local.empty"));
  expect(h.container.querySelector("[data-login-state]")).toBeNull();
  expect(screen.getByRole("button", { name: i18n.t("officeDesktop.tabs.signIn") })).toBeInTheDocument();
  expect(h.call).toHaveBeenCalledWith("desktop:local-state", expect.objectContaining({ sessionGeneration: expect.any(String) }));
});

it("opens the local home on relaunch even when auth-config is unavailable (no deployment profile)", async () => {
  const h = harness({ localMode: true, failAuthConfig: true });
  await waitFor(() => expect(h.container.querySelector('[data-local-home="true"]')).not.toBeNull());
  expect(h.container.querySelector("[data-login-state]")).toBeNull();
  expect(screen.getByRole("button", { name: i18n.t("officeDesktop.tabs.signIn") })).toBeInTheDocument();
});

it("lists recent files, opens one, and removes a missing file from the list", async () => {
  const h = harness({ files: [recent(RECENT_ID, "Plan.docx"), recent(MISSING_ID, "Gone.docx", true)] });
  await enterLocal(h);
  expect(screen.getByText("Plan.docx")).toBeInTheDocument();
  expect(screen.getByText("Gone.docx")).toBeInTheDocument();
  expect(screen.getByText(i18n.t("officeDesktop.local.missing"))).toBeInTheDocument();
  const missingRow = screen.getByText("Gone.docx").closest("li")!;
  expect(within(missingRow).getByRole("button", { name: i18n.t("officeDesktop.local.openNamed", { name: "Gone.docx" }) })).toBeDisabled();
  fireEvent.click(within(missingRow).getByRole("button", { name: i18n.t("officeDesktop.local.removeNamed", { name: "Gone.docx" }) }));
  await waitFor(() => expect(h.call).toHaveBeenCalledWith("desktop:recent-remove", expect.objectContaining({ id: MISSING_ID })));
  fireEvent.click(screen.getByRole("button", { name: i18n.t("officeDesktop.local.openNamed", { name: "Plan.docx" }) }));
  await waitFor(() => expect(h.call).toHaveBeenCalledWith("desktop:recent-open", expect.objectContaining({ id: RECENT_ID })));
  expect(await screen.findByRole("tab", { name: /Recent\.docx/ })).toBeInTheDocument();
  expect(h.container.querySelector('[data-local-home="true"]')).not.toBeNull();
});

it("opens a .docx from the OS while signed out straight into the local mode", async () => {
  const h = harness();
  await screen.findByText(i18n.t("officeDesktop.login.localNote"));
  h.emitFile(`file_${"a".repeat(32)}`);
  await screen.findByRole("tab", { name: /Opened\.docx/ });
  expect(h.call).toHaveBeenCalledWith("desktop:local-mode", expect.objectContaining({ local: true }));
  expect(h.call).toHaveBeenCalledWith("desktop:file-open", expect.objectContaining({ handle: `file_${"a".repeat(32)}` }));
});

it("asks for sign-in on a web deep link and keeps local tabs when the user cancels", async () => {
  const h = harness({ localMode: true });
  await enterLocal(h);
  fireEvent.click(screen.getByRole("button", { name: i18n.t("officeDesktop.local.open") }));
  await screen.findByRole("tab", { name: /Local\.docx/ });
  h.emitLoginRequest();
  await waitFor(() => expect(h.container.querySelector("[data-login-state='login-required']")).not.toBeNull());
  expect(screen.getByText(i18n.t("officeDesktop.login.required"))).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: i18n.t("officeDesktop.login.useLocal") }));
  await waitFor(() => expect(h.container.querySelector("[data-login-state]")).toBeNull());
  expect(screen.getByRole("tab", { name: /Local\.docx/ })).toBeInTheDocument();
  expect(h.channels()).not.toContain("desktop:office-open");
});

it("keeps local tabs when signing in and closes only cloud tabs when signing out", async () => {
  const h = harness({ localMode: true });
  await enterLocal(h);
  h.emitFile(`file_${"a".repeat(32)}`);
  await screen.findByRole("tab", { name: /Opened\.docx/ });
  h.emitSession({ status: "signed-in", accountId: "account-1", deploymentId: "lane" });
  await screen.findByRole("tab", { name: i18n.t("officeDesktop.tabs.library") });
  expect(screen.getByRole("tab", { name: /Opened\.docx/ })).toBeInTheDocument();
  expect(h.call.mock.calls.filter(([channel]) => channel === "desktop:file-open")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`${i18n.t("officeDesktop.tabs.account", { name: "Me" })}`) }));
  fireEvent.click(await screen.findByRole("menuitem", { name: i18n.t("officeDesktop.tabs.signOut") }));
  await waitFor(() => expect(h.call).toHaveBeenCalledWith("desktop:auth-logout", expect.objectContaining({ scope: "device" })));
  await waitFor(() => expect(h.container.querySelector('[data-local-home="true"]')).not.toBeNull());
  expect(screen.getByRole("tab", { name: /Opened\.docx/ })).toBeInTheDocument();
});

it("keeps the AI entry locked and never calls a cloud channel from it", async () => {
  const h = harness({ localMode: true });
  await enterLocal(h);
  fireEvent.click(screen.getByRole("button", { name: i18n.t("officeDesktop.local.open") }));
  await screen.findByRole("tab", { name: /Local\.docx/ });
  const before = h.channels().length;
  fireEvent.click(screen.getByRole("button", { name: i18n.t("officeDesktop.ai.entry") }));
  const prompt = await screen.findByRole("dialog");
  expect(within(prompt).getByText(i18n.t("officeDesktop.ai.title"))).toBeInTheDocument();
  fireEvent.click(within(prompt).getByRole("button", { name: i18n.t("officeDesktop.ai.signIn") }));
  await waitFor(() => expect(h.container.querySelector("[data-login-state='login-required']")).not.toBeNull());
  const after = h.channels().slice(before);
  expect(after.every((channel) => LOCAL_CHANNELS.has(channel))).toBe(true);
  expect(after.some((channel) => channel.startsWith("desktop:office-") || channel.startsWith("desktop:library-"))).toBe(false);
});

it("saves a local file, then Save As rebinds the tab to the new handle", async () => {
  const h = harness({ localMode: true });
  await enterLocal(h);
  fireEvent.click(screen.getByRole("button", { name: i18n.t("officeDesktop.local.open") }));
  const handle = `file_${"f".repeat(32)}`;
  await screen.findByRole("tab", { name: /Local\.docx/ });
  const editor = await edit(handle);
  fireEvent.keyDown(window, { key: "s", ctrlKey: true });
  await waitFor(() => expect(h.call).toHaveBeenCalledWith("desktop:file-save", expect.objectContaining({ handle })));
  editor.bump();
  fireEvent.click(screen.getByRole("button", { name: i18n.t("officeDesktop.local.saveAs") }));
  await waitFor(() => expect(h.call).toHaveBeenCalledWith("desktop:file-save-as", expect.objectContaining({ handle })));
  await screen.findByRole("tab", { name: /copy\.docx/ });
  expect(screen.queryByRole("tab", { name: /Local\.docx/ })).toBeNull();
});

it("keeps the protection warning visible while the sign-in card is shown", async () => {
  const h = harness({ localMode: true });
  await enterLocal(h);
  fireEvent.click(screen.getByRole("button", { name: i18n.t("officeDesktop.local.open") }));
  await screen.findByRole("tab", { name: /Local\.docx/ });
  await edit(`file_${"f".repeat(32)}`);
  await waitFor(() => expect(screen.getByText(i18n.t("officeDesktop.tabs.checkpointFailed"))).toBeInTheDocument(), { timeout: 5_000 });
  fireEvent.click(screen.getByRole("button", { name: i18n.t("officeDesktop.tabs.signIn") }));
  await waitFor(() => expect(h.container.querySelector("[data-login-state]")).not.toBeNull());
  expect(screen.getByText(i18n.t("officeDesktop.tabs.checkpointFailed"))).toBeInTheDocument();
});

it("clears the protective-checkpoint warning once a local save is confirmed", async () => {
  const h = harness({ localMode: true });
  await enterLocal(h);
  fireEvent.click(screen.getByRole("button", { name: i18n.t("officeDesktop.local.open") }));
  await screen.findByRole("tab", { name: /Local\.docx/ });
  await edit(`file_${"f".repeat(32)}`);
  // The 2 s checkpoint tick reports a dirty local file with no durable row.
  await waitFor(() => expect(screen.getByText(i18n.t("officeDesktop.tabs.checkpointFailed"))).toBeInTheDocument(), { timeout: 5_000 });
  fireEvent.keyDown(window, { key: "s", ctrlKey: true });
  await waitFor(() => expect(h.call).toHaveBeenCalledWith("desktop:file-save", expect.anything()));
  await waitFor(() => expect(screen.queryByText(i18n.t("officeDesktop.tabs.checkpointFailed"))).toBeNull());
});

it("creates a new local document and writes it through Save As", async () => {
  const h = harness({ localMode: true });
  await enterLocal(h);
  fireEvent.click(screen.getByRole("button", { name: i18n.t("officeDesktop.local.create") }));
  await waitFor(() => expect(h.call).toHaveBeenCalledWith("desktop:file-create", expect.anything()));
  await screen.findByRole("tab", { name: /Tài liệu mới\.docx/ });
  fireEvent.keyDown(window, { key: "s", ctrlKey: true });
  await waitFor(() => expect(h.call).toHaveBeenCalledWith("desktop:file-save-as", expect.objectContaining({ handle: `file_${"1".repeat(32)}` })));
  expect(h.channels()).not.toContain("desktop:file-save");
});

it("shows the missing copy when a recent file vanished before the click", async () => {
  const h = harness({ localMode: true, files: [recent(RECENT_ID, "Plan.docx")], recentMissing: true });
  await enterLocal(h);
  await screen.findByText("Plan.docx");
  fireEvent.click(screen.getByRole("button", { name: i18n.t("officeDesktop.local.openNamed", { name: "Plan.docx" }) }));
  await waitFor(() => expect(screen.getByText(i18n.t("officeDesktop.local.missing"))).toBeInTheDocument());
  expect(screen.queryByText(i18n.t("officeDesktop.library.actionError"))).toBeNull();
});

it("does not fetch the scope draft offer while signed out", async () => {
  const h = harness({ localMode: true });
  await enterLocal(h);
  expect(h.channels()).not.toContain("desktop:draft-list");
});

it("keeps the leave dialog reachable while the sign-in card is shown", async () => {
  const h = harness({ localMode: true });
  await enterLocal(h);
  fireEvent.click(screen.getByRole("button", { name: i18n.t("officeDesktop.local.open") }));
  await screen.findByRole("tab", { name: /Local\.docx/ });
  await edit(`file_${"f".repeat(32)}`);
  fireEvent.click(screen.getByRole("button", { name: i18n.t("officeDesktop.tabs.signIn") }));
  await waitFor(() => expect(h.container.querySelector("[data-login-state]")).not.toBeNull());
  h.emitLeave("close");
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText(i18n.t("office.leave.title"))).toBeInTheDocument();
  // A device-local leave set saves to the machine, not the UniWork library.
  expect(within(dialog).getByRole("button", { name: i18n.t("officeDesktop.local.leaveSave") })).toBeInTheDocument();
  expect(within(dialog).queryByRole("button", { name: i18n.t("office.leave.save") })).toBeNull();
  fireEvent.click(within(dialog).getAllByRole("button", { name: i18n.t("office.leave.stay") })[0]!);
  await waitFor(() => expect(h.call).toHaveBeenCalledWith("desktop:leave-resolved", expect.objectContaining({ requestId: "leave-r5", choice: "stay", proceeded: false })));
  fireEvent.click(screen.getByRole("button", { name: i18n.t("officeDesktop.login.useLocal") }));
  await waitFor(() => expect(h.container.querySelector('[data-local-home="true"]')).not.toBeNull());
  expect(screen.getByRole("tab", { name: /Local\.docx/ })).toBeInTheDocument();
});

it("keeps local tabs on a workspace switch", async () => {
  const h = harness({ localMode: true });
  await enterLocal(h);
  h.emitFile(`file_${"a".repeat(32)}`);
  await screen.findByRole("tab", { name: /Opened\.docx/ });
  h.emitSession({ status: "signed-in", accountId: "account-1", deploymentId: "lane" });
  await screen.findByRole("tab", { name: i18n.t("officeDesktop.tabs.library") });
  fireEvent.click(screen.getByRole("button", { name: new RegExp(i18n.t("officeDesktop.tabs.account", { name: "Me" })) }));
  fireEvent.click(await screen.findByRole("menuitem", { name: i18n.t("officeDesktop.tabs.switchWorkspace") }));
  await waitFor(() => expect(screen.getByRole("tab", { name: /Opened\.docx/ })).toBeInTheDocument());
});

it("serves every local-mode flow with a bridge that refuses any cloud channel", async () => {
  const h = harness({ localMode: true, files: [recent(RECENT_ID, "Plan.docx")], strict: true });
  await enterLocal(h);
  fireEvent.click(screen.getByRole("button", { name: i18n.t("officeDesktop.local.open") }));
  await screen.findByRole("tab", { name: /Local\.docx/ });
  await edit(`file_${"f".repeat(32)}`);
  fireEvent.keyDown(window, { key: "s", ctrlKey: true });
  await waitFor(() => expect(h.call).toHaveBeenCalledWith("desktop:file-save", expect.anything()));
  fireEvent.click(screen.getByRole("tab", { name: i18n.t("officeDesktop.tabs.local") }));
  fireEvent.click(screen.getByRole("button", { name: i18n.t("officeDesktop.local.openNamed", { name: "Plan.docx" }) }));
  await waitFor(() => expect(h.call).toHaveBeenCalledWith("desktop:recent-open", expect.anything()));
  expect(h.channels().every((channel) => LOCAL_CHANNELS.has(channel))).toBe(true);
  expect(h.channels()).not.toContain("desktop:library-context");
});
