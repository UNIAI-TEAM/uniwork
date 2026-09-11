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
    // The change summary shows the field and both sides of the move.
    expect(await screen.findByText("todo")).toBeInTheDocument();
    expect(screen.getByText("status")).toBeInTheDocument();
    expect(screen.getByText("Cập nhật task")).toBeInTheDocument();
    // The actor is a name when the workspace knows them, never a bare ULID.
    expect(await screen.findByTitle("u1")).toHaveTextContent("An");
    expect(screen.getByText("done")).toBeInTheDocument();
  });

  it("appends the next page under the first instead of replacing it", async () => {
    mockApi("admin");
    renderTab();
    await screen.findByText("todo");
    fireEvent.click(screen.getByRole("button", { name: "Tải thêm" }));
    await waitFor(() => expect(screen.getByText("Xóa task")).toBeInTheDocument());
    expect(screen.getByText("Cập nhật task")).toBeInTheDocument();
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
    expect(screen.queryByText("todo")).toBeNull();
  });

  it("offers the next step when nothing matches instead of rendering rows nobody asked for", async () => {
    mockApi("owner", { events: { events: [], next_before: "" } });
    renderTab();
    expect(await screen.findByText("Chưa có bản ghi nào khớp")).toBeInTheDocument();
  });

  it("reserves retention and export for the owner", async () => {
    mockApi("admin");
    renderTab();
    await screen.findByText("todo");
    expect(screen.getByLabelText("Số ngày")).toBeDisabled();
    expect(screen.getByText("Chỉ chủ sở hữu tổ chức đổi được thiết lập này.")).toBeInTheDocument();
    expect(screen.getByText("Chỉ chủ sở hữu tổ chức xuất được nhật ký.")).toBeInTheDocument();
  });

  it("lets the owner edit retention", async () => {
    mockApi("owner");
    renderTab();
    await screen.findByText("todo");
    await waitFor(() => expect(screen.getByLabelText("Số ngày")).not.toBeDisabled());
    // Nothing to save until the number actually changes.
    expect(screen.getByRole("button", { name: "Lưu" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Số ngày"), { target: { value: "120" } });
    expect(screen.getByRole("button", { name: "Lưu" })).not.toBeDisabled();
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
