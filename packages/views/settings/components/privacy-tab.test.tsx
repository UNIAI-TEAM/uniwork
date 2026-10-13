import { configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { requestMock, wrap } from "../../test/api-mock";
import { WorkspaceProvider } from "../../layout/workspace-context";
import { PrivacyTab } from "./privacy-tab";

initI18n();
configure({ asyncUtilTimeout: 8_000 });

const user: User = {
  id: "u1",
  email: "a@b.c",
  display_name: "An",
  onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};

const workspace: Workspace = {
  id: "ws1",
  slug: "team",
  name: "Team",
  organization_id: "o1",
  organization_slug: "acme",
  organization_name: "Acme",
};

function mockApi(role: string, exports: unknown = { exports: [] }) {
  requestMock.mockImplementation((path: string) => {
    if (path.endsWith("/members/me")) return Promise.resolve({ role });
    if (path.includes("/privacy/exports")) return Promise.resolve(exports);
    return Promise.resolve({});
  });
}

function renderTab() {
  return render(wrap(
    <WorkspaceProvider workspace={workspace} user={user}>
      <PrivacyTab />
    </WorkspaceProvider>,
  ));
}

describe("PrivacyTab", () => {
  beforeEach(() => {
    resetAuthStoreForTests();
    setSessionUser(user);
    requestMock.mockReset();
  });

  it("hides the request from a member", async () => {
    mockApi("member");
    renderTab();
    expect(await screen.findByText("Chỉ chủ sở hữu tổ chức dùng được")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tạo bản xuất" })).not.toBeInTheDocument();
  });

  it("lets the owner queue an export and lists a finished job", async () => {
    mockApi("owner", {
      exports: [
        {
          id: "e1",
          status: "done",
          row_count: 4,
          created_at: "2026-10-12T02:00:00Z",
          download_url: "/api/v1/orgs/o1/privacy/exports/e1/download",
          expires_at: "2026-10-13T02:00:00Z",
        },
      ],
    });
    renderTab();
    expect(await screen.findByRole("button", { name: "Tải về" })).toBeInTheDocument();
    const create = screen.getByRole("button", { name: "Tạo bản xuất" });
    fireEvent.click(create);
    await waitFor(() => {
      const posted = requestMock.mock.calls.some(
        (call) => String(call[0]).includes("/privacy/exports") && call[1]?.method === "POST",
      );
      expect(posted).toBe(true);
    });
  });

  it("queues deletion only after the owner types the slug", async () => {
    mockApi("owner");
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: "Xóa tổ chức" }));
    const dialog = await screen.findByRole("dialog", { name: "Xóa tổ chức?" });
    const confirm = within(dialog).getByRole("button", { name: "Xóa nội dung" });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Định danh tổ chức"), { target: { value: "acme" } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => {
      const posted = requestMock.mock.calls.some((call) => {
        const init = call[1] as { method?: string; body?: { confirm_slug?: string } } | undefined;
        return String(call[0]).includes("/privacy/deletion")
          && init?.method === "POST"
          && init.body?.confirm_slug === "acme";
      });
      expect(posted).toBe(true);
    });
  });

  it("shows a running deletion and keeps it out of the export list", async () => {
    mockApi("owner", {
      exports: [
        {
          id: "d1",
          kind: "delete",
          status: "running",
          row_count: 0,
          created_at: "2026-10-12T02:00:00Z",
        },
      ],
    });
    renderTab();
    expect(await screen.findByText("Đang chạy")).toBeInTheDocument();
    expect(screen.getByText("Chưa có bản xuất nào.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Xóa tổ chức" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Tạo bản xuất" })).toBeDisabled();
  });

  it("lets the owner cancel a deletion that is still waiting", async () => {
    mockApi("owner", {
      exports: [
        {
          id: "d1",
          kind: "delete",
          status: "scheduled",
          row_count: 0,
          created_at: "2026-10-12T02:00:00Z",
          erases_at: "2026-10-17T02:00:00Z",
        },
      ],
    });
    renderTab();
    expect(await screen.findByRole("button", { name: "Hủy lệnh xóa" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Xóa tổ chức" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Tạo bản xuất" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Hủy lệnh xóa" }));
    await waitFor(() => {
      const posted = requestMock.mock.calls.some(
        (call) => String(call[0]).includes("/privacy/deletion/cancel") && call[1]?.method === "POST",
      );
      expect(posted).toBe(true);
    });
  });
});
