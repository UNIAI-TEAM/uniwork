import { configure, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { requestMock, wrap } from "../../test/api-mock";
import { WorkspaceProvider } from "../../layout/workspace-context";
import { AuditTab } from "./audit-tab";

initI18n();

// The tab renders after two round trips (organizations → audit) and, under
// the full suite with coverage, the default 1s wait is not enough.
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

const auditEvent = {
  id: "a1",
  organization_id: "o1",
  workspace_id: "ws1",
  actor_kind: "human",
  actor_id: "u1",
  action: "task.updated",
  resource_type: "task",
  resource_id: "t1",
  changes: { status: { from: "todo", to: "done" } },
  metadata: {},
  correlation_id: "corr1",
  occurred_at: "2026-09-04T09:00:00Z",
};

/**
 * Answers the endpoints the tab calls, by path. `role` decides what the
 * organizations list reports, which is the only thing the permission gate
 * reads — the same gate the server applies.
 */
function mockApi(role: string, overrides: Record<string, unknown> = {}) {
  requestMock.mockImplementation((path: string) => {
    if (path.startsWith("/api/v1/orgs") && path.includes("/audit/retention")) {
      return Promise.resolve({ retain_days: 90 });
    }
    if (path.includes("/audit/exports")) return Promise.resolve({ exports: [] });
    if (path.includes("/audit")) {
      if ("events" in overrides) return Promise.resolve(overrides.events);
      if (path.includes("before=")) {
        return Promise.resolve({ events: [{ ...auditEvent, id: "a2", action: "task.deleted" }], next_before: "" });
      }
      return Promise.resolve({ events: [auditEvent], next_before: "cursor-1" });
    }
    if (path.endsWith("/members")) {
      return Promise.resolve({
        members: [{ workspace_id: "ws1", user_id: "u1", role: "member", email: "a@b.c", display_name: "An" }],
      });
    }
    if (path === "/api/v1/orgs") {
      return Promise.resolve({ organizations: [{ id: "o1", slug: "acme", name: "Acme", role }] });
    }
    return Promise.resolve({});
  });
}

function renderTab() {
  return render(
    wrap(
      <WorkspaceProvider workspace={workspace} user={user}>
        <AuditTab />
      </WorkspaceProvider>,
    ),
  );
}

describe("AuditTab", () => {
  beforeEach(() => {
    resetAuthStoreForTests();
    setSessionUser(user);
    requestMock.mockReset();
  });

  it("shows the log to an organization admin in words, not identifiers", async () => {
    mockApi("admin");
    renderTab();
    // The change summary shows the translated field label and both sides of
    // the move, each value in words rather than its schema identifier.
    expect(await screen.findByText("Cần làm")).toBeInTheDocument();
    expect(screen.getByText("Trạng thái")).toBeInTheDocument();
    expect(screen.getByText("Cập nhật việc")).toBeInTheDocument();
    // The actor is a name when the workspace knows them, never a bare ULID.
    expect(await screen.findByTitle("u1")).toHaveTextContent("An");
    expect(screen.getByText("Hoàn thành")).toBeInTheDocument();
    expect(screen.queryByText("todo")).toBeNull();
    // The row names the resource; its id is for the detail sheet only.
    expect(screen.queryByText(/t1/)).toBeNull();
  });

  it("appends the next page under the first instead of replacing it", async () => {
    mockApi("admin");
    renderTab();
    await screen.findByText("Cần làm");
    fireEvent.click(screen.getByRole("button", { name: "Tải thêm" }));
    await waitFor(() => expect(screen.getByText("Xóa việc")).toBeInTheDocument());
    expect(screen.getByText("Cập nhật việc")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tải thêm" })).toBeNull();
  });

  it("opens the entry details from the row", async () => {
    mockApi("owner");
    renderTab();
    const [row] = await screen.findAllByRole("button", { name: /Xem chi tiết bản ghi/ });
    fireEvent.click(row!);
    expect(await screen.findByText("corr1")).toBeInTheDocument();
  });

  it("tells a plain member why the log is not theirs, instead of showing an empty table", async () => {
    mockApi("member");
    renderTab();
    expect(await screen.findByText("Bạn không xem được nhật ký này")).toBeInTheDocument();
    expect(screen.queryByText("Cần làm")).toBeNull();
  });

  it("says the log is empty without implying a filter nobody set", async () => {
    mockApi("owner", { events: { events: [], next_before: "" } });
    renderTab();
    expect(await screen.findByText("Chưa có bản ghi nào")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Xóa bộ lọc" })).toBeNull();
  });

  it("applies a filter as it is typed, without a submit, and offers to clear it", async () => {
    mockApi("owner");
    renderTab();
    await screen.findByText("Cần làm");
    expect(screen.queryByRole("button", { name: "Áp dụng" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Người thực hiện"), { target: { value: "u9" } });
    // The count and the way out appear at once; the request waits for typing to stop.
    expect(screen.getAllByText("1 bộ lọc").length).toBeGreaterThan(0);
    await waitFor(() =>
      expect(requestMock.mock.calls.some(([path]) => String(path).includes("actor_id=u9"))).toBe(true),
    );
    fireEvent.click(screen.getByRole("button", { name: "Xóa bộ lọc" }));
    expect(screen.queryByText("1 bộ lọc")).toBeNull();
  });

  it("offers the next step when a filter matches nothing", async () => {
    requestMock.mockReset();
    mockApi("owner");
    const base = requestMock.getMockImplementation()!;
    requestMock.mockImplementation((path: string) =>
      path.includes("actor_id=")
        ? Promise.resolve({ events: [], next_before: "" })
        : base(path),
    );
    renderTab();
    await screen.findByText("Cần làm");
    fireEvent.change(screen.getByLabelText("Người thực hiện"), { target: { value: "nobody" } });
    expect(await screen.findByText("Chưa có bản ghi nào khớp")).toBeInTheDocument();
  });

  it("reserves retention and export for the owner", async () => {
    mockApi("admin");
    renderTab();
    await screen.findByText("Cần làm");
    expect(screen.getByLabelText("Số ngày")).toBeDisabled();
    expect(screen.getByText("Chỉ chủ sở hữu tổ chức đổi được thiết lập này.")).toBeInTheDocument();
    expect(screen.getByText("Chỉ chủ sở hữu tổ chức xuất được nhật ký.")).toBeInTheDocument();
  });

  it("lets the owner edit retention", async () => {
    mockApi("owner");
    renderTab();
    await screen.findByText("Cần làm");
    await waitFor(() => expect(screen.getByLabelText("Số ngày")).not.toBeDisabled());
    // Nothing to save until the number actually changes.
    expect(screen.getByRole("button", { name: "Lưu" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Số ngày"), { target: { value: "120" } });
    expect(screen.getByRole("button", { name: "Lưu" })).not.toBeDisabled();
    expect(screen.getByLabelText("Số ngày")).not.toHaveAttribute("aria-invalid");
  });

  it("says a retention outside the range is wrong before anything is sent", async () => {
    mockApi("owner");
    renderTab();
    await screen.findByText("Cần làm");
    await waitFor(() => expect(screen.getByLabelText("Số ngày")).not.toBeDisabled());
    // The range is stated once, as the row hint.
    expect(screen.getAllByText(/30 đến 730/)).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Số ngày"), { target: { value: "10" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Nhập một số nguyên từ 30 đến 730.");
    expect(screen.getByLabelText("Số ngày")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "Lưu" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Số ngày"), { target: { value: "731" } });
    expect(screen.getByRole("button", { name: "Lưu" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Số ngày"), { target: { value: "730" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Lưu" })).not.toBeDisabled();
  });

  it("names the tab after what it holds and shows an empty export list as a line", async () => {
    mockApi("owner");
    renderTab();
    expect(await screen.findByRole("heading", { name: "Nhật ký hoạt động" })).toBeInTheDocument();
    expect(await screen.findByText("Chưa có bản xuất nào.")).toBeInTheDocument();
  });

  it("says the log could not be loaded rather than blanking the screen", async () => {
    requestMock.mockImplementation((path: string) => {
      if (path === "/api/v1/orgs") {
        return Promise.resolve({ organizations: [{ id: "o1", slug: "acme", name: "Acme", role: "owner" }] });
      }
      if (path.includes("/audit/retention")) return Promise.resolve({ retain_days: 90 });
      if (path.includes("/audit/exports")) return Promise.resolve({ exports: [] });
      return Promise.reject(new Error("boom"));
    });
    renderTab();
    expect(await screen.findByText("Không tải được nhật ký")).toBeInTheDocument();
  });
});
