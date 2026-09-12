import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { AuditEvent } from "@uniwork/core/types";
import { TaskActivityRow } from "./activity-row";

initI18n();

const base: AuditEvent = {
  id: "a1",
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

describe("TaskActivityRow", () => {
  it("dịch khóa đã biết sang nhãn tiếng Việt và giữ nguyên khóa lạ", () => {
    render(
      <TaskActivityRow
        event={{
          ...base,
          changes: { status: { from: "todo", to: "in_progress" }, some_new_column: { to: "x" } },
        }}
      />,
    );
    const row = screen.getByTestId("task-timeline-activity-a1");
    expect(row).toHaveTextContent("Trạng thái");
    expect(row).toHaveTextContent("some_new_column");
    expect(row).not.toHaveTextContent("status,");
  });

  it("không có trường thay đổi thì hiện dòng chung chung", () => {
    render(<TaskActivityRow event={base} />);
    expect(screen.getByTestId("task-timeline-activity-a1")).toHaveTextContent(
      "Đã cập nhật công việc",
    );
  });
});
