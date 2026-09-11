import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { getTaskSurfaceViewStore } from "@uniwork/core/tasks/stores/surface-view-store";
import { ViewStoreProvider } from "@uniwork/core/tasks/stores/view-store-context";
import { wrap } from "../../test/api-mock";
import { SaveViewDialog } from "./save-view-dialog";

initI18n();

const createMutate = vi.hoisted(() => vi.fn());

vi.mock("@uniwork/core/tasks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@uniwork/core/tasks")>();
  return {
    ...actual,
    useCreateTaskView: () => ({
      mutate: createMutate,
      mutateAsync: createMutate,
      isPending: false,
    }),
    usePatchTaskView: () => ({ mutate: vi.fn(), isPending: false }),
  };
});

vi.mock("@uniwork/core/workspaces", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@uniwork/core/workspaces")>();
  return {
    ...actual,
    useMembers: () => ({
      data: [
        {
          workspace_id: "w1",
          user_id: "member-1",
          role: "member",
          email: "member@example.com",
          display_name: "Member One",
        },
      ],
    }),
  };
});

beforeEach(() => {
  createMutate.mockReset();
  createMutate.mockImplementation((_body, opts?: { onSuccess?: (v: unknown) => void }) => {
    opts?.onSuccess?.({ id: "view-1", name: "Focus", revision: 1 });
  });
});

describe("SaveViewDialog", () => {
  it("shows the saved-view builder controls", () => {
    const store = getTaskSurfaceViewStore("test-save-view-controls");

    render(
      wrap(
        <ViewStoreProvider store={store}>
          <SaveViewDialog
            workspaceId="w1"
            open
            onOpenChange={() => {}}
            scope={{ kind: "workspace" }}
          />
        </ViewStoreProvider>,
      ),
    );

    expect(screen.getByText(/loại người được giao|assignee type/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /thêm bộ lọc|add filter/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /hiển thị mặc định|default display/i })).toBeInTheDocument();
  });

  it("shows each active filter as a removable summary chip", async () => {
    const store = getTaskSurfaceViewStore("test-save-view-filter-chips");
    store.setState({
      statusFilters: ["todo", "in_progress"],
      priorityFilters: ["high"],
    });

    render(
      wrap(
        <ViewStoreProvider store={store}>
          <SaveViewDialog
            workspaceId="w1"
            open
            onOpenChange={() => {}}
            scope={{ kind: "workspace" }}
          />
        </ViewStoreProvider>,
      ),
    );

    expect(
      await screen.findByText(/2 trạng thái|2 statuses/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/cao|high/i)).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: /gỡ bộ lọc trạng thái|remove status filter/i,
      }),
    );

    await waitFor(() => {
      expect(screen.queryByText(/2 trạng thái|2 statuses/i)).not.toBeInTheDocument();
    });
    expect(screen.getByText(/cao|high/i)).toBeInTheDocument();
  });

  it("opens the assignee submenu with grouped member options", async () => {
    const store = getTaskSurfaceViewStore("test-save-view-assignee-menu");

    render(
      wrap(
        <ViewStoreProvider store={store}>
          <SaveViewDialog
            workspaceId="w1"
            open
            onOpenChange={() => {}}
            scope={{ kind: "workspace" }}
          />
        </ViewStoreProvider>,
      ),
    );

    fireEvent.click(
      screen.getByRole("button", { name: /thêm bộ lọc|add filter/i }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /người nhận|assignee/i }),
    );

    expect(
      await screen.findByText(/thành viên|members/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Member One")).toBeInTheDocument();
  });

  it("persists the complete draft display state", async () => {
    const store = getTaskSurfaceViewStore("test-save-view");
    store.setState({
      viewMode: "table",
      cardPropertyIds: ["estimate"],
      ganttZoom: "month",
      ganttShowCompleted: true,
      swimlaneGrouping: "project",
      tableColumns: [{ key: "title", width: 420 }, { key: "status" }],
      tableGrouping: "status",
      tableHierarchy: false,
    });

    render(
      wrap(
        <ViewStoreProvider store={store}>
          <SaveViewDialog
            workspaceId="w1"
            open
            onOpenChange={() => {}}
            scope={{ kind: "workspace" }}
          />
        </ViewStoreProvider>,
      ),
    );

    fireEvent.change(screen.getByRole("textbox", { name: /tên|name/i }), {
      target: { value: "Focus board" },
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: /tạo chế độ xem|create view/i,
      }),
    );

    await waitFor(() => {
      expect(createMutate).toHaveBeenCalled();
    });
    const body = createMutate.mock.calls[0]?.[0] as {
      name: string;
      scope_type: string;
      visibility: string;
      display: Record<string, unknown>;
    };
    expect(body.name).toBe("Focus board");
    expect(body.scope_type).toBe("workspace");
    expect(body.visibility).toMatch(/private|workspace/);
    expect(body.display).toMatchObject({
      viewMode: "table",
      cardPropertyIds: ["estimate"],
      ganttZoom: "month",
      ganttShowCompleted: true,
      swimlaneGrouping: "project",
      tableColumns: [{ key: "title", width: 420 }, { key: "status" }],
      tableGrouping: "status",
      tableHierarchy: false,
    });
  });
});
