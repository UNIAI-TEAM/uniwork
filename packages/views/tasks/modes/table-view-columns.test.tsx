import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { getTaskSurfaceViewStore } from "@uniwork/core/tasks/stores/surface-view-store";
import type { TableColumnKey } from "@uniwork/core/tasks/stores/view-store";
import type { User, Workspace } from "@uniwork/core/types";
import { requestMock, wrap } from "../../test/api-mock";
import { WorkspaceProvider } from "../../layout/workspace-context";
import { NavigationProvider, type NavigationAdapter } from "../../navigation";
import { TaskSurface } from "../surface/task-surface";
import { tableCellRenderCounter } from "./table-task-cell";

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

const COLUMN_LEFT: Record<string, number> = {
  title: 40,
  status: 400,
  priority: 550,
  assignee: 680,
  due_date: 860,
  labels: 1000,
};

/** jsdom lays nothing out; dnd-kit's keyboard sensor needs each column's box. */
function stubColumnRects(): () => void {
  const original = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const left = COLUMN_LEFT[this.getAttribute("data-column-id") ?? ""];
    if (left === undefined) return original.call(this);
    return { x: left, y: 0, left, top: 0, width: 120, height: 32, right: left + 120, bottom: 32, toJSON: () => ({}) } as DOMRect;
  };
  return () => {
    HTMLElement.prototype.getBoundingClientRect = original;
  };
}

describe("bảng: độ rộng mặc định đọc được", () => {
  it("mỗi cột có độ rộng mặc định theo loại", async () => {
    await renderTable(["identifier", "project", "start_date", "created_at", "property:p1"]);
    const table = document.querySelector("table") as HTMLTableElement;
    const width = (id: string) =>
      table.style.getPropertyValue(`--col-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}-size`);
    expect({
      status: width("status"),
      priority: width("priority"),
      assignee: width("assignee"),
      due_date: width("due_date"),
      labels: width("labels"),
      identifier: width("identifier"),
      project: width("project"),
      start_date: width("start_date"),
      created_at: width("created_at"),
      property: width("property:p1"),
    }).toEqual({
      status: "148px",
      priority: "152px",
      assignee: "176px",
      due_date: "152px",
      labels: "180px",
      identifier: "96px",
      project: "168px",
      start_date: "152px",
      created_at: "152px",
      property: "160px",
    });
  });

  it("dòng dữ liệu cao 40px, lưới chỉ kẻ ngang trừ mép cột ghim", async () => {
    const { row } = await renderTable();
    expect(row).toHaveClass("h-10");
    expect(cell(row, "title")).toHaveClass("border-r");
    expect(cell(row, "status")).not.toHaveClass("border-r");
  });
});

