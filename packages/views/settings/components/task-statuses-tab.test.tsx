import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { requestMock, wrap } from "../../test/api-mock";
import { WorkspaceProvider } from "../../layout/workspace-context";
import { statusKeyFrom, TaskStatusesTab } from "./task-statuses-tab";

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

const BUILT_INS = ["backlog", "todo", "in_progress", "in_review", "done", "blocked", "cancelled"];

const status = (over: Record<string, unknown>) => ({
  organization_id: "o1",
  workspace_id: "ws1",
  description: "",
  color: "#6b7280",
  is_system: false,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
  ...over,
});

const POSITIONS: Record<string, number> = {
  backlog: 0,
  todo: 1024,
  in_progress: 2048,
  in_review: 3072,
  blocked: 3584,
  done: 4096,
  cancelled: 6144,
};

const statuses = [
  ...BUILT_INS.map((key) =>
    status({ id: `sys-${key}`, key, name: key, category: key, is_system: true, position: POSITIONS[key] }),
  ),
  status({ id: "s-qa", key: "cho_duyet_ab12", name: "Chờ duyệt", category: "in_review", position: 3073, description: "Đợi QA" }),
  status({ id: "s-uat", key: "uat_cd34", name: "UAT", category: "in_review", position: 3074 }),
];

type Init = { method?: string; body?: unknown } | undefined;

function mockApi(role: string, onWrite?: (path: string, init: Init) => Promise<unknown>) {
  requestMock.mockImplementation((path: string, init?: Init) => {
    if (path.endsWith("/me")) return Promise.resolve({ membership: { user_id: "u1", role, source: "membership" } });
    if (init?.method) return onWrite ? onWrite(path, init) : Promise.resolve({});
    if (path.includes("/task-statuses")) return Promise.resolve({ statuses, categories: BUILT_INS, total: statuses.length });
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
        <TaskStatusesTab />
      </WorkspaceProvider>,
    ),
  );
}

describe("statusKeyFrom", () => {
  it("folds Vietnamese into the key alphabet the server accepts", () => {
    expect(statusKeyFrom("Chờ duyệt", "x7k2")).toBe("cho_duyet_x7k2");
    expect(statusKeyFrom("Đã giao — QA", "a1")).toBe("da_giao_qa_a1");
    expect(statusKeyFrom("🙂", "b2")).toBe("status_b2");
  });

  it("stays inside the server's 32-character key", () => {
    const key = statusKeyFrom("Một trạng thái có cái tên rất là dài dòng", "zzzz");
    expect(key).toMatch(/^[a-z0-9][a-z0-9_]{0,31}$/);
  });
});

