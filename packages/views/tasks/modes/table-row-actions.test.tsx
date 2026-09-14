import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { getTaskSurfaceViewStore } from "@uniwork/core/tasks/stores/surface-view-store";
import type { User, Workspace } from "@uniwork/core/types";
import { copyText } from "@uniwork/ui/lib/clipboard";
import { requestMock, wrap } from "../../test/api-mock";
import { chooseInSubmenu, chooseItem, type Via } from "../../test/menu-interactions";
import { WorkspaceProvider } from "../../layout/workspace-context";
import { NavigationProvider, type NavigationAdapter } from "../../navigation";
import { TaskSurface } from "../surface/task-surface";

// Renders the real TaskSurface → TableView → DataTable, so a click on a menu
// item has to get past DataTable's own row handler and table-view.tsx's
// `closest("button, input, a, [role='menuitem']")` filter, not a stand-in div.

initI18n();

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("@uniwork/ui/lib/clipboard", () => ({ copyText: vi.fn(async () => true) }));

const task = (over: Record<string, unknown>) => ({
  id: "t1",
  workspace_id: "w1",
  title: "Task 1",
  description: "",
  status: "todo",
  priority: "medium",
  position: 1,
  created_by: "u1",
  created_at: "2026-09-06T00:00:00Z",
  updated_at: "2026-09-06T00:00:00Z",
  ...over,
});

const user: User = {
  id: "u1",
  email: "an@example.com",
  display_name: "An Nguyễn",
  onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};

const workspace: Workspace = {
  id: "w1",
  slug: "team",
  name: "Team",
  organization_id: "o1",
  organization_slug: "acme",
  organization_name: "Acme",
};

const nav: NavigationAdapter = {
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  pathname: "/",
  searchParams: new URLSearchParams(),
  getShareableUrl: (path) => path,
};

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockImplementation(async (path: string) => {
    if (path.includes("/tasks/table/groups")) {
      return {
        query_fingerprint: "fp-groups",
        total: 1,
        groups: [{ key: "status:todo", value: { kind: "status", status: "todo" }, count: 1 }],
        next_cursor: null,
      };
    }
    if (path.includes("/tasks/table/rows")) {
      return {
        query_fingerprint: "fp-rows",
        group_key: "status:todo",
        parent_id: null,
        total: 1,
        rows: [{ task: task({}), direct_child_count: 0 }],
        branch_total: 1,
        next_cursor: null,
      };
    }
    if (path.includes("/tasks/table/facets")) {
      return { query_fingerprint: "fp-facets", total: 1, facets: [] };
    }
    if (path.includes("/members")) {
      return {
        members: [
          { workspace_id: "w1", user_id: "u1", role: "member", email: "an@example.com", display_name: "An Nguyễn" },
          { workspace_id: "w1", user_id: "u2", role: "member", email: "binh@example.com", display_name: "Bình Trần" },
        ],
      };
    }
    return { tasks: [task({})], total: 1, limit: 50, offset: 0 };
  });
});

let renderIndex = 0;

async function renderTable() {
  renderIndex += 1;
  const surfaceKey = `table-row-actions-${renderIndex}`;
  getTaskSurfaceViewStore(surfaceKey).getState().setTableGrouping("status");
  const onOpenTask = vi.fn<(id: string) => void>();
  render(
    wrap(
      <NavigationProvider value={nav}>
        <WorkspaceProvider workspace={workspace} user={user}>
          <TaskSurface
            workspaceId="w1"
            scope={{ type: "workspace" }}
            modes={["table"]}
            surfaceKey={surfaceKey}
            onOpenTask={onOpenTask}
          />
        </WorkspaceProvider>
      </NavigationProvider>,
    ),
  );
  const row = (await screen.findByText("Task 1")).closest("tr") as HTMLElement;
  return { onOpenTask, row };
}

async function openKebab(row: HTMLElement) {
  fireEvent.click(within(row).getByRole("button", { name: "Thêm thao tác" }));
  return screen.findByRole("menu");
}