describe("bảng: nhãn theo hàng, không N+1", () => {
  it("bảng 30 hàng không gửi yêu cầu nào tới đường dẫn kết thúc bằng /labels", async () => {
    const base = requestMock.getMockImplementation()!;
    const manyRows = Array.from({ length: 30 }, (_, i) => ({
      task: { ...task, id: `t${i + 1}`, title: `Task ${i + 1}` },
      direct_child_count: 0,
      labels: [{ id: "l1", name: "Bug", color: "#ef4444" }],
    }));
    requestMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path.includes("/tasks/table/rows")) {
        return {
          query_fingerprint: "fp-rows",
          group_key: null,
          parent_id: null,
          total: manyRows.length,
          rows: manyRows,
          next_cursor: null,
        };
      }
      return base(path, init);
    });
    await renderTable();
    await screen.findByText("Task 30");
    // `endsWith("/labels")` only catches GET-list and POST-attach
    // (`/tasks/{id}/labels`); a DELETE detach is `/tasks/{id}/labels/{labelId}`
    // and would not match — this render never toggles, so it doesn't matter here.
    expect(
      requestMock.mock.calls.filter(([path]) => (path as string).endsWith("/labels")),
    ).toHaveLength(0);
  });
});

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
    fireEvent.click(within(header).getByRole("button", { name: /^Mức độ/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Giảm dần/i }));
    expect(store.getState().sortBy).toBe("property:p1");
    expect(store.getState().sortDirection).toBe("desc");
  });

  it("cột multi_select không có mục sắp xếp, chỉ Ẩn cột", async () => {
    await renderTable(["property:p3"]);
    const header = await screen.findByRole("columnheader", { name: /Thẻ/ });
    fireEvent.click(within(header).getByRole("button", { name: /^Thẻ/ }));
    await screen.findByRole("menuitem", { name: "Ẩn cột" });
    expect(screen.queryByRole("menuitem", { name: /dần/i })).toBeNull();
  });

  it("Tăng dần trên header Ngày bắt đầu sắp theo start_date", async () => {
    const { store } = await renderTable(["start_date"]);
    const header = await screen.findByRole("columnheader", { name: /Ngày bắt đầu/ });
    fireEvent.click(within(header).getByRole("button", { name: /^Ngày bắt đầu/ }));
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
  it("ô dự án có project_id nhưng không có trong danh sách dự án hiện —", async () => {
    const base = requestMock.getMockImplementation()!;
    requestMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path.includes("/tasks/table/rows")) {
        const page = (await base(path, init)) as { rows: Array<{ task: object }> };
        return { ...page, rows: [{ ...page.rows[0], task: { ...task, project_id: "pr-gone" } }] };
      }
      return base(path, init);
    });
    const { row } = await renderTable(["project"]);
    expect(
      await within(cell(row, "project")).findByRole("button", { name: "Dự án: —" }),
    ).toBeInTheDocument();
  });

  it("bỏ giao người phụ trách gửi assignee_id null, assignee_kind human", async () => {
    const base = requestMock.getMockImplementation()!;
    requestMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path.includes("/tasks/table/rows")) {
        const page = (await base(path, init)) as { rows: Array<{ task: object }> };
        return {
          ...page,
          rows: [{ ...page.rows[0], task: { ...task, assignee_id: "a1", assignee_kind: "agent" } }],
        };
      }
      return base(path, init);
    });
    const { row } = await renderTable();
    fireEvent.click(within(cell(row, "assignee")).getByRole("combobox"));
    fireEvent.click(await screen.findByRole("option", { name: /Chưa giao/ }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/tasks/t1", {
        method: "PATCH",
        body: { assignee_id: null, assignee_kind: "human" },
      }),
    );
  });

  it("kéo cột bằng bàn phím đổi thứ tự cột trong store; cột tiêu đề không có nút kéo", async () => {
    const { store } = await renderTable();
    expect(screen.queryByRole("button", { name: "Di chuyển cột Tiêu đề" })).toBeNull();
    const restoreRects = stubColumnRects();
    try {
      const grip = await screen.findByRole("button", { name: "Di chuyển cột Trạng thái" });
      grip.focus();
      fireEvent.keyDown(grip, { code: "Space" });
      // dnd-kit binds its move/drop keys on the next tick after the pick-up.
      await new Promise((resolve) => setTimeout(resolve, 0));
      fireEvent.keyDown(grip, { code: "ArrowRight" });
      fireEvent.keyDown(grip, { code: "Space" });
    } finally {
      restoreRects();
    }
    await waitFor(() =>
      expect(store.getState().tableColumns.map((column) => column.key).slice(0, 3)).toEqual([
        "title",
        "priority",
        "status",
      ]),
    );
  });
});