describe("TaskStatusesTab", () => {
  beforeEach(() => {
    resetAuthStoreForTests();
    setSessionUser(user);
    requestMock.mockReset();
  });

  const openMenu = async (name: string) => {
    fireEvent.click(await screen.findByRole("button", { name: `Thao tác cho ${name}` }));
    return screen.findByRole("menu");
  };

  it("heads the page like UniAI: workspace chip and the drag hint", async () => {
    mockApi("admin");
    renderTab();
    expect(await screen.findByRole("heading", { name: /Trạng thái công việc/ })).toHaveTextContent("Workspace Team");
    expect(await screen.findByText("Kéo thả trong cùng một nhóm để sắp xếp lại bảng, danh sách và menu.")).toBeInTheDocument();
  });

  it("lists the four groups in one card, statuses in position order", async () => {
    mockApi("member");
    renderTab();
    await screen.findByText("Chờ duyệt");
    const card = screen.getByTestId("task-status-groups");
    for (const group of ["Chưa bắt đầu", "Đã bắt đầu", "Hoàn thành", "Đã đóng"]) {
      expect(within(card).getByRole("heading", { name: group })).toBeInTheDocument();
    }
    const started = within(screen.getByRole("list", { name: "Đã bắt đầu" })).getAllByRole("listitem");
    expect(started.map((row) => row.querySelector("[data-slot=status-name]")?.textContent)).toEqual([
      "Đang làm",
      "Đang review",
      "Chờ duyệt",
      "UAT",
      "Đang chặn",
    ]);
    expect(screen.queryByText("Hệ thống")).not.toBeInTheDocument();
  });

  it("shows a member every group read-only", async () => {
    mockApi("member");
    renderTab();
    expect(await screen.findByText("Chờ duyệt")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Thêm trạng thái/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Thao tác cho/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Sắp xếp lại/ })).not.toBeInTheDocument();
  });

  it("gives every row of a multi-status group a drag handle, and none to a group of one", async () => {
    mockApi("admin");
    renderTab();
    expect(await screen.findByRole("button", { name: "Sắp xếp lại Đang chặn" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sắp xếp lại Backlog" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sắp xếp lại Hoàn thành" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Thao tác cho Hoàn thành" })).toBeInTheDocument();
  });

  it("offers a built-in only the moves, saying why it cannot be edited or archived", async () => {
    mockApi("admin");
    renderTab();
    const menu = await openMenu("Backlog");
    expect(within(menu).getByRole("menuitem", { name: "Di chuyển lên" })).toHaveAttribute("aria-disabled", "true");
    expect(within(menu).getByRole("menuitem", { name: "Di chuyển xuống" })).not.toHaveAttribute("aria-disabled", "true");
    expect(within(menu).getByRole("menuitem", { name: "Sửa" })).toHaveAttribute("aria-disabled", "true");
    expect(within(menu).getByRole("menuitem", { name: "Lưu trữ" })).toHaveAttribute("aria-disabled", "true");
    expect(menu).toHaveTextContent("Trạng thái có sẵn điều khiển hành vi hệ thống nên không sửa hay lưu trữ được. Bạn vẫn sắp xếp lại được.");
  });

  it("moves a built-in within its group, sending the whole group", async () => {
    mockApi("admin", () => Promise.resolve({ statuses: [], total: 0 }));
    renderTab();
    const menu = await openMenu("Đang chặn");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Di chuyển lên" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({
      path: "/api/v1/workspaces/ws1/task-statuses/reorder",
      method: "PATCH",
      body: { group: "started", ids: ["sys-in_progress", "sys-in_review", "s-qa", "sys-blocked", "s-uat"] },
    });
  });

  it("creates a status in the group it was added from, with its icon and an ASCII key", async () => {
    mockApi("admin", () => Promise.resolve({ status: statuses[7] }));
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: "Thêm trạng thái: Đã bắt đầu" }));
    const dialog = await screen.findByRole("dialog", { name: "Trạng thái mới" });
    expect(within(dialog).getByRole("combobox", { name: "Nhóm" })).toHaveTextContent("Đã bắt đầu");
    expect(dialog).toHaveTextContent("Công việc đang làm, đang review hoặc bị chặn.");
    fireEvent.change(within(dialog).getByLabelText("Tên"), { target: { value: "Chờ khách duyệt" } });
    expect(within(dialog).getByRole("button", { name: "Mặc định" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(dialog).getByRole("button", { name: "Biểu tượng Hoàn thành" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Lưu" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({
      path: "/api/v1/workspaces/ws1/task-statuses",
      method: "POST",
      body: { name: "Chờ khách duyệt", category: "in_progress", icon: "done", color: "#3b82f6", description: "" },
    });
    expect((writes()[0]!.body as { key: string }).key).toMatch(/^cho_khach_duyet_[a-z0-9]+$/);
  });

  it("says when the name is already taken and keeps the dialog open", async () => {
    mockApi("admin", () => Promise.reject(new ApiError("taken", "conflict", 409)));
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: "Thêm trạng thái: Chưa bắt đầu" }));
    const dialog = await screen.findByRole("dialog", { name: "Trạng thái mới" });
    fireEvent.change(within(dialog).getByLabelText("Tên"), { target: { value: "UAT" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Lưu" }));
    expect(await within(dialog).findByText("Tên này đã có trong workspace. Chọn tên khác.")).toBeInTheDocument();
  });

  it("keeps a status's category when its group stays, and moves it with the group", async () => {
    mockApi("admin", () => Promise.resolve({ status: statuses[7] }));
    renderTab();
    const menu = await openMenu("Chờ duyệt");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Sửa" }));
    const dialog = await screen.findByRole("dialog", { name: "Sửa trạng thái" });
    const group = within(dialog).getByRole("combobox", { name: "Nhóm" });
    expect(group).toHaveTextContent("Đã bắt đầu");
    fireEvent.click(group);
    const option = await screen.findByRole("option", { name: "Hoàn thành" });
    fireEvent.pointerDown(option);
    fireEvent.click(option);
    await waitFor(() => expect(group).toHaveTextContent("Hoàn thành"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Lưu" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({
      path: "/api/v1/workspaces/ws1/task-statuses/s-qa",
      method: "PATCH",
      body: { name: "Chờ duyệt", description: "Đợi QA", category: "done", icon: "" },
    });
  });

  it("archives a custom status only after a confirmation", async () => {
    mockApi("admin");
    renderTab();
    const menu = await openMenu("UAT");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Lưu trữ" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Lưu trữ trạng thái UAT?");
    expect(writes()).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Lưu trữ" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ path: "/api/v1/workspaces/ws1/task-statuses/s-uat", method: "DELETE" });
  });
});
