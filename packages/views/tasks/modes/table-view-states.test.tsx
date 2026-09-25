import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { LocaleAdapterProvider } from "@uniwork/core/i18n/react";
import { taskKeys } from "@uniwork/core/tasks";
import { getTaskSurfaceViewStore } from "@uniwork/core/tasks/stores/surface-view-store";
import type { TableGrouping } from "@uniwork/core/tasks/stores/view-store";
import type { User, Workspace } from "@uniwork/core/types";
import { localeAdapter, wrap } from "../../test/api-mock";
import { serveTableCursor } from "../../test/table-cursor-server";
import { WorkspaceProvider } from "../../layout/workspace-context";
import { NavigationProvider, type NavigationAdapter } from "../../navigation";
import { TaskSurface } from "../surface/task-surface";

// The table's failure, empty and refreshing states, through the real
// TaskSurface → TableView against the fake cursor table API.

initI18n();

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

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

const LONG = { timeout: 3000 };
const SEARCH_DEBOUNCE_MS = 300;

afterEach(() => {
  vi.useRealTimers();
});

const statusGroups = () => [
  { key: "status:todo", value: { kind: "status", status: "todo" }, count: 1 },
  { key: "status:done", value: { kind: "status", status: "done" }, count: 1 },
];

let renderIndex = 0;

function renderTable(grouping: TableGrouping, client?: QueryClient) {
  renderIndex += 1;
  const surfaceKey = `table-view-states-${renderIndex}`;
  const store = getTaskSurfaceViewStore(surfaceKey);
  store.getState().setTableGrouping(grouping);
  const surface = (
    <NavigationProvider value={nav}>
      <WorkspaceProvider workspace={workspace} user={user}>
        <TaskSurface
          workspaceId="w1"
          scope={{ type: "workspace" }}
          modes={["table"]}
          surfaceKey={surfaceKey}
        />
      </WorkspaceProvider>
    </NavigationProvider>
  );
  render(
    client ? (
      <QueryClientProvider client={client}>
        <LocaleAdapterProvider adapter={localeAdapter}>{surface}</LocaleAdapterProvider>
      </QueryClientProvider>
    ) : (
      wrap(surface)
    ),
  );
  return { store };
}

describe("bảng: lỗi, thử lại, rỗng khi tìm", () => {
  it("một nhánh lỗi hiện dòng Thử lại tại chỗ, bấm thì tải lại nhánh đó", async () => {
    const server = serveTableCursor({ count: () => 1, groups: statusGroups, failOnce: ["status:todo@0"] });
    renderTable("status");

    await screen.findByText("status:done 0 v0", {}, LONG);
    const errorRow = (await screen.findByText("Không tải được việc", {}, LONG)).closest("tr") as HTMLElement;
    fireEvent.click(within(errorRow).getByRole("button", { name: "Thử lại" }));

    await screen.findByText("status:todo 0 v0", {}, LONG);
    expect(screen.queryByText("Không tải được việc")).toBeNull();
    expect(server.rowRequests().filter((page) => page.startsWith("status:todo@"))).toHaveLength(3);
  });

  it("groups lỗi hiện trạng thái lỗi có nút Thử lại, bấm thì hỏi lại groups", async () => {
    let failing = true;
    const server = serveTableCursor({
      count: () => 1,
      groups: () => (failing ? new Error("groups down") : statusGroups()),
    });
    renderTable("status");

    const state = await screen.findByRole("alert", {}, LONG);
    expect(state).toHaveTextContent("Không tải được bảng");
    failing = false;
    fireEvent.click(within(state).getByRole("button", { name: "Thử lại" }));

    await screen.findByText("status:todo 0 v0", {}, LONG);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(server.groupBodies.length).toBeGreaterThanOrEqual(3);
  });

  it("bảng không nhóm lỗi cũng thử lại được", async () => {
    serveTableCursor({ count: () => 1, failOnce: ["null@0"] });
    renderTable("none");

    const state = await screen.findByRole("alert", {}, LONG);
    fireEvent.click(within(state).getByRole("button", { name: "Thử lại" }));
    await screen.findByText("null 0 v0", {}, LONG);
  });

  it("tìm không ra việc nào: nói rõ từ khóa và có nút xóa tìm kiếm", async () => {
    serveTableCursor({ count: (_group, _parent, search) => (search ? 0 : 2) });
    renderTable("none");
    await screen.findByText("null 0 v0", {}, LONG);

    const input = screen.getByRole("textbox", { name: "Tìm công việc…" });
    fireEvent.change(input, { target: { value: "zzz" } });
    const empty = await screen.findByText("Không có việc khớp “zzz”", {}, LONG);
    const cell = empty.closest("td") as HTMLElement;
    fireEvent.click(within(cell).getByRole("button", { name: "Xóa tìm kiếm" }));

    expect(input).toHaveValue("");
    await screen.findByText("null 0 v0", {}, LONG);
  });

  it("đổi tìm kiếm: giữ dòng cũ và hiện thanh đang làm mới", async () => {
    let holdSearch = true;
    const server = serveTableCursor({
      count: () => 2,
      hold: (body) =>
        holdSearch &&
        (body.query as { search?: string }).search === "x" &&
        body.cursor == null,
    });
    renderTable("none");
    await screen.findByText("null 0 v0", {}, LONG);

    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.change(screen.getByRole("textbox", { name: "Tìm công việc…" }), {
      target: { value: "x" },
    });
    await act(async () => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    });
    vi.useRealTimers();

    await screen.findByRole("progressbar", { name: "Đang làm mới bảng" }, LONG);
    expect(screen.getByText("null 0 v0")).toBeInTheDocument();

    holdSearch = false;
    server.release();
    await waitFor(
      () => expect(screen.queryByRole("progressbar", { name: "Đang làm mới bảng" })).toBeNull(),
      { timeout: 10_000 },
    );
  });

  it("làm mới sau khi sửa (invalidate) không hiện thanh đang làm mới", async () => {
    let holding = false;
    const server = serveTableCursor({ count: () => 2, hold: () => holding });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } });
    renderTable("none", client);
    await screen.findByText("null 0 v0", {}, LONG);

    holding = true;
    const before = server.rowBodies.length;
    act(() => {
      void client.invalidateQueries({ queryKey: taskKeys.tableRoot("w1") });
    });
    await waitFor(() => expect(server.rowBodies.length).toBeGreaterThan(before), LONG);
    expect(screen.queryByRole("progressbar", { name: "Đang làm mới bảng" })).toBeNull();
    expect(screen.getByText("null 0 v0")).toBeInTheDocument();
    holding = false;
    server.release();
  });
});
