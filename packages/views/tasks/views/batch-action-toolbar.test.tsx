import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { Task } from "@uniwork/core/types";
import { toDateOnly } from "../../common/date-field";
import {
  TaskSurfaceActionsProvider,
  type TaskSurfaceActions,
} from "../surface/actions-context";
import {
  TaskSurfaceSelectionProvider,
  type TaskSurfaceSelectionHandle,
} from "../surface/selection-context";
import { requestMock, wrap } from "../../test/api-mock";
import { BatchActionToolbar } from "./batch-action-toolbar";

initI18n();

const publicConfigState = vi.hoisted(() => ({
  data: {
    flags: {} as Record<string, boolean>,
    rum_sample_rate: 0,
    work_management_capabilities: {} as Record<
      string,
      {
        status: "available" | "unavailable";
        reason_code: string;
        explanation_key: string;
      }
    >,
  },
}));

vi.mock("@uniwork/core/feature-flags", () => ({
  usePublicConfig: () => ({ data: publicConfigState.data }),
}));

const batchDelete = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined),
);
const clear = vi.hoisted(() => vi.fn());

vi.mock("@uniwork/core/tasks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@uniwork/core/tasks")>();
  return {
    // useBatchUpdateTasks stays real: the no-surface-actions path must reach
    // the mocked transport so its request body can be asserted.
    ...actual,
    useBatchDeleteTasks: () => ({
      mutateAsync: batchDelete,
      isPending: false,
    }),
  };
});

function makeTask(over: Partial<Task> = {}): Task {
  return {
    id: "t1",
    organization_id: "o1",
    workspace_id: "w1",
    number: 1,
    identifier: "UW-1",
    revision: 1,
    title: "Task",
    description: "",
    status: "todo",
    priority: "medium",
    position: 1,
    kind: "normal",
    created_by: "u1",
    created_by_kind: "human",
    assignee_kind: "human",
    created_at: "2026-09-06T00:00:00Z",
    updated_at: "2026-09-06T00:00:00Z",
    ...over,
  };
}

function selectionStub(ids: string[]): TaskSurfaceSelectionHandle {
  const selected = new Set(ids);
  return {
    store: {
      subscribe: () => () => {},
      isSelected: (id) => selected.has(id),
      getSnapshot: () => selected,
    },
    toggle: vi.fn(),
    select: vi.fn(),
    deselect: vi.fn(),
    clear,
  };
}

const noopActions: TaskSurfaceActions = {
  isPending: false,
  createTask: () => {},
  updateTask: () => {},
  moveTask: () => {},
  batchUpdate: async () => {},
  batchDelete: async () => {},
};

beforeEach(() => {
  batchDelete.mockReset();
  batchDelete.mockResolvedValue(undefined);
  clear.mockReset();
  publicConfigState.data = {
    flags: {},
    rum_sample_rate: 0,
    work_management_capabilities: {},
  };
});

