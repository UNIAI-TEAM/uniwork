/** @vitest-environment jsdom */
import { act, render, screen, waitFor } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import i18n from "i18next";
import { expect, it, vi } from "vitest";
import { setLocale } from "@uniwork/core/i18n";
import type { DesktopSessionMetadata } from "../shared/ipc";
import { App, type RendererBridge } from "./app";
import { bytesChecksum, docxSource, installDocxGeometry } from "../test/docx-fixture";

installDocxGeometry();
const fixtureBase64 = Buffer.from(docxSource).toString("base64");

function makeBridge(call: RendererBridge["call"]): { bridge: RendererBridge; emit: (metadata: DesktopSessionMetadata) => void } {
  let listener: ((metadata: DesktopSessionMetadata) => void) | undefined;
  const bridge: RendererBridge = {
    call: ((channel, payload) => channel === "desktop:tabs-update" ? Promise.resolve({ updated: true }) : call(channel, payload)) as RendererBridge["call"],
    onSessionChanged: (next) => { listener = next; return () => undefined; },
  };
  return { bridge, emit: (metadata) => listener?.(metadata) };
}

/** Base UI's overflow trigger opens on click, but on a loaded runner the ribbon
 * can re-render between findByRole and the click (the DOCX surface parses on
 * setImmediate ticks), so a first click can land on a node that is being
 * replaced. Wait for the menu popup itself and re-click only while it is still
 * closed - a state-checked retry, never a blind repeat. The generous timeout
 * matches the 10_000 used below for the same cold-start reason. */
async function openRibbonOverflowMenu(): Promise<void> {
  const name = i18n.t("office.ribbon.more");
  await waitFor(() => {
    if (screen.queryByRole("menu") === null) fireEvent.click(screen.getByRole("button", { name }));
    expect(screen.queryByRole("menu")).not.toBeNull();
  }, { timeout: 10_000 });
}

it("mounts the sign-in card for a signed-out session", async () => {
  const { bridge } = makeBridge(vi.fn(async (channel: string) =>
    channel === "desktop:auth-config" ? { clientId: "uniwork-office-dev", deploymentId: "lane" } : { status: "signed-out" },
  ) as RendererBridge["call"]);
  const { container } = render(<App bridge={bridge} />);
  await waitFor(() => expect(container.querySelector("[data-login-state='signed-out']")).not.toBeNull());
  expect(screen.getByRole("heading", { name: "UniWork Office" })).toBeInTheDocument();
});

it("moves signed-out -> pending -> error when the browser cannot open", async () => {
  const { bridge } = makeBridge(vi.fn(async (channel: string) => {
    if (channel === "desktop:auth-config") return { clientId: "uniwork-office-dev", deploymentId: "lane" };
    if (channel === "desktop:auth-start") throw new Error("browser unavailable");
    return { status: "signed-out" };
  }) as RendererBridge["call"]);
  const { container } = render(<App bridge={bridge} />);
  await waitFor(() => expect(container.querySelector("[data-login-state='signed-out']")).not.toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "Đăng nhập" }));
  await waitFor(() => expect(container.querySelector("[data-login-state='error']")).not.toBeNull());
});

it("moves pending -> cancelled through the cancel action", async () => {
  const { bridge } = makeBridge(vi.fn(async (channel: string) => {
    if (channel === "desktop:auth-config") return { clientId: "uniwork-office-dev", deploymentId: "lane" };
    if (channel === "desktop:auth-start") return { status: "pending", attemptId: "attempt_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL" };
    if (channel === "desktop:auth-cancel") return {};
    return { status: "signed-out" };
  }) as RendererBridge["call"]);
  const { container } = render(<App bridge={bridge} />);
  await waitFor(() => expect(container.querySelector("[data-login-state='signed-out']")).not.toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "Đăng nhập" }));
  await waitFor(() => expect(container.querySelector("[data-login-state='pending']")).not.toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "Hủy đăng nhập" }));
  await waitFor(() => expect(container.querySelector("[data-login-state='cancelled']")).not.toBeNull());
});

