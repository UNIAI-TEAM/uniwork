import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { AuditEvent } from "@uniwork/core/types";
import { TaskActivityGroup } from "./activity-group";

initI18n();

function event(index: number): AuditEvent {
  return {
    id: `a${index}`,
    organization_id: "o1",
    actor_kind: "human",
    actor_id: "u1",
    action: "task.updated",
    resource_type: "task",
    resource_id: "t1",
    changes: {},
    metadata: {},
    correlation_id: "x",
    occurred_at: "2026-09-12T09:00:00Z",
  };
}

describe("TaskActivityGroup", () => {
  it("thu gọn nhóm dài và phân trang ổn định sau 50 activity", () => {
    render(
      <TaskActivityGroup
        events={Array.from({ length: 60 }, (_, index) => event(index))}
        actorNames={new Map([["u1", "Lan"]])}
        valueNames={new Map()}
      />,
    );

    const toggle = screen.getByRole("button", { name: /60 hoạt động|60 activities/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryAllByTestId(/^task-timeline-activity-/)).toHaveLength(0);

    fireEvent.click(toggle);
    expect(screen.getAllByTestId(/^task-timeline-activity-/)).toHaveLength(50);
    fireEvent.click(
      screen.getByRole("button", { name: /xem thêm 10|show 10 more/i }),
    );
    expect(screen.getAllByTestId(/^task-timeline-activity-/)).toHaveLength(60);
  });
});