describe("BatchActionToolbar delete", () => {
  it("awaits the server delete before clearing selection (no optimistic clear)", async () => {
    let resolveDelete!: () => void;
    batchDelete.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveDelete = resolve;
        }),
    );

    const actions: TaskSurfaceActions = {
      ...noopActions,
      batchDelete: (ids) => batchDelete(ids),
    };

    render(
      wrap(
        <TaskSurfaceActionsProvider actions={actions}>
          <TaskSurfaceSelectionProvider selection={selectionStub(["t1"])}>
            <BatchActionToolbar workspaceId="w1" tasks={[makeTask()]} />
          </TaskSurfaceSelectionProvider>
        </TaskSurfaceActionsProvider>,
      ),
    );

    fireEvent.click(screen.getByTestId("batch-delete"));
    fireEvent.click(screen.getByTestId("batch-delete-confirm"));

    expect(batchDelete).toHaveBeenCalledWith(["t1"]);
    expect(clear).not.toHaveBeenCalled();

    resolveDelete();
    await waitFor(() => {
      expect(clear).toHaveBeenCalledTimes(1);
    });
  });

  it("sends one delete when confirm is clicked twice while the first is pending", async () => {
    let resolveDelete!: () => void;
    batchDelete.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveDelete = resolve;
        }),
    );
    const actions: TaskSurfaceActions = {
      ...noopActions,
      batchDelete: (ids) => batchDelete(ids),
    };

    render(
      wrap(
        <TaskSurfaceActionsProvider actions={actions}>
          <TaskSurfaceSelectionProvider selection={selectionStub(["t1"])}>
            <BatchActionToolbar workspaceId="w1" tasks={[makeTask()]} />
          </TaskSurfaceSelectionProvider>
        </TaskSurfaceActionsProvider>,
      ),
    );

    fireEvent.click(screen.getByTestId("batch-delete"));
    const confirm = screen.getByTestId("batch-delete-confirm");
    // Both clicks inside one act: React has not re-rendered in between, so
    // aria-disabled is not on the button yet. Only an in-flight ref stops the second.
    act(() => {
      confirm.click();
      confirm.click();
    });
    // After the re-render, a further click must still do nothing.
    fireEvent.click(confirm);

    expect(batchDelete).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveAttribute("aria-disabled", "true");
    expect(confirm).not.toBeDisabled();

    await act(async () => resolveDelete());
    await waitFor(() => expect(clear).toHaveBeenCalledTimes(1));
    expect(batchDelete).toHaveBeenCalledTimes(1);
  });

  it("keeps the delete trigger focusable but inert while a batch request is pending", () => {
    render(
      wrap(
        <TaskSurfaceActionsProvider actions={{ ...noopActions, isPending: true }}>
          <TaskSurfaceSelectionProvider selection={selectionStub(["t1"])}>
            <BatchActionToolbar workspaceId="w1" tasks={[makeTask()]} />
          </TaskSurfaceSelectionProvider>
        </TaskSurfaceActionsProvider>,
      ),
    );

    const trigger = screen.getByTestId("batch-delete");
    // aria-disabled, not disabled: the button stays in the tab order.
    expect(trigger).toHaveAttribute("aria-disabled", "true");
    expect(trigger).not.toBeDisabled();
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    expect(screen.queryByTestId("batch-delete-confirm")).toBeNull();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("reflects shared status of the selection", () => {
    render(
      wrap(
        <TaskSurfaceActionsProvider actions={noopActions}>
          <TaskSurfaceSelectionProvider selection={selectionStub(["a", "b"])}>
            <BatchActionToolbar
              workspaceId="w1"
              tasks={[
                makeTask({ id: "a", status: "in_progress" }),
                makeTask({ id: "b", status: "in_progress" }),
              ]}
            />
          </TaskSurfaceSelectionProvider>
        </TaskSurfaceActionsProvider>,
      ),
    );

    expect(screen.getByTestId("batch-status-value")).toHaveAttribute(
      "data-status",
      "in_progress",
    );
  });

  it.each([
    ["unassigned", [makeTask({ id: "a" }), makeTask({ id: "b" })], "Người nhận: Chưa giao"],
    [
      "mixed",
      [
        makeTask({ id: "a", assignee_id: "u1", assignee: { kind: "human", id: "u1", display_name: "An" } }),
        makeTask({ id: "b" }),
      ],
      "Người nhận: Khác nhau",
    ],
  ] as const)("names the assignee picker by field and the %s value it shows", (_case, tasks, name) => {
    render(
      wrap(
        <TaskSurfaceActionsProvider actions={noopActions}>
          <TaskSurfaceSelectionProvider selection={selectionStub(["a", "b"])}>
            <BatchActionToolbar workspaceId="w1" tasks={[...tasks]} />
          </TaskSurfaceSelectionProvider>
        </TaskSurfaceActionsProvider>,
      ),
    );
    const trigger = screen.getByRole("combobox", { name });
    expect(name).toContain(trigger.textContent?.trim() ?? "__missing__");
  });

  it("does not mount agent trigger or squad assign chrome", () => {
    render(
      wrap(
        <TaskSurfaceActionsProvider actions={noopActions}>
          <TaskSurfaceSelectionProvider selection={selectionStub(["t1"])}>
            <BatchActionToolbar workspaceId="w1" tasks={[makeTask()]} />
          </TaskSurfaceSelectionProvider>
        </TaskSurfaceActionsProvider>,
      ),
    );

    expect(screen.queryByTestId("batch-agent-trigger")).toBeNull();
    expect(screen.queryByTestId("batch-squad-assign")).toBeNull();
  });
});