it("moves pending -> expired when the attempt passes its TTL and offers a retry", async () => {
  const { bridge } = makeBridge(vi.fn(async (channel: string) => {
    if (channel === "desktop:auth-config") return { clientId: "uniwork-office-dev", deploymentId: "lane" };
    if (channel === "desktop:auth-start") return { status: "pending", attemptId: "attempt_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL", expiresAt: Date.now() + 30 };
    return { status: "signed-out" };
  }) as RendererBridge["call"]);
  const { container } = render(<App bridge={bridge} />);
  await waitFor(() => expect(container.querySelector("[data-login-state='signed-out']")).not.toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "Đăng nhập" }));
  await waitFor(() => expect(container.querySelector("[data-login-state='pending']")).not.toBeNull());
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)); });
  await waitFor(() => expect(container.querySelector("[data-login-state='expired']")).not.toBeNull());
  expect(screen.getByText("Yêu cầu đăng nhập đã hết hạn. Thử lại.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Đăng nhập" })).toBeInTheDocument();
});

it("reflects a login-required push from the host without a user action", async () => {
  const { bridge, emit } = makeBridge(vi.fn(async (channel: string) =>
    channel === "desktop:auth-config" ? { clientId: "uniwork-office-dev", deploymentId: "lane" } : { status: "signed-out" },
  ) as RendererBridge["call"]);
  const { container } = render(<App bridge={bridge} />);
  await waitFor(() => expect(container.querySelector("[data-login-state='signed-out']")).not.toBeNull());
  emit({ status: "login-required" });
  await waitFor(() => expect(container.querySelector("[data-login-state='login-required']")).not.toBeNull());
});

it("shows the signed-in shell with the account on the host once signed in", async () => {
  const { bridge } = makeBridge(vi.fn(async (channel: string) => {
    if (channel === "desktop:auth-config") return { clientId: "uniwork-office-dev", deploymentId: "lane" };
    if (channel === "desktop:auth-session") return { status: "signed-in", accountId: "account-1", deploymentId: "lane" };
    if (channel === "desktop:library-context") return { deployments: [], accounts: [], organizations: [], workspaces: [] };
    return { status: "signed-out" };
  }) as RendererBridge["call"]);
  const { container } = render(<App bridge={bridge} />);
  await waitFor(() => expect(container.querySelector("[data-host='office-desktop']")).not.toBeNull());
  expect(container.querySelector("[data-session-status='signed-in']")).not.toBeNull();
  expect(container.querySelector("[data-desktop-library-picker]")).not.toBeNull();
});

it("goes error when desktop:auth-config itself fails", async () => {
  const { bridge } = makeBridge(vi.fn(async (channel: string) => {
    if (channel === "desktop:auth-config") throw new Error("no transport");
    return { status: "signed-out" };
  }) as RendererBridge["call"]);
  const { container } = render(<App bridge={bridge} />);
  await waitFor(() => expect(container.querySelector("[data-login-state='error']")).not.toBeNull());
});

it("opens a launch ticket against the picked workspace when auth metadata has no workspace", async () => {
  let launch: ((event: { documentId: string; operation: "view" | "edit"; version?: number }) => void) | undefined;
  const call = vi.fn(async (channel: string) => {
    if (channel === "desktop:auth-config") return { clientId: "uniwork-office-dev", deploymentId: "lane" };
    if (channel === "desktop:auth-session") return { status: "signed-in", accountId: "account", deploymentId: "lane" };
    if (channel === "desktop:library-context") return { deployments: [{ id: "lane", name: "Server" }], accounts: [{ id: "account", name: "A" }], organizations: [{ id: "org", name: "Org" }], workspaces: [{ id: "ws", name: "Workspace" }] };
    if (channel === "desktop:library-list") return { documents: [], nextCursor: null, engineAvailable: true };
    throw new Error("open test refusal");
  });
  const { bridge } = makeBridge(call as RendererBridge["call"]);
  render(<App bridge={{ ...bridge, onLaunchRequested: (listener) => { launch = listener; return () => undefined; } }} />);
  await screen.findByText("Chưa có tài liệu");
  act(() => launch?.({ documentId: "ticket-document", version: 4, operation: "edit" }));
  await waitFor(() => expect(call).toHaveBeenCalledWith("desktop:office-open", expect.objectContaining({ workspaceId: "ws", documentId: "ticket-document", version: 4 })));
  await waitFor(() => expect(screen.getAllByRole("alert").some((alert) => alert.textContent?.includes("Không thể thực hiện thao tác"))).toBe(true));
});