const batchDeleteCalls = () =>
  requestMock.mock.calls.filter(
    ([path]) => typeof path === "string" && path.includes("batch-delete"),
  );

describe("bảng: nút ba chấm trong cột __add không mở task", () => {
  it("đối chứng: bấm vào hàng vẫn mở task qua bộ lọc thật", async () => {
    const { onOpenTask, row } = await renderTable();
    fireEvent.click(row);
    expect(onOpenTask).toHaveBeenCalledWith("t1");
  });

  it("nút ba chấm nằm trong ô cột __add", async () => {
    const { row } = await renderTable();
    const kebab = within(row).getByRole("button", { name: "Thêm thao tác" });
    expect(kebab.closest("td")).toHaveAttribute("data-column-id", "__add");
  });

  it("bấm nút ba chấm không mở task", async () => {
    const { onOpenTask, row } = await renderTable();
    await openKebab(row);
    expect(onOpenTask).not.toHaveBeenCalled();
  });

  it.each<Via>(["mouse", "keyboard"])("Mở gọi onOpenTask đúng một lần (%s)", async (via) => {
    const { onOpenTask, row } = await renderTable();
    const menu = await openKebab(row);
    await chooseItem(menu, "Mở", via);
    expect(onOpenTask).toHaveBeenCalledTimes(1);
  });

  it.each<Via>(["mouse", "keyboard"])("Sao chép liên kết (%s)", async (via) => {
    const { onOpenTask, row } = await renderTable();
    const menu = await openKebab(row);
    await chooseItem(menu, "Sao chép liên kết", via);
    await waitFor(() => expect(copyText).toHaveBeenCalledWith("/acme/team/tasks/t1"));
    expect(onOpenTask).not.toHaveBeenCalled();
  });

  it.each<Via>(["mouse", "keyboard"])("đổi trạng thái (%s)", async (via) => {
    const { onOpenTask, row } = await renderTable();
    const menu = await openKebab(row);
    await chooseInSubmenu(menu, "Đổi trạng thái", "Đang làm", via);
    expect(onOpenTask).not.toHaveBeenCalled();
  });

  it.each<Via>(["mouse", "keyboard"])("đổi người phụ trách (%s)", async (via) => {
    const { onOpenTask, row } = await renderTable();
    const menu = await openKebab(row);
    await chooseInSubmenu(menu, "Đổi người phụ trách", "Bình Trần", via);
    expect(onOpenTask).not.toHaveBeenCalled();
  });

  it("middle-click lên mục trong menu con không mở task", async () => {
    // DataTable forwards auxclick button 1 to onRowClick, and menuitemradio is
    // not in table-view.tsx's closest() filter.
    const { onOpenTask, row } = await renderTable();
    const menu = await openKebab(row);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Đổi trạng thái" }));
    const radio = await screen.findByRole("menuitemradio", { name: "Đang làm" });
    fireEvent(radio, new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    expect(onOpenTask).not.toHaveBeenCalled();
  });

  it.each<Via>(["mouse", "keyboard"])("Xóa chỉ xóa khi xác nhận, không mở task (%s)", async (via) => {
    const { onOpenTask, row } = await renderTable();
    const menu = await openKebab(row);
    await chooseItem(menu, "Xóa", via);
    const dialog = await screen.findByRole("alertdialog");
    expect(batchDeleteCalls()).toHaveLength(0);

    fireEvent.click(within(dialog).getByText("Xóa task này?"));
    expect(onOpenTask).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Xóa task" }));
    await waitFor(() => expect(batchDeleteCalls()).toHaveLength(1));
    expect(onOpenTask).not.toHaveBeenCalled();
  });

  it("Hủy trong hộp thoại xóa không gọi xóa và không mở task", async () => {
    const { onOpenTask, row } = await renderTable();
    const menu = await openKebab(row);
    await chooseItem(menu, "Xóa", "mouse");
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Hủy" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(batchDeleteCalls()).toHaveLength(0);
    expect(onOpenTask).not.toHaveBeenCalled();
  });
});
