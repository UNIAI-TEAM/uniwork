/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import i18n from "i18next";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DesktopSessionMetadata, RecentFile } from "../shared/ipc";
import { App, type RendererBridge } from "./app";
import { bytesChecksum, docxSource, installDocxGeometry } from "../test/docx-fixture";
import { settleDocxSessions } from "../test/settle-sessions";
import { supportedFormatsLabel } from "./supported-formats";

installDocxGeometry();
const fixtureBase64 = Buffer.from(docxSource).toString("base64");

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
// Several tests end with a DOCX tab still parsing (a background recent-file tab,
// an OS open asserted only on its tab); settle every load before teardown.
afterEach(() => settleDocxSessions(sessions));

/** Every channel a signed-out device may legitimately use; anything else in a
 * local-mode test is a network path and fails the test. */
const LOCAL_CHANNELS = new Set(["desktop:auth-config", "desktop:auth-session", "desktop:local-state", "desktop:local-mode", "desktop:recent-list", "desktop:recent-open", "desktop:recent-remove", "desktop:file-pick-open", "desktop:file-create", "desktop:file-open", "desktop:file-save", "desktop:file-save-as", "desktop:draft-list", "desktop:draft-recover", "desktop:draft-discard", "desktop:draft-checkpoint", "desktop:tabs-update"]);

const checksum = bytesChecksum(docxSource);
const fileMeta = (handle: string, name = "Local.docx", extra: Record<string, unknown> = {}) => ({ handle, name, byteLength: docxSource.length, modifiedAtMs: 1_000, checksum, ...extra });
const recent = (id: string, name: string, missing = false, directory = "…\\Docs"): RecentFile => ({ id, name, directory, modifiedAtMs: 1, updatedAt: 2, missing });
const RECENT_ID = `recent_${"c".repeat(32)}`;
const MISSING_ID = `recent_${"d".repeat(32)}`;

/** What main answers for desktop:file-create, per format (main/files/blank-*.ts):
 * the blank Markdown document is zero bytes, so its data is empty. */
const BLANK_HTML_TEXT = "<!DOCTYPE html>\n<html>\n<head>\n<meta charset=\"utf-8\">\n<title></title>\n</head>\n<body>\n</body>\n</html>\n";
function created(format: string) {
  const handle = `file_${"1".repeat(32)}`;
  if (format === "docx") return { opened: true, metadata: fileMeta(handle, "Untitled.docx", { untitled: true, modifiedAtMs: 0 }), data: Uint8Array.from(Buffer.from(fixtureBase64, "base64")) };
  const bytes = format === "md" ? new Uint8Array(0) : new TextEncoder().encode(BLANK_HTML_TEXT);
  return { opened: true, metadata: { handle, name: format === "md" ? "Untitled.md" : "Untitled.html", byteLength: bytes.byteLength, modifiedAtMs: 0, checksum: bytesChecksum(bytes), untitled: true }, data: Uint8Array.from(Buffer.from(bytes)) };
}