it("shows a typed retryable list error when the library request rejects", async () => {
  const { bridge } = makeBridge(vi.fn(async (channel: string) => {
    if (channel === "desktop:auth-config") return { clientId: "uniwork-office-dev", deploymentId: "lane" };
    if (channel === "desktop:auth-session") return { status: "signed-in", accountId: "account-1", deploymentId: "lane" };
    if (channel === "desktop:library-context") return { deployments: [{ id: "default", name: "Default" }], accounts: [{ id: "account-1", name: "Me" }], organizations: [{ id: "org-1", name: "Acme" }], workspaces: [{ id: "ws-1", name: "Team" }] };
    if (channel === "desktop:library-list") throw new Error("transport unavailable");
    return {};
  }) as RendererBridge["call"]);
  render(<App bridge={bridge} />);
  await waitFor(() => expect(screen.getByText("Tài liệu")).toBeInTheDocument());
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Thử lại" })).toBeInTheDocument();
  expect(screen.queryByText("Trình soạn thảo không khả dụng; vẫn có thể tải xuống")).not.toBeInTheDocument();
});

it("opens an OS file in a new tab while another document remains mounted", async () => {
  let fileOpen: ((event: { handle: string }) => void) | undefined;
  const calls: string[] = [];
  const document = { id: "doc-1", workspaceId: "ws-1", title: "Plan.docx", kind: "file" as const, format: "docx" as const, version: 1, revision: "1", updatedAt: "2026-09-30T00:00:00.000Z", ownerKind: null, canEdit: true, downloadAvailable: true };
  const { bridge } = makeBridge(vi.fn(async (channel: string) => {
    calls.push(channel);
    if (channel === "desktop:auth-config") return { clientId: "uniwork-office-dev", deploymentId: "lane" };
    if (channel === "desktop:auth-session") return { status: "signed-in", accountId: "account-1", deploymentId: "lane" };
    if (channel === "desktop:library-context") return { deployments: [{ id: "default", name: "Default" }], accounts: [{ id: "account-1", name: "Me" }], organizations: [{ id: "org-1", name: "Acme" }], workspaces: [{ id: "ws-1", name: "Team" }] };
    if (channel === "desktop:library-list") return { documents: [document], nextCursor: null, engineAvailable: true };
    if (channel === "desktop:office-open") return { dataBase64: fixtureBase64, checksum: bytesChecksum(docxSource), filename: "Plan.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", document };
    if (channel === "desktop:file-open") return { opened: true, metadata: { handle: "file_abcdefghijklmnopqrstuvwxyzABCDEF", name: "Local plan.docx", byteLength: docxSource.length, modifiedAtMs: 1, checksum: bytesChecksum(docxSource) }, dataBase64: fixtureBase64 };
    return {};
  }) as RendererBridge["call"]);
  const liveBridge: RendererBridge = { ...bridge, onFileOpenRequested: (listener) => { fileOpen = listener; return () => { fileOpen = undefined; }; } };
  render(<App bridge={liveBridge} />);
  await screen.findByText("Plan.docx");
  fireEvent.click(screen.getByRole("button", { name: "Mở" }));
  // f40808f2 moved back-to-library out of the document header into the "..."
  // menu, so reach it as a menuitem (open-document.test.tsx does the same).
  // Let the first DOCX finish parsing before opening the menu: on a loaded CI
  // runner the parse blocks the main thread and the menu can miss a short window.
  await screen.findByTestId("docx-document-surface", undefined, { timeout: 10_000 });
  await openRibbonOverflowMenu();
  await screen.findByRole("menuitem", { name: i18n.t("officeDesktop.library.back") }, { timeout: 10_000 });
  act(() => fileOpen?.({ handle: "file_abcdefghijklmnopqrstuvwxyzABCDEF" }));
  await waitFor(() => expect(calls).toContain("desktop:file-open"));
  expect(await screen.findByRole("tab", { name: /Local plan\.docx/ })).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: /Plan\.docx/ })).toBeInTheDocument();
  // Both DOCX tabs parse on setImmediate ticks; finish them before the test ends
  // so no tick lands after jsdom teardown (unhandled "uint8array" error).
  await waitFor(() => expect(screen.getAllByTestId("docx-document-surface")).toHaveLength(2), { timeout: 10_000 });
});