describe("bảng: chọn hàng chỉ render lại ô chọn", () => {
  function serveRows(count: number) {
    const base = requestMock.getMockImplementation()!;
    const rows = Array.from({ length: count }, (_, i) => ({
      task: { ...task, id: `t${i + 1}`, title: `Task ${i + 1}` },
      direct_child_count: 0,
      labels: [],
    }));
    requestMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path.includes("/tasks/table/rows")) {
        return {
          query_fingerprint: "fp-rows",
          group_key: null,
          parent_id: null,
          total: rows.length,
          rows,
          next_cursor: null,
        };
      }
      return base(path, init);
    });
  }

  const settle = (ms: number) =>
    act(() => new Promise((resolve) => setTimeout(resolve, ms)));

  const rowCheckbox = (title: string) =>
    within(screen.getByText(title).closest("tr") as HTMLElement).getByRole("checkbox", {
      name: "Chọn công việc",
    }) as HTMLInputElement;

  it("tick một hàng trong bảng 50 hàng không render lại ô dữ liệu nào", async () => {
    // 50 rows virtualize; jsdom lays nothing out, so give the virtualizer a
    // viewport and each row a height or it renders no rows at all.
    const original = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      const height = this.tagName === "TR" ? 40 : 4000;
      return { x: 0, y: 0, left: 0, top: 0, width: 1200, height, right: 1200, bottom: height, toJSON: () => ({}) } as DOMRect;
    };
    const viewport = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(4000);
    const viewportWidth = vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(1200);
    try {
      serveRows(50);
      await renderTable();
      await screen.findByText("Task 2");
      await settle(200);

      const before = tableCellRenderCounter.count;
      expect(before).toBeGreaterThan(0);
      fireEvent.click(rowCheckbox("Task 2"));

      await waitFor(() => expect(rowCheckbox("Task 2").checked).toBe(true));
      await settle(50);
      expect(tableCellRenderCounter.count).toBe(before);
      expect(rowCheckbox("Task 1").checked).toBe(false);
    } finally {
      HTMLElement.prototype.getBoundingClientRect = original;
      viewport.mockRestore();
      viewportWidth.mockRestore();
    }
  });

  it("chọn tất cả ở header tick mọi hàng, bấm lại bỏ tick", async () => {
    serveRows(3);
    await renderTable();
    await screen.findByText("Task 3");
    const all = screen.getByRole("checkbox", { name: "Chọn tất cả công việc" }) as HTMLInputElement;

    fireEvent.click(rowCheckbox("Task 1"));
    await waitFor(() => expect(all.indeterminate).toBe(true));
    expect(all.checked).toBe(false);

    fireEvent.click(all);
    await waitFor(() => expect(all.checked).toBe(true));
    for (const title of ["Task 1", "Task 2", "Task 3"]) {
      expect(rowCheckbox(title).checked).toBe(true);
    }
    expect(all.indeterminate).toBe(false);

    fireEvent.click(all);
    await waitFor(() => expect(all.checked).toBe(false));
    for (const title of ["Task 1", "Task 2", "Task 3"]) {
      expect(rowCheckbox(title).checked).toBe(false);
    }
  });

  it("đang chọn hàng thì cuối vùng cuộn có khoảng đệm cho thanh thao tác, không render lại ô", async () => {
    serveRows(3);
    await renderTable();
    await screen.findByText("Task 3");
    const spacer = () =>
      document.querySelector('[data-slot="task-table-selection-spacer"]');
    expect(spacer()).toBeNull();

    const before = tableCellRenderCounter.count;
    fireEvent.click(rowCheckbox("Task 1"));
    await waitFor(() => expect(spacer()).not.toBeNull());
    // Inside the scroll surface, after the rows, so "Tải thêm" scrolls clear.
    expect(spacer()!.closest("table")).not.toBeNull();
    expect(tableCellRenderCounter.count).toBe(before);

    fireEvent.click(rowCheckbox("Task 1"));
    await waitFor(() => expect(spacer()).toBeNull());
  });

  it("shift-click chọn cả dải từ hàng neo", async () => {
    serveRows(5);
    await renderTable();
    await screen.findByText("Task 5");

    fireEvent.click(rowCheckbox("Task 2"));
    await waitFor(() => expect(rowCheckbox("Task 2").checked).toBe(true));
    fireEvent.click(rowCheckbox("Task 4"), { shiftKey: true });

    await waitFor(() => expect(rowCheckbox("Task 4").checked).toBe(true));
    expect(rowCheckbox("Task 3").checked).toBe(true);
    expect(rowCheckbox("Task 1").checked).toBe(false);
    expect(rowCheckbox("Task 5").checked).toBe(false);
  });
});