function harness(options: { localMode?: boolean; signedIn?: boolean; files?: RecentFile[]; strict?: boolean; failAuthConfig?: boolean; recentMissing?: boolean; pick?: unknown; openName?: string; failCheckpoint?: boolean; drop?: unknown } = {}) {
  const calls: Array<{ channel: string; payload: unknown }> = [];
  const dropped: number[] = [];
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
      case "desktop:recent-open": return options.recentMissing ? { opened: false, missing: true } : { opened: true, metadata: fileMeta(`file_${"e".repeat(32)}`, "Recent.docx"), data: Uint8Array.from(Buffer.from(fixtureBase64, "base64")) };
      case "desktop:file-pick-open": return options.pick ?? { opened: true, metadata: fileMeta(`file_${"f".repeat(32)}`, "Local.docx"), data: Uint8Array.from(Buffer.from(fixtureBase64, "base64")) };
      case "desktop:file-open": return { opened: true, metadata: fileMeta(String(payload.handle), options.openName ?? "Opened.docx"), data: Uint8Array.from(Buffer.from(fixtureBase64, "base64")) };
      case "desktop:file-create": return created(String(payload.format ?? "docx"));
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
    // The durable draft write refused: the product must warn that the tab is unprotected.
    if (options.failCheckpoint && channel === "desktop:draft-checkpoint") throw new Error("draft store unavailable");
    return response(channel, (payload ?? {}) as Record<string, unknown>);
  });
  const bridge: RendererBridge = {
    call: call as RendererBridge["call"],
    onSessionChanged: (listener) => { sessionListener = listener; return () => undefined; },
    onFileOpenRequested: (listener) => { fileListener = listener; return () => undefined; },
    onLoginRequested: (listener) => { loginListener = listener; return () => undefined; },
    onLeaveRequested: (listener) => { leaveListener = listener; return () => undefined; },
    // The preload's private drop seam: main answers the same typed shape as a pick.
    openDroppedFile: async () => { dropped.push(1); if (options.drop instanceof Error) throw options.drop; return options.drop ?? response("desktop:file-pick-open", {}); },
  };
  const rendered = render(<App bridge={bridge} />);
  return {
    ...rendered,
    call,
    calls,
    channels: () => calls.map((entry) => entry.channel),
    dropCount: () => dropped.length,
    dropFile: (name = "Dropped.docx") => fireEvent.drop(rendered.container.querySelector("[aria-busy]")!, { dataTransfer: { files: [new File(["x"], name)] } }),
    emitSession: (metadata: DesktopSessionMetadata) => act(() => sessionListener?.(metadata)),
    emitFile: (handle: string) => act(() => fileListener?.({ handle })),
    hasFileListener: () => Boolean(fileListener),
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
  await session.openEditor();
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
  await waitFor(() => expect(h.hasFileListener()).toBe(true));
  h.emitFile(`file_${"a".repeat(32)}`);
  await screen.findByRole("tab", { name: /Opened\.docx/ });
  await screen.findByTestId("docx-document-surface", {}, { timeout: 10_000 });
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

it("keeps an edited local tab mounted through login cancel and success", async () => {
  const h = harness({ localMode: true });
  await enterLocal(h);
  const handle = `file_${"a".repeat(32)}`;
  await waitFor(() => expect(h.hasFileListener()).toBe(true));
  h.emitFile(handle);
  await screen.findByRole("tab", { name: /Opened\.docx/ });
  await screen.findByTestId("docx-document-surface", {}, { timeout: 10_000 });
  await edit(handle);
  const session = sessions.get(handle)!;

  // Cancelling sign-in must reveal the same live editor, not a disposed tab.
  h.emitLoginRequest();
  await waitFor(() => expect(h.container.querySelector("[data-login-state='login-required']")).not.toBeNull());
  expect(session.isDisposed).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: i18n.t("officeDesktop.login.useLocal") }));
  await waitFor(() => expect(h.container.querySelector('[data-local-home="true"]')).not.toBeNull());
  expect(session.isDisposed).toBe(false);
  expect(screen.getByTestId("docx-document-surface")).toBeInTheDocument();

  // A successful account handoff must preserve the same editor session too.
  h.emitLoginRequest();
  await waitFor(() => expect(h.container.querySelector("[data-login-state='login-required']")).not.toBeNull());
  h.emitSession({ status: "signed-in", accountId: "account-1", deploymentId: "lane" });
  await screen.findByRole("tab", { name: i18n.t("officeDesktop.tabs.library") });
  expect(session.isDisposed).toBe(false);
  expect(screen.getByTestId("docx-document-surface")).toBeInTheDocument();
  fireEvent.keyDown(window, { key: "s", ctrlKey: true });
  await waitFor(() => expect(h.call).toHaveBeenCalledWith("desktop:file-save", expect.objectContaining({ handle })));
  const accountDraftReads = h.calls.filter(({ channel, payload }) => channel === "desktop:draft-list" && !Object.prototype.hasOwnProperty.call(payload as object, "documentId"));
  expect(accountDraftReads.length).toBeGreaterThan(0);
});

/** The menu trigger renders only after the DOCX surface has parsed, which a loaded runner can delay past the default window. */
async function openDocumentMenu() {
  await screen.findByTestId("docx-document-surface", {}, { timeout: 10_000 });
  await waitFor(() => expect(document.querySelector("[data-office-document-menu]")).not.toBeNull());
  fireEvent.click(document.querySelector("[data-office-document-menu]")!);
}

