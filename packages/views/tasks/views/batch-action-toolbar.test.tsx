import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { Task } from "@uniwork/core/types";
import {
  TaskSurfaceActionsProvider,
  type TaskSurfaceActions,
} from "../surface/actions-context";
import {
  TaskSurfaceSelectionProvider,
  type TaskSurfaceSelection,
} from "../surface/selection-context";
import { wrap } from "../../test/api-mock";
import { BatchActionToolbar } from "./batch-action-toolbar";

initI18n();

const batchDelete = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined),
);
const clear = vi.hoisted(() => vi.fn());

vi.mock("@uniwork/core/tasks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@uniwork/core/tasks")>();
  return {
    ...actual,
    useBatchUpdateTasks: () => ({
      mutateAsync: vi.fn().mockResolvedValue(1),
      isPending: false,
    }),
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

function selectionStub(ids: string[]): TaskSurfaceSelection {
  return {
    selectedIds: new Set(ids),
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
});
