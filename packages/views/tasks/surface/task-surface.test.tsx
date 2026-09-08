import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrap } from "../../test/api-mock";
import { TaskSurface } from "./task-surface";

initI18n();

const task = (over: Record<string, unknown>) => ({
  id: "t1",
  workspace_id: "w1",
  title: "Alpha",
  description: "",
  status: "todo",
  priority: "medium",
  position: 1,
  created_by: "u1",
  created_at: "2026-09-06T00:00:00Z",
  updated_at: "2026-09-06T00:00:00Z",
  ...over,
});

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockImplementation(async (path: string) => {
    if (typeof path === "string" && path.includes("/tasks/table/groups")) {
      return {
        query_fingerprint: "fp-groups",
        total: 1,
        groups: [
          {
            key: "status:todo",
            value: { kind: "status", status: "todo" },
            count: 1,
          },
        ],
        next_cursor: null,
      };
    }
    if (typeof path === "string" && path.includes("/tasks/table/rows")) {
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
    if (typeof path === "string" && path.includes("/tasks/table/facets")) {
      return {
        query_fingerprint: "fp-facets",
        total: 1,
        facets: [{ kind: "status", values: [{ key: "todo", count: 1 }] }],
      };
    }
    return {
      tasks: [task({})],
      total: 1,
      limit: 50,
      offset: 0,
    };
  });
});

describe("TaskSurface", () => {
  it("lists tasks from suite query when list mode active", async () => {
    render(
      wrap(
        <TaskSurface
          workspaceId="w1"
          scope={{ type: "workspace" }}
          modes={["list"]}
          surfaceKey="test-ws-list"
        />,
      ),
    );
    expect(await screen.findByText("Alpha")).toBeInTheDocument();
  });

  it("calls table groups endpoint when table mode active", async () => {
    render(
      wrap(
        <TaskSurface
          workspaceId="w1"
          scope={{ type: "workspace" }}
          modes={["table"]}
          surfaceKey="test-ws-table"
        />,
      ),
    );

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith(
        expect.stringContaining("/tasks/table/groups"),
        expect.objectContaining({ method: "POST" }),
      );
    });
    expect(await screen.findByText("Alpha")).toBeInTheDocument();
  });
});