it("keeps the AI entry locked and never calls a cloud channel from it", async () => {
  const h = harness({ localMode: true });
  await enterLocal(h);
  fireEvent.click(screen.getByRole("button", { name: i18n.t("officeDesktop.local.open") }));
  await screen.findByRole("tab", { name: /Local\.docx/ });
  const before = h.channels().length;
  await openDocumentMenu();
  fireEvent.click(await screen.findByRole("button", { name: i18n.t("officeDesktop.ai.entry") }));
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
  await openDocumentMenu();
  fireEvent.click(await screen.findByRole("menuitem", { name: new RegExp(i18n.t("officeDesktop.local.saveAs")) }));
  await waitFor(() => expect(h.call).toHaveBeenCalledWith("desktop:file-save-as", expect.objectContaining({ handle })));
  await screen.findByRole("tab", { name: /copy\.docx/ });
  expect(screen.queryByRole("tab", { name: /Local\.docx/ })).toBeNull();
});

it("keeps the protection warning visible while the sign-in card is shown", async () => {
  const h = harness({ localMode: true, failCheckpoint: true });
  await enterLocal(h);
  fireEvent.click(screen.getByRole("button", { name: i18n.t("officeDesktop.local.open") }));
  await screen.findByRole("tab", { name: /Local\.docx/ });
  await edit(`file_${"f".repeat(32)}`);
  await waitFor(() => expect(screen.getByText(i18n.t("officeDesktop.tabs.checkpointFailedNamed", { titles: "Local.docx" }))).toBeInTheDocument(), { timeout: 20_000 });
  fireEvent.click(screen.getByRole("button", { name: i18n.t("officeDesktop.tabs.signIn") }));
  await waitFor(() => expect(h.container.querySelector("[data-login-state]")).not.toBeNull());
  expect(screen.getByText(i18n.t("officeDesktop.tabs.checkpointFailedNamed", { titles: "Local.docx" }))).toBeInTheDocument();
});

it("treats a checkpoint overtaken by a newer edit as retry-next-tick, not as a protection failure (UNI-956)", async () => {
  const h = harness({ localMode: true });
  await enterLocal(h);
  fireEvent.click(screen.getByRole("button", { name: i18n.t("officeDesktop.local.open") }));
  await screen.findByRole("tab", { name: /Local.docx/ });
  const handle = `file_${"f".repeat(32)}`;
  await edit(handle);
  // Every capture lands one generation behind: the user is still typing.
  const session = sessions.get(handle)!;
  const capture = vi.mocked(session.editor.captureSnapshot).getMockImplementation()!;
  const behind = vi.spyOn(session.editor, "captureSnapshot").mockImplementation(async () => { const snapshot = await capture(); return { ...snapshot, generation: snapshot.generation - 1 }; });
  await waitFor(() => expect(behind.mock.calls.length).toBeGreaterThanOrEqual(2), { timeout: 20_000 });
  expect(screen.queryByText(i18n.t("officeDesktop.tabs.checkpointFailedNamed", { titles: "Local.docx" }))).toBeNull();
  expect(h.call).not.toHaveBeenCalledWith("desktop:draft-checkpoint", expect.anything());
  // The typing stops: the next tick stores the draft (this harness answers no draft row by default).
  const answer = h.call.getMockImplementation()!;
  h.call.mockImplementation(async (channel: string, payload?: unknown) => channel === "desktop:draft-checkpoint" ? { stored: true, generation: (payload as { generation: number }).generation } : answer(channel, payload));
  behind.mockImplementation(capture);
  await waitFor(() => expect(h.call).toHaveBeenCalledWith("desktop:draft-checkpoint", expect.objectContaining({ documentId: handle })), { timeout: 20_000 });
  expect(screen.queryByText(i18n.t("officeDesktop.tabs.checkpointFailedNamed", { titles: "Local.docx" }))).toBeNull();
}, 60_000);

it("clears the protective-checkpoint warning once a local save is confirmed", async () => {
  const h = harness({ localMode: true, failCheckpoint: true });
  await enterLocal(h);
  fireEvent.click(screen.getByRole("button", { name: i18n.t("officeDesktop.local.open") }));
  await screen.findByRole("tab", { name: /Local\.docx/ });
  await edit(`file_${"f".repeat(32)}`);
  // The 2 s checkpoint tick reports a dirty local file with no durable row.
  await waitFor(() => expect(screen.getByText(i18n.t("officeDesktop.tabs.checkpointFailedNamed", { titles: "Local.docx" }))).toBeInTheDocument(), { timeout: 20_000 });
  fireEvent.keyDown(window, { key: "s", ctrlKey: true });
  await waitFor(() => expect(h.call).toHaveBeenCalledWith("desktop:file-save", expect.anything()));
  await waitFor(() => expect(screen.queryByText(i18n.t("officeDesktop.tabs.checkpointFailedNamed", { titles: "Local.docx" }))).toBeNull());
});

