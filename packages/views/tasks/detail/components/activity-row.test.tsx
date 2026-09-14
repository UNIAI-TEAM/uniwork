import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { AuditEvent } from "@uniwork/core/types";
import { TaskActivityRow, isTimelineActivity } from "./activity-row";

initI18n();

const base: AuditEvent = {
  id: "a1",
  organization_id: "o1",
  actor_kind: "human",
  actor_id: "01H0000000000000000000000A",
  action: "task.updated",
  resource_type: "task",
  resource_id: "t1",
  changes: {},
  metadata: {},
  correlation_id: "x",
  occurred_at: "2026-09-12T09:00:00Z",
};

function row(event: Partial<AuditEvent>, actorName?: string) {
  render(<TaskActivityRow event={{ ...base, ...event }} actorName={actorName} />);
  return screen.getByTestId(`task-timeline-activity-${event.id ?? base.id}`);
}

describe("TaskActivityRow", () => {
  it("nói công việc được tạo, không kể đó là một lần đổi trường", () => {
    const el = row(
      {
        action: "task.created",
        changes: {
          title: { to: "Viết đặc tả" },
          status: { to: "todo" },
          priority: { to: "high" },
        },
      },
      "Lan",
    );
    expect(el).toHaveTextContent("Tạo task");
    expect(el).not.toHaveTextContent("Cập nhật task");
    // Ba trường, tối đa hai ô hiển thị: phần dư gộp thành "+1".
    expect(el).toHaveTextContent("Tiêu đề");
    expect(el).toHaveTextContent("+1");
  });

  it("cập nhật thường hiện diff từ → đến và tên người thực hiện", () => {
    const el = row(
      { changes: { status: { from: "todo", to: "in_progress" } } },
      "Lan",
    );
    expect(el).toHaveTextContent("Cập nhật task");
    expect(el).toHaveTextContent("Lan");
    expect(el).toHaveTextContent("todo");
    expect(el).toHaveTextContent("in_progress");
  });

  it("không có tên thành viên thì hiện id rút gọn thay vì bỏ trống người thực hiện", () => {
    const el = row({ changes: { status: { to: "done" } } });
    expect(el).toHaveTextContent("01H0…000A");
  });

  it("thời điểm hiện tương đối, giữ mốc tuyệt đối trong thuộc tính", () => {
    const el = row({});
    const time = el.querySelector("time");
    expect(time).not.toBeNull();
    expect(time?.getAttribute("datetime")).toBe("2026-09-12T09:00:00Z");
    expect(time?.textContent?.trim()).not.toBe("2026-09-12T09:00:00Z");
  });

  it("hành động lạ vẫn hiện chính tên nó thay vì bịa ra câu khác", () => {
    const el = row({ action: "task.archived_by_a_newer_server" });
    expect(el).toHaveTextContent("task.archived_by_a_newer_server");
    expect(el).not.toHaveTextContent("Cập nhật task");
  });
});

describe("isTimelineActivity", () => {
  it("giữ vòng đời của chính công việc", () => {
    for (const action of ["task.created", "task.updated", "task.deleted"]) {
      expect(isTimelineActivity({ ...base, action })).toBe(true);
    }
  });

  it("bỏ các hành động đã có thẻ bình luận hoặc nút theo dõi kể lại", () => {
    for (const action of [
      "task.comment_added",
      "task.comment_updated",
      "task.comment_deleted",
      "task.comment_resolved",
      "task.comment_unresolved",
      "task.reaction_added",
      "task.reaction_removed",
      "task.subscribed",
      "task.unsubscribed",
    ]) {
      expect(isTimelineActivity({ ...base, action })).toBe(false);
    }
  });

  it("hành động chưa biết vẫn được hiện, vì giấu đi mới là nói dối", () => {
    expect(isTimelineActivity({ ...base, action: "task.exported" })).toBe(true);
  });
});