it("picks a scope, lists the workspace library, opens and downloads a document, then signs out", async () => {
  const calls: Array<{ channel: string; payload: unknown }> = [];
  const download = vi.fn(() => "blob:download-test");
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: download });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  let nativeSave: ((event: { documentId: string }) => void) | undefined;
  const document = { id: "doc-1", workspaceId: "ws-1", title: "Plan.docx", kind: "file" as const, format: "docx" as const, version: 1, revision: "1", updatedAt: "2026-09-30T00:00:00.000Z", ownerKind: null, canEdit: true, downloadAvailable: true };
  const { bridge } = makeBridge(vi.fn(async (channel: string, payload: unknown) => {
    calls.push({ channel, payload });
    if (channel === "desktop:auth-config") return { clientId: "uniwork-office-dev", deploymentId: "lane" };
    if (channel === "desktop:auth-session") return { status: "signed-in", accountId: "account-1", deploymentId: "lane" };
    if (channel === "desktop:library-context") return { deployments: [{ id: "default", name: "Default" }], accounts: [{ id: "account-1", name: "me" }], organizations: [{ id: "org-1", name: "Acme" }], workspaces: [{ id: "ws-1", name: "Team" }] };
    if (channel === "desktop:library-list") return { documents: [document], nextCursor: null, engineAvailable: true };
    const bytes = { dataBase64: Buffer.from(docxSource).toString("base64"), checksum: bytesChecksum(docxSource), filename: "Plan.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
    if (channel === "desktop:library-download") return { ...bytes, documentId: document.id, version: 1 };
    if (channel === "desktop:office-open") return { ...bytes, document };
    if (channel === "desktop:office-save") { const request = payload as { intentId: string; idempotencyKey: string; checksum: string }; return { intentId: request.intentId, idempotencyKey: request.idempotencyKey, documentId: document.id, versionId: "v2", revision: "2", checksum: request.checksum }; }
    if (channel === "desktop:auth-logout") return { status: "signed-out" };
    return {};
  }) as RendererBridge["call"]);
  const liveBridge = { ...bridge, onOfficeSaveRequested: (listener: typeof nativeSave) => { nativeSave = listener; return () => { nativeSave = undefined; }; } };
  const { container } = render(<App bridge={liveBridge} />);
  await waitFor(() => expect(screen.getByText("Plan.docx")).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "Tải xuống" }));
  await waitFor(() => expect(download).toHaveBeenCalledOnce());
  expect(click).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Mở" }));
  await waitFor(() => expect(calls.some((call) => call.channel === "desktop:office-open")).toBe(true));
  expect(calls.some((call) => call.channel === "desktop:library-download")).toBe(true);
  // f40808f2 moved back-to-library out of the document header into the "..."
  // menu, so reach it as a menuitem (open-document.test.tsx does the same).
  await openRibbonOverflowMenu();
  await screen.findByRole("menuitem", { name: i18n.t("officeDesktop.library.back") });
  await screen.findByTestId("docx-document-surface", {}, { timeout: 10000 });
  expect(calls.filter((call) => call.channel === "desktop:office-save")).toHaveLength(0);
  const paragraph = container.querySelector('.ProseMirror p, .ProseMirror h1')!;
  act(() => { paragraph.textContent = "Edited fixture"; fireEvent.input(paragraph); });
  await waitFor(() => expect(container.querySelector('[data-testid="office-save-not-sent"]')).not.toBeNull());
  await waitFor(() => expect(container.querySelector('[data-testid="docx-editor"]')).not.toBeNull());
  expect(container.querySelector("#desktop-panel-library")).toHaveAttribute("hidden");
  act(() => nativeSave?.({ documentId: document.id }));
  await waitFor(() => expect(calls.filter((call) => call.channel === "desktop:office-save")).toHaveLength(1));
  const saved = calls.find((call) => call.channel === "desktop:office-save")!.payload as { dataBase64: string; checksum: string };
  expect(saved.dataBase64).not.toBe(Buffer.from(docxSource).toString("base64"));
  expect(saved.checksum).toBe(bytesChecksum(Buffer.from(saved.dataBase64, "base64")));

  fireEvent.click(screen.getByRole("button", { name: /Tài khoản:/ }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Đăng xuất" }));
  // UNI-922 §3.7: signing out closes cloud work and returns to the local home.
  await waitFor(() => expect(container.querySelector("[data-local-home='true']")).not.toBeNull());
  click.mockRestore();
});