const openCreateMenu = async (label: string) => {
  await screen.findByRole("status"); // the empty state replaces the loading header, so the menu must open after it
  fireEvent.click(screen.getByRole("button", { name: i18n.t("officeDesktop.local.create") }));
  fireEvent.click(await screen.findByRole("menuitem", { name: new RegExp(i18n.t(label)) }));
};

it("offers DOCX, Markdown and HTML from the local home and sends the chosen format", async () => {
  const h = harness({ localMode: true });
  await enterLocal(h);
  await screen.findByRole("status");
  fireEvent.click(screen.getByRole("button", { name: i18n.t("officeDesktop.local.create") }));
  expect((await screen.findAllByRole("menuitem")).map((item) => item.textContent)).toEqual([i18n.t("officeDesktop.tabs.createDocx"), i18n.t("officeDesktop.tabs.createMarkdown"), i18n.t("officeDesktop.tabs.createHtml")]);
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  await openCreateMenu("officeDesktop.tabs.createMarkdown");
  await waitFor(() => expect(h.call).toHaveBeenCalledWith("desktop:file-create", expect.objectContaining({ format: "md" })));
});

it("creates HTML from the tab strip plus menu", async () => {
  const h = harness({ localMode: true });
  await enterLocal(h);
  await screen.findByRole("status");
  fireEvent.click(screen.getByRole("button", { name: i18n.t("officeDesktop.tabs.newTab") }));
  fireEvent.click(await screen.findByRole("menuitem", { name: new RegExp(i18n.t("officeDesktop.tabs.createHtml")) }));
  await waitFor(() => expect(h.call).toHaveBeenCalledWith("desktop:file-create", expect.objectContaining({ format: "html" })));
});

it.each([
  ["md", "officeDesktop.tabs.createMarkdown", "officeDesktop.local.untitledMarkdown"],
  ["html", "officeDesktop.tabs.createHtml", "officeDesktop.local.untitledHtml"],
] as const)("opens the blank %s document main creates as a tab, with no action error", async (format, label, title) => {
  const h = harness({ localMode: true });
  await enterLocal(h);
  await openCreateMenu(label);
  await waitFor(() => expect(h.call).toHaveBeenCalledWith("desktop:file-create", expect.objectContaining({ format })));
  await screen.findByRole("tab", { name: new RegExp(i18n.t(title).replace(".", String.raw`\.`)) });
  expect(screen.queryByText(i18n.t("officeDesktop.library.actionError"))).toBeNull();
});

it("opens an existing empty Markdown file without treating its payload as missing", async () => {
  const handle = `file_${"e".repeat(32)}`;
  const h = harness({ localMode: true, pick: { opened: true, metadata: { handle, name: "Empty.md", byteLength: 0, modifiedAtMs: 1, checksum: bytesChecksum(new Uint8Array(0)) }, data: Uint8Array.from(Buffer.from("", "base64")) } });
  await enterLocal(h);
  fireEvent.click(screen.getByRole("button", { name: i18n.t("officeDesktop.local.open") }));
  await screen.findByRole("tab", { name: /Empty\.md/ });
  expect(screen.queryByText(i18n.t("officeDesktop.library.actionError"))).toBeNull();
});

it("shows a dismissible unsupported alert for a .txt pick and opens no tab", async () => {
  const h = harness({ localMode: true, pick: { opened: false, unsupported: true } });
  await enterLocal(h);
  fireEvent.click(screen.getByRole("button", { name: i18n.t("officeDesktop.local.open") }));
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent(i18n.t("officeDesktop.local.unsupported", { formats: supportedFormatsLabel(i18n.language) }));
  expect(screen.queryAllByRole("tab")).toHaveLength(1);
  fireEvent.click(within(alert).getByRole("button", { name: i18n.t("officeDesktop.tabs.dismissAlert") }));
  expect(screen.queryByRole("alert")).toBeNull();
});

it("opens a dropped file as a tab through the native drop seam", async () => {
  const h = harness({ localMode: true, drop: { opened: true, metadata: fileMeta(`file_${"8".repeat(32)}`, "Dropped.docx"), data: Uint8Array.from(Buffer.from(fixtureBase64, "base64")) } });
  await enterLocal(h);
  h.dropFile();
  await screen.findByRole("tab", { name: /Dropped.docx/ });
  expect(h.dropCount()).toBe(1);
  expect(screen.queryByRole("alert")).toBeNull();
});

