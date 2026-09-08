import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { TASK_STATUSES, type Task } from "@uniwork/core/types";
import { wrap } from "../../test/api-mock";
import { BoardView } from "./board-view";

initI18n();

const sample: Task = {
  id: "t1",
  organization_id: "",
  workspace_id: "w1",
  number: 1,
  identifier: "T-1",
  revision: 1,
  title: "Suite card",
  description: "",
  status: "todo",
  priority: "medium",
  assignee_kind: "human",
  position: 1,
  kind: "normal",
  created_by: "u1",
  created_by_kind: "human",
  created_at: "2026-09-06T00:00:00Z",
  updated_at: "2026-09-06T00:00:00Z",
};

describe("modes/BoardView", () => {
  it("renders backlog through cancelled columns from catalog", async () => {
    render(
      wrap(
        <BoardView
          categories={[...TASK_STATUSES]}
          tasks={[sample]}
          projectGroupingDisabled
          projectGroupingReasonKey="capabilities.unknown"
        />,
      ),
    );

    for (const category of TASK_STATUSES) {
      expect(
        await screen.findByTestId(`board-column-${category}`),
      ).toBeInTheDocument();
    }
    expect(screen.getAllByTestId(/^board-column-/)).toHaveLength(7);
    expect(screen.getByText("Suite card")).toBeInTheDocument();
    // MVP board only had four columns — suite must include catalog extremes.
    expect(screen.getByTestId("board-column-backlog")).toBeInTheDocument();
    expect(screen.getByTestId("board-column-in_review")).toBeInTheDocument();
    expect(screen.getByTestId("board-column-blocked")).toBeInTheDocument();
  });
});
