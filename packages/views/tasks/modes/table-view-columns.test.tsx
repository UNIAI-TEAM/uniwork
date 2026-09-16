import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { getTaskSurfaceViewStore } from "@uniwork/core/tasks/stores/surface-view-store";
import type { TableColumnKey } from "@uniwork/core/tasks/stores/view-store";
import type { User, Workspace } from "@uniwork/core/types";
import { requestMock, wrap } from "../../test/api-mock";
import { WorkspaceProvider } from "../../layout/workspace-context";
import { NavigationProvider, type NavigationAdapter } from "../../navigation";
import { TaskSurface } from "../surface/task-surface";

// The real TaskSurface → TableView → DataTable against a fake API: each edit
// has to reach the request it is meant to send, through the table's own meta.

initI18n();

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const task = {
  id: "t1",
  workspace_id: "w1",
  title: "Task 1",
  description: "",
  status: "todo",
  priority: "medium",
  position: 1,
  created_by: "u1",
  start_date: "2026-09-06",
  properties: { p1: "o1" },
  created_at: "2026-09-06T00:00:00Z",
  updated_at: "2026-09-06T00:00:00Z",
};

const property = (over: Record<string, unknown>) => ({
  organization_id: "o1",
  workspace_id: "w1",
  description: "",
  position: 0,
  usage_count: 0,
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
  config: {},
  ...over,
});

const properties = [
  property({
    id: "p1",
    name: "Mức độ",
    type: "select",
    config: {
      options: [
        { id: "o1", name: "Thấp", color: "#22c55e" },
        { id: "o2", name: "Cao", color: "#ef4444" },
      ],
    },
  }),
  property({ id: "p2", name: "Ghi chú", type: "text" }),
  property({ id: "p3", name: "Thẻ", type: "multi_select" }),
  property({ id: "p9", name: "Cũ", type: "text", archived_at: "2026-09-02T00:00:00Z" }),
];

const project = {
  id: "pr1",
  organization_id: "o1",
  workspace_id: "w1",
  title: "Ra mắt",
  description: "",
  status: "active",
  priority: "medium",
  revision: 1,
  task_count: 0,
  done_count: 0,
  resource_count: 0,
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
};

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
  requestMock.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (init?.method === "PATCH" || init?.method === "PUT" || init?.method === "DELETE") {
      return null;
    }
    if (path.includes("/tasks/table/rows")) {
      return {
        query_fingerprint: "fp-rows",
        group_key: null,
        parent_id: null,
        total: 1,
        rows: [{ task, direct_child_count: 0, labels: [] }],
        next_cursor: null,
      };
    }
    if (path.includes("/tasks/table/facets")) {
      return { query_fingerprint: "fp-facets", total: 1, facets: [] };
    }
    if (path.includes("/task-properties")) {
      return { properties, total: properties.length };
    }
    if (path.includes("/projects")) return { projects: [project], total: 1 };
    if (path.includes("/agents")) {
      return {
        agents: [
          {
            id: "a1",
            organization_id: "o1",
            name: "Trợ lý QA",
            handle: "qa",
            status: "active",
            owner_user_id: "u1",
          },
        ],
      };
    }
    if (path.includes("/members")) {
      return {
        members: [
          { workspace_id: "w1", user_id: "u1", role: "member", email: "an@example.com", display_name: "An Nguyễn" },
        ],
      };
    }
    return { tasks: [task], total: 1, limit: 50, offset: 0 };
  });
});

let renderIndex = 0;

async function renderTable(columns: TableColumnKey[] = []) {
  renderIndex += 1;
  const surfaceKey = `table-view-columns-${renderIndex}`;
  const store = getTaskSurfaceViewStore(surfaceKey);
  for (const key of columns) store.getState().toggleTableColumn(key);
  render(
    wrap(
      <NavigationProvider value={nav}>
        <WorkspaceProvider workspace={workspace} user={user}>
          <TaskSurface
            workspaceId="w1"
            scope={{ type: "workspace" }}
            modes={["table"]}
            surfaceKey={surfaceKey}
            onOpenTask={vi.fn()}
          />
        </WorkspaceProvider>
      </NavigationProvider>,
    ),
  );
  const row = (await screen.findByText("Task 1")).closest("tr") as HTMLElement;
  return { store, row };
}

const cell = (row: HTMLElement, column: string) =>
  row.querySelector(`td[data-column-id="${column}"]`) as HTMLElement;

