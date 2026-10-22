import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { AdminChatReportsView } from "./chat-reports";

initI18n();
const now = Date.now();
const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
const report = {
  id: "r1", organization_id: "o1", organization_slug: "acme", organization_name: "Acme", organization_status: "active",
  workspace_id: "w1", room_id: "room1", message_id: "m1", target_user_id: "u2", reporter_id: "u1", reason: "harassment",
  status: "open", created_at: iso(30 * 60 * 60 * 1000),
};
const page = { reports: [report], total: 1, open_count: 1, oldest_open_at: report.created_at };
const nav = { push: vi.fn(), replace: vi.fn(), back: vi.fn(), pathname: "/admin/chat-reports", searchParams: new URLSearchParams(), getShareableUrl: (p: string) => p };

beforeEach(() => { requestMock.mockReset(); nav.push.mockReset(); });

it("shows the open queue with the oldest report overdue, ids and reason only, and support cannot close", async () => {
  requestMock.mockImplementation(async (path: string) => (path.endsWith("/me") ? { platform_role: "support" } : page));
  render(wrapWithNav(<AdminChatReportsView />, nav));
  expect(await screen.findByText("Quấy rối hoặc bắt nạt")).toBeInTheDocument();
  expect(requestMock).toHaveBeenCalledWith("/api/v1/admin/chat-reports?status=open&limit=50&offset=0");
  expect(screen.getByText(/1 báo cáo đang chờ, lâu nhất từ/)).toBeInTheDocument();
  expect(screen.getAllByText("Quá 24 giờ")).toHaveLength(2);
  expect(screen.getByText("Người u2")).toBeInTheDocument();
  expect(screen.getByText("Tin m1")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Đóng báo cáo" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("link", { name: "Acme" }));
  expect(nav.push).toHaveBeenCalledWith("/admin/organizations/o1");
});

it("filters by status and says when nothing waits", async () => {
  requestMock.mockImplementation(async (path: string) => {
    if (path.endsWith("/me")) return { platform_role: "support" };
    if (path.includes("status=resolved")) return { reports: [{ ...report, status: "resolved", message_id: null, organization_status: "suspended" }], total: 1, open_count: 0, oldest_open_at: null };
    return { reports: [], total: 0, open_count: 0, oldest_open_at: null };
  });
  render(wrapWithNav(<AdminChatReportsView />, nav));
  expect(await screen.findByText("Không có báo cáo")).toBeInTheDocument();
  expect(screen.getByText("Không còn báo cáo nào chờ xử lý.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Đã xử lý" }));
  expect(await screen.findByText("suspended")).toBeInTheDocument();
  expect(screen.queryByText(/^Tin /)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Tất cả" }));
  await waitFor(() => expect(requestMock).toHaveBeenCalledWith("/api/v1/admin/chat-reports?limit=50&offset=0"));
});

it("an admin closes a report with a reason and awaits the receipt; a refusal says so", async () => {
  const user = userEvent.setup();
  let refuse = true;
  requestMock.mockImplementation(async (path: string, options?: { method?: string }) => {
    if (path.endsWith("/me")) return { platform_role: "admin" };
    if (options?.method === "POST") {
      if (refuse) { refuse = false; throw new Error("conflict"); }
      return { id: "r1", status: "resolved" };
    }
    return page;
  });
  render(wrapWithNav(<AdminChatReportsView />, nav));
  await user.click(await screen.findByRole("button", { name: "Đóng báo cáo" }));
  fireEvent.change(screen.getByLabelText("Lý do"), { target: { value: "Đã yêu cầu chủ sở hữu vô hiệu hoá người đăng" } });
  await user.click(screen.getByRole("button", { name: "Xác nhận" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Chưa đóng được báo cáo. Hãy thử lại.");
  await user.click(screen.getByRole("button", { name: "Xác nhận" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  const posts = requestMock.mock.calls.filter(([, options]) => (options as { method?: string } | undefined)?.method === "POST");
  expect(posts).toHaveLength(2);
  expect(posts[1]).toEqual(["/api/v1/admin/chat-reports/r1/resolve", expect.objectContaining({ body: { reason: "Đã yêu cầu chủ sở hữu vô hiệu hoá người đăng" } })]);
});

it("says the queue could not be read, and reads it again", async () => {
  let fail = true;
  requestMock.mockImplementation(async (path: string) => {
    if (path.endsWith("/me")) return { platform_role: "support" };
    if (fail) { fail = false; throw new Error("down"); }
    return page;
  });
  render(wrapWithNav(<AdminChatReportsView />, nav));
  expect(await screen.findByText("Không tải được báo cáo")).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole("button", { name: "Tải lại" })[0]!);
  expect(await screen.findByText("Quấy rối hoặc bắt nạt")).toBeInTheDocument();
});

it("an admin takes a reported message down with a reason, never seeing it; a refusal says so", async () => {
  const user = userEvent.setup();
  let refuse = true;
  requestMock.mockImplementation(async (path: string, options?: { method?: string }) => {
    if (path.endsWith("/me")) return { platform_role: "admin" };
    if (options?.method === "POST") {
      if (refuse) { refuse = false; throw new Error("down"); }
      return { id: "r1", status: "resolved" };
    }
    return page;
  });
  render(wrapWithNav(<AdminChatReportsView />, nav));
  await user.click(await screen.findByRole("button", { name: "Gỡ tin nhắn" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("Gỡ tin nhắn này");
  fireEvent.change(screen.getByLabelText("Lý do"), { target: { value: "Nội dung quấy rối, gỡ theo điều khoản" } });
  await user.click(screen.getByRole("button", { name: "Xác nhận" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Chưa gỡ được tin nhắn. Hãy thử lại.");
  await user.click(screen.getByRole("button", { name: "Xác nhận" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  const posts = requestMock.mock.calls.filter(([, options]) => (options as { method?: string } | undefined)?.method === "POST");
  expect(posts[1]).toEqual(["/api/v1/admin/chat-reports/r1/remove-message", expect.objectContaining({ body: { reason: "Nội dung quấy rối, gỡ theo điều khoản" } })]);
});

it("offers no takedown for a report about a person", async () => {
  requestMock.mockImplementation(async (path: string) =>
    path.endsWith("/me") ? { platform_role: "admin" } : { ...page, reports: [{ ...report, message_id: null, room_id: null }] },
  );
  render(wrapWithNav(<AdminChatReportsView />, nav));
  expect(await screen.findByRole("button", { name: "Đóng báo cáo" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Gỡ tin nhắn" })).not.toBeInTheDocument();
});
