import { render, screen } from "@testing-library/react";
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
  requestMock.mockResolvedValue({
    tasks: [task({})],
    total: 1,
    limit: 50,
    offset: 0,
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
          surfaceKey="test-ws"
        />,
      ),
    );
    expect(await screen.findByText("Alpha")).toBeInTheDocument();
  });
});