it.each([
  ["a locked file", { opened: false, code: "file_locked" }, () => i18n.t("office.save.reason.file_locked")],
  ["a file too big for this computer's memory", { opened: false, code: "file_insufficient_memory" }, () => i18n.t("office.save.reason.file_insufficient_memory")],
  ["a linked file", { opened: false, code: "file_access_denied" }, () => i18n.t("office.save.reason.file_access_denied")],
  ["an unsupported format", { opened: false, unsupported: true }, () => i18n.t("officeDesktop.local.unsupported", { formats: supportedFormatsLabel(i18n.language) })],
  ["a code from a newer main", { opened: false, code: "file_from_a_newer_main" }, () => i18n.t("officeDesktop.library.actionError")],
  ["a transport failure", new Error("boom"), () => i18n.t("officeDesktop.library.actionError")],
])("says why a dropped file was refused: %s", async (_label, drop, expected) => {
  const h = harness({ localMode: true, drop });
  await enterLocal(h);
  h.dropFile();
  expect(await screen.findByRole("alert")).toHaveTextContent(expected());
  expect(screen.queryAllByRole("tab")).toHaveLength(1);
});

it.each([
  ["file_locked", () => i18n.t("office.save.reason.file_locked")],
  ["file_from_a_newer_main", () => i18n.t("officeDesktop.library.actionError")],
])("names a refused pick by its code %s, or falls back to the generic copy", async (code, expected) => {
  const h = harness({ localMode: true, pick: { opened: false, code } });
  await enterLocal(h);
  fireEvent.click(screen.getByRole("button", { name: i18n.t("officeDesktop.local.open") }));
  expect(await screen.findByRole("alert")).toHaveTextContent(expected());
  expect(screen.queryAllByRole("tab")).toHaveLength(1);
});

it("rejects an opened file whose extension is outside the format table", async () => {
  const h = harness({ localMode: true, pick: { opened: true, metadata: fileMeta(`file_${"9".repeat(32)}`, "page.xhtml"), data: Uint8Array.from(Buffer.from("AAAA", "base64")) } });
  await enterLocal(h);
  fireEvent.click(screen.getByRole("button", { name: i18n.t("officeDesktop.local.open") }));
  expect(await screen.findByRole("alert")).toHaveTextContent(i18n.t("officeDesktop.local.unsupported", { formats: supportedFormatsLabel(i18n.language) }));
  expect(screen.queryAllByRole("tab")).toHaveLength(1);
});

it.each(["Notes.md", "Page.html"])("opens a %s handed over by the OS as a tab", async (name) => {
  const h = harness({ localMode: true, openName: name });
  await enterLocal(h);
  await waitFor(() => expect(h.hasFileListener()).toBe(true));
  await h.emitFile(`file_${"7".repeat(32)}`);
  await screen.findByRole("tab", { name: new RegExp(name.replace(".", String.raw`\.`)) });
  expect(h.call).toHaveBeenCalledWith("desktop:file-open", expect.objectContaining({ handle: `file_${"7".repeat(32)}` }));
});

it("creates a new local document and writes it through Save As", async () => {
  const h = harness({ localMode: true });
  await enterLocal(h);
  await openCreateMenu("officeDesktop.tabs.createDocx");
  await waitFor(() => expect(h.call).toHaveBeenCalledWith("desktop:file-create", expect.anything()));
  await screen.findByRole("tab", { name: /Tài liệu mới\.docx/ });
  await screen.findByTestId("docx-document-surface", {}, { timeout: 10_000 });
  await edit(`file_${"1".repeat(32)}`);
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
  await waitFor(() => expect(h.container.querySelector('[data-session-status="signed-in"]')).not.toBeNull());
  fireEvent.click(screen.getByRole("button", { name: new RegExp(i18n.t("officeDesktop.tabs.account", { name: "Me" })) }));
  fireEvent.click(await screen.findByRole("menuitem", { name: new RegExp(i18n.t("officeDesktop.tabs.switchWorkspace")) }));
  await waitFor(() => {
    expect(h.container.querySelector('[data-session-status="signed-in"]')).not.toBeNull();
    expect(screen.getByRole("tab", { name: /Opened\.docx/ })).toBeInTheDocument();
  });
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
