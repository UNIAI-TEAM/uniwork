/** @vitest-environment jsdom */
import { render, screen, waitFor } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { DesktopSessionMetadata } from "../shared/ipc";
import { App, type RendererBridge } from "./app";

function makeBridge(call: RendererBridge["call"]): { bridge: RendererBridge; emit: (metadata: DesktopSessionMetadata) => void } {
  let listener: ((metadata: DesktopSessionMetadata) => void) | undefined;
  const bridge: RendererBridge = {
    call,
    onSessionChanged: (next) => { listener = next; return () => undefined; },
  };
  return { bridge, emit: (metadata) => listener?.(metadata) };
}

it("mounts the sign-in card for a signed-out session", async () => {
  const { bridge } = makeBridge(vi.fn(async (channel: string) =>
    channel === "desktop:auth-config" ? { clientId: "uniwork-office-dev", deploymentId: "lane" } : { status: "signed-out" },
  ) as RendererBridge["call"]);
  const { container } = render(<App bridge={bridge} />);
  await waitFor(() => expect(container.querySelector("[data-login-state='signed-out']")).not.toBeNull());
  expect(screen.getByText("UniWork Office")).toBeInTheDocument();
});

it("moves signed-out -> pending -> error when the browser cannot open", async () => {
  const { bridge } = makeBridge(vi.fn(async (channel: string) => {
    if (channel === "desktop:auth-config") return { clientId: "uniwork-office-dev", deploymentId: "lane" };
    if (channel === "desktop:auth-start") throw new Error("browser unavailable");
    return { status: "signed-out" };
  }) as RendererBridge["call"]);
  const { container } = render(<App bridge={bridge} />);
  await waitFor(() => expect(container.querySelector("[data-login-state='signed-out']")).not.toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "Đăng nhập bằng trình duyệt" }));
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
  fireEvent.click(screen.getByRole("button", { name: "Đăng nhập bằng trình duyệt" }));
  await waitFor(() => expect(container.querySelector("[data-login-state='pending']")).not.toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "Hủy đăng nhập" }));
  await waitFor(() => expect(container.querySelector("[data-login-state='cancelled']")).not.toBeNull());
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

it("picks a scope, lists the workspace library, opens and downloads a document, then signs out", async () => {
  const calls: Array<{ channel: string; payload: unknown }> = [];
  const document = { id: "doc-1", workspaceId: "ws-1", title: "Plan.docx", kind: "file" as const, format: "docx" as const, version: 1, revision: "1", updatedAt: "2026-09-30T00:00:00.000Z", ownerKind: null, canEdit: true, downloadAvailable: true };
  const { bridge } = makeBridge(vi.fn(async (channel: string, payload: unknown) => {
    calls.push({ channel, payload });
    if (channel === "desktop:auth-config") return { clientId: "uniwork-office-dev", deploymentId: "lane" };
    if (channel === "desktop:auth-session") return { status: "signed-in", accountId: "account-1", deploymentId: "lane" };
    if (channel === "desktop:library-context") return { deployments: [{ id: "default", name: "Default" }], accounts: [{ id: "account-1", name: "me" }], organizations: [{ id: "org-1", name: "Acme" }], workspaces: [{ id: "ws-1", name: "Team" }] };
    if (channel === "desktop:library-list") return { documents: [document], nextCursor: null, engineAvailable: true };
    if (channel === "desktop:auth-logout") return { status: "signed-out" };
    return {};
  }) as RendererBridge["call"]);
  const { container } = render(<App bridge={bridge} />);
  await waitFor(() => expect(screen.getByText("Plan.docx")).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "Mở" }));
  fireEvent.click(screen.getByRole("button", { name: "Tải xuống" }));
  await waitFor(() => expect(calls.some((call) => call.channel === "desktop:office-open")).toBe(true));
  expect(calls.some((call) => call.channel === "desktop:library-download")).toBe(true);

  fireEvent.click(screen.getByRole("button", { name: "Đăng xuất" }));
  await waitFor(() => expect(container.querySelector("[data-login-state='signed-out']")).not.toBeNull());
});