const callsTo = (method: string) =>
  requestMock.mock.calls.filter(
    ([, init]) => (init as { method?: string } | undefined)?.method === method,
  );

describe("bảng: cột thuộc tính, dự án, ngày bắt đầu, agent", () => {
  it("ô thuộc tính select gửi PUT giá trị với id lựa chọn", async () => {
    const { row } = await renderTable(["property:p1"]);
    const trigger = await within(cell(row, "property:p1")).findByRole("button", {
      name: "Mức độ: Thấp",
    });
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Cao" }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/tasks/t1/properties/p1", {
        method: "PUT",
        body: { value: "o2" },
      }),
    );
  });

  it("header cột thuộc tính hiện tên thuộc tính", async () => {
    await renderTable(["property:p1"]);
    expect(
      await screen.findByRole("columnheader", { name: /Mức độ/ }),
    ).toBeInTheDocument();
  });

  it("cột thuộc tính không còn trong danh mục: header Chưa có, ô —", async () => {
    const { row } = await renderTable(["property:gone"]);
    await screen.findByRole("columnheader", { name: /Mức độ|Chưa có/ });
    await waitFor(() =>
      expect(screen.getByRole("columnheader", { name: /Chưa có/ })).toBeInTheDocument(),
    );
    expect(cell(row, "property:gone")).toHaveTextContent("—");
  });

  it("ô dự án gửi project_id", async () => {
    const { row } = await renderTable(["project"]);
    const trigger = await within(cell(row, "project")).findByRole("button", {
      name: "Dự án: Không có dự án",
    });
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Ra mắt" }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/tasks/t1", {
        method: "PATCH",
        body: { project_id: "pr1" },
      }),
    );
  });

  it("ô ngày bắt đầu gửi start_date", async () => {
    const { row } = await renderTable(["start_date"]);
    fireEvent.click(within(cell(row, "start_date")).getByRole("button"));
    fireEvent.click(await screen.findByText("Bỏ chọn ngày"));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/tasks/t1", {
        method: "PATCH",
        body: { start_date: null },
      }),
    );
  });

  it("giao cho agent gửi assignee_kind agent", async () => {
    const { row } = await renderTable();
    fireEvent.click(within(cell(row, "assignee")).getByRole("combobox"));
    fireEvent.click(await screen.findByRole("option", { name: /Trợ lý QA/ }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/tasks/t1", {
        method: "PATCH",
        body: { assignee_id: "a1", assignee_kind: "agent" },
      }),
    );
  });

  it("Giảm dần trên header cột thuộc tính sắp theo property:<id> giảm dần", async () => {
    const { store } = await renderTable(["property:p1"]);
    const header = await screen.findByRole("columnheader", { name: /Mức độ/ });
    fireEvent.click(within(header).getByRole("button", { name: /Mức độ/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Giảm dần/i }));
    expect(store.getState().sortBy).toBe("property:p1");
    expect(store.getState().sortDirection).toBe("desc");
  });

  it("cột multi_select không có mục sắp xếp, chỉ Ẩn cột", async () => {
    await renderTable(["property:p3"]);
    const header = await screen.findByRole("columnheader", { name: /Thẻ/ });
    fireEvent.click(within(header).getByRole("button", { name: /Thẻ/ }));
    await screen.findByRole("menuitem", { name: "Ẩn cột" });
    expect(screen.queryByRole("menuitem", { name: /dần/i })).toBeNull();
  });

  it("Tăng dần trên header Ngày bắt đầu sắp theo start_date", async () => {
    const { store } = await renderTable(["start_date"]);
    const header = await screen.findByRole("columnheader", { name: /Ngày bắt đầu/ });
    fireEvent.click(within(header).getByRole("button", { name: /Ngày bắt đầu/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Tăng dần/i }));
    expect(store.getState().sortBy).toBe("start_date");
    expect(store.getState().sortDirection).toBe("asc");
  });

  it("bộ chọn cột bật cột thuộc tính, không liệt kê thuộc tính đã lưu trữ", async () => {
    const { store } = await renderTable();
    fireEvent.click(screen.getByRole("button", { name: "Thêm cột" }));
    const item = await screen.findByRole("menuitemcheckbox", { name: "Ghi chú" });
    expect(screen.queryByRole("menuitemcheckbox", { name: "Cũ" })).toBeNull();
    fireEvent.click(item);
    expect(store.getState().tableColumns.map((column) => column.key)).toContain("property:p2");
    expect(callsTo("PUT")).toHaveLength(0);
  });
});
