import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { AdminDemoRequestsView } from "./demo-requests";
initI18n();
const request = { id: "d1", full_name: "Lan", work_email: "lan@example.com", company_name: "Acme", team_size: "11-50", message: "Project workflows", locale: "vi", status: "new", created_at: "2026-10-13T08:00:00Z", updated_at: "2026-10-13T08:00:00Z" };
const nav = { push: vi.fn(), replace: vi.fn(), back: vi.fn(), pathname: "/admin/demo-requests", searchParams: new URLSearchParams(), getShareableUrl: (p: string) => p };
beforeEach(() => { requestMock.mockReset(); });
it("support can read requests without write controls", async () => {
  requestMock.mockImplementation(async (path: string) => path.endsWith("/me") ? { platform_role: "support" } : { requests: [request], total: 1 });
  render(wrapWithNav(<AdminDemoRequestsView />, nav));
  expect(await screen.findByText("lan@example.com")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Cập nhật", exact: true })).not.toBeInTheDocument();
});
it("an admin update requires a reason and awaits the receipt", async () => {
  const user = userEvent.setup();
  requestMock.mockImplementation(async (path: string, options?: { method?: string }) => {
    if (path.endsWith("/me")) return { platform_role: "admin" };
    if (options?.method === "PATCH") return { request: { ...request, status: "in_progress" } };
    return { requests: [request], total: 1 };
  });
  render(wrapWithNav(<AdminDemoRequestsView />, nav));
  await user.click(await screen.findByRole("button", { name: "Cập nhật", exact: true }));
  await user.click(screen.getByLabelText("Trạng thái"));
  await user.click(await screen.findByRole("option", { name: "Đang xử lý" }));
  expect(screen.getByRole("button", { name: "Xác nhận", exact: true })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Lý do"), { target: { value: "Đã liên hệ để đặt lịch demo" } });
  await waitFor(() => expect(screen.getByRole("button", { name: "Xác nhận", exact: true })).not.toBeDisabled());
  await user.click(screen.getByRole("button", { name: "Xác nhận", exact: true }));
  await waitFor(() => expect(requestMock).toHaveBeenCalledWith("/api/v1/admin/demo-requests/d1", expect.objectContaining({ method: "PATCH", body: { status: "in_progress", reason: "Đã liên hệ để đặt lịch demo" } })));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});