describe("BatchActionToolbar due date", () => {
  // react-day-picker + date-fns sit behind React.lazy in DateField; warming the
  // chunk here keeps the assertions waiting on Suspense, not on a compile.
  beforeAll(async () => {
    await import("@uniwork/ui/components/ui/calendar");
  }, 60_000);

  function renderWithDueDates(
    dueDate: string | undefined,
    batchUpdate: (ids: string[], updates: Record<string, unknown>) => Promise<void>,
  ) {
    render(
      wrap(
        <TaskSurfaceActionsProvider
          actions={{ ...noopActions, batchUpdate }}
        >
          <TaskSurfaceSelectionProvider selection={selectionStub(["a", "b"])}>
            <BatchActionToolbar
              workspaceId="w1"
              tasks={[
                makeTask({ id: "a", due_date: dueDate }),
                makeTask({ id: "b", due_date: dueDate }),
              ]}
            />
          </TaskSurfaceSelectionProvider>
        </TaskSurfaceActionsProvider>,
      ),
    );
  }

  async function openCalendar() {
    fireEvent.click(screen.getByRole("button", { name: "Hạn" }));
    await screen.findAllByRole("gridcell", {}, { timeout: 20_000 });
  }

  it("sends the picked day as due_date for every selected task", async () => {
    const batchUpdate = vi.fn().mockResolvedValue(undefined);
    renderWithDueDates(undefined, batchUpdate);
    await openCalendar();

    const now = new Date();
    const tenth = toDateOnly(new Date(now.getFullYear(), now.getMonth(), 10));
    fireEvent.click(
      screen
        .getAllByRole("gridcell")
        .map((cell) => cell.querySelector("button"))
        .find((btn) => btn?.textContent === "10")!,
    );

    await waitFor(() => {
      expect(batchUpdate).toHaveBeenCalledWith(["a", "b"], {
        due_date: tenth,
      });
    });
  });

  it("clears the due date with null, not an empty string", async () => {
    const batchUpdate = vi.fn().mockResolvedValue(undefined);
    renderWithDueDates("2026-09-06", batchUpdate);
    await openCalendar();

    fireEvent.click(screen.getByText("Bỏ chọn ngày"));

    await waitFor(() => {
      expect(batchUpdate).toHaveBeenCalledWith(["a", "b"], { due_date: null });
    });
  });

  it("without surface actions, sends the picked due date through the transport to batch-update", async () => {
    requestMock.mockReset();
    requestMock.mockResolvedValue({ updated: 2 });
    render(
      wrap(
        <TaskSurfaceSelectionProvider selection={selectionStub(["a", "b"])}>
          <BatchActionToolbar
            workspaceId="w1"
            tasks={[makeTask({ id: "a" }), makeTask({ id: "b" })]}
          />
        </TaskSurfaceSelectionProvider>,
      ),
    );
    await openCalendar();

    const now = new Date();
    const tenth = toDateOnly(new Date(now.getFullYear(), now.getMonth(), 10));
    fireEvent.click(
      screen
        .getAllByRole("gridcell")
        .map((cell) => cell.querySelector("button"))
        .find((btn) => btn?.textContent === "10")!,
    );

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith("/api/v1/workspaces/w1/tasks/batch-update", {
        method: "POST",
        body: { task_ids: ["a", "b"], updates: { due_date: tenth } },
      });
    });
  });

  it("names the action with a fixed label, never a selected task's date", () => {
    renderWithDueDates("2026-09-06", vi.fn().mockResolvedValue(undefined));

    // Every selected task shares 2026-09-06, and the trigger still must not
    // show it: the label names the action, the trigger offers to pick a day.
    const trigger = screen.getByRole("button", { name: "Hạn" });
    expect(trigger.textContent).toBe("Chọn ngày");
    expect(screen.queryByText(/2026/)).toBeNull();
  });
});
