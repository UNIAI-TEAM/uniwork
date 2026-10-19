import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { requestMock, wrap } from "../../test/api-mock";
import { WorkspaceProvider } from "../../layout/workspace-context";
import { TaskLabelsTab } from "./task-labels-tab";

initI18n();

const user: User = {
  id: "u1",
  email: "ha@acme.vn",
  display_name: "Đỗ Thị Hà",
  onboarded_at: "2026-09-01T00:00:00Z",
  email_verified_at: "2026-09-01T00:00:00Z",
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

const label = (over: Record<string, unknown>) => ({
  organization_id: "o1",
  workspace_id: "ws1",
  description: "",
  color: "#ef4444",
  usage_count: 0,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  ...over,
});

const labels = [
  label({ id: "l-bug", name: "Bug", description: "Lỗi cần sửa", usage_count: 12, updated_at: "2026-10-01T12:00:00Z" }),
  label({ id: "l-docs", name: "Tài liệu", color: "#3b82f6" }),
];

type Init = { method?: string; body?: unknown } | undefined;

function mockApi(role: string, list: unknown[] = labels) {
  requestMock.mockImplementation((path: string, init?: Init) => {
    if (path.endsWith("/me")) return Promise.resolve({ membership: { user_id: "u1", role, source: "membership" } });
    if (init?.method) return Promise.resolve({ label: list[0] ?? null });
    if (path.includes("/task-labels")) return Promise.resolve({ labels: list, total: list.length });
    return Promise.resolve({});
  });
}

const writes = () =>
  requestMock.mock.calls
    .filter(([, init]) => (init as Init)?.method)
    .map(([path, init]) => ({ path: String(path), method: (init as Init)!.method, body: (init as Init)!.body }));

function renderTab() {
  return render(
    wrap(
      <WorkspaceProvider workspace={workspace} user={user}>
        <TaskLabelsTab />
      </WorkspaceProvider>,
    ),
  );
}

describe("TaskLabelsTab", () => {
  beforeEach(() => {
    resetAuthStoreForTests();
    setSessionUser(user);
    requestMock.mockReset();
  });

  it("lists each label with what it is for and how many tasks carry it, read-only for a member", async () => {
    mockApi("member");
    renderTab();
    const row = (await screen.findByText("Bug")).closest("li")!;
    expect(row).toHaveTextContent("Lỗi cần sửa · 12 công việc · Cập nhật 1/10/2026");
    expect(screen.queryByRole("button", { name: "Nhãn mới" })).not.toBeInTheDocument();
    expect(within(row).queryByRole("button")).not.toBeInTheDocument();
  });

  it("filters by name or description", async () => {
    mockApi("admin");
    renderTab();
    await screen.findByText("Bug");
    fireEvent.change(screen.getByRole("searchbox", { name: "Lọc nhãn" }), { target: { value: "sửa" } });
    expect(screen.getByText("Bug")).toBeInTheDocument();
    expect(screen.queryByText("Tài liệu")).not.toBeInTheDocument();
  });

  it("creates a label with the picked swatch", async () => {
    mockApi("admin");
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: "Nhãn mới" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Tên"), { target: { value: "Khẩn" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Chọn màu: #3b82f6" }));
    const palette = await screen.findByRole("dialog", { name: "Bảng màu" });
    fireEvent.click(within(palette).getByRole("button", { name: "Đỏ" }));
    expect(within(dialog).getByRole("button", { name: "Chọn màu: #ef4444" })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Tạo nhãn" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({
      path: "/api/v1/workspaces/ws1/task-labels",
      method: "POST",
      body: { name: "Khẩn", color: "#ef4444", description: "" },
    });
  });

  it("blocks a colour the server would refuse", async () => {
    mockApi("admin");
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: "Nhãn mới" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Tên"), { target: { value: "Khẩn" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Chọn màu: #3b82f6" }));
    const palette = await screen.findByRole("dialog", { name: "Bảng màu" });
    fireEvent.change(within(palette).getByLabelText("Mã màu"), { target: { value: "#12" } });
    expect(within(dialog).getByText("Màu là mã hex 6 chữ số, ví dụ #3b82f6.")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Tạo nhãn" }));
    expect(writes()).toHaveLength(0);
  });

  it("deletes only after a confirmation that says how many tasks lose the label", async () => {
    mockApi("admin");
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: "Thao tác với Bug" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Xóa" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Xóa nhãn Bug?");
    expect(dialog).toHaveTextContent("Nhãn sẽ được gỡ khỏi 12 công việc.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Xóa" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ path: "/api/v1/workspaces/ws1/task-labels/l-bug", method: "DELETE" });
  });

  it("points an admin at the first label when there is none", async () => {
    mockApi("admin", []);
    renderTab();
    expect(await screen.findByText("Chưa có nhãn nào. Tạo nhãn đầu tiên.")).toBeInTheDocument();
  });
});