const signedInCalls = (extra: (channel: string) => unknown) => vi.fn(async (channel: string) => {
  if (channel === "desktop:auth-config") return { clientId: "uniwork-office-dev", deploymentId: "lane" };
  if (channel === "desktop:auth-session") return { status: "signed-in", accountId: "account-1", deploymentId: "lane" };
  if (channel === "desktop:library-context") return { deployments: [], accounts: [], organizations: [], workspaces: [] };
  return extra(channel);
}) as RendererBridge["call"];

it("offers a found draft through the shared recovery prompt in vi and en", async () => {
  const draft = { draftId: "local:abcdef:0123456789abcdef", identity: { deploymentId: "lane", accountId: "account-1", organizationId: "local", workspaceId: "local", documentId: "local:abcdef", base: { revision: "1", version: `sha256:${"a".repeat(64)}` } }, generation: 1, checksum: `sha256:${"c".repeat(64)}`, byteLength: 5, updatedAt: 1 };
  const { bridge } = makeBridge(signedInCalls((channel) => (channel === "desktop:draft-list" ? { drafts: [draft] } : {})));
  render(<App bridge={bridge} />);
  await waitFor(() => expect(screen.getByText(i18n.t("office.recovery.title"))).toBeInTheDocument());
  const vietnamese = i18n.t("office.recovery.title");
  await act(async () => { await setLocale("en"); });
  await waitFor(() => expect(screen.getByText(i18n.t("office.recovery.title"))).toBeInTheDocument());
  expect(i18n.t("office.recovery.title")).not.toBe(vietnamese);
  expect(screen.queryByRole("button", { name: /export/i })).toBeNull();
  // The dialog's close affordance reuses the keep label, so both may match.
  expect(screen.getAllByRole("button", { name: i18n.t("office.recovery.keep") }).length).toBeGreaterThan(0);
});

it("renders a locked draft store with the shared recovery vocabulary and no export action", async () => {
  const { bridge } = makeBridge(signedInCalls((channel) => {
    if (channel === "desktop:draft-list") throw Object.assign(new Error("draft operation refused"), { code: "draft_recovery_locked" });
    return {};
  }));
  render(<App bridge={bridge} />);
  await waitFor(() => expect(document.querySelector('[data-testid="office-recovery-locked"]')).not.toBeNull());
  expect(screen.getByText(i18n.t("office.recovery.locked"))).toBeInTheDocument();
  await act(async () => { await setLocale("en"); });
  await waitFor(() => expect(screen.getByText(i18n.t("office.recovery.locked"))).toBeInTheDocument());
  expect(screen.queryByRole("button", { name: /export|clipboard/i })).toBeNull();
});

it("resolves a clean empty window leave without an unnecessary prompt", async () => {
  const calls: Array<{ channel: string; payload: unknown }> = [];
  let request: ((event: { requestId: string; reason: "close" | "logout" | "update" }) => void) | undefined;
  const call = signedInCalls(() => ({})) as (channel: string, payload: unknown) => Promise<unknown>;
  const { bridge } = makeBridge((async (channel: string, payload: unknown) => { calls.push({ channel, payload }); return call(channel, payload); }) as RendererBridge["call"]);
  const live: RendererBridge = { ...bridge, onLeaveRequested: (listener) => { request = listener; return () => { request = undefined; }; } };
  render(<App bridge={live} />);
  await waitFor(() => expect(document.querySelector("[data-session-status='signed-in']")).not.toBeNull());
  expect(screen.queryByText(i18n.t("office.leave.title"))).not.toBeInTheDocument();
  act(() => request?.({ requestId: "leave-1", reason: "close" }));
  await waitFor(() => expect(calls.find((entry) => entry.channel === "desktop:leave-resolved")?.payload).toMatchObject({ requestId: "leave-1", choice: "keep", proceeded: true }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
