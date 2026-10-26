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

function row(event: Partial<AuditEvent>, actorName?: string, actorAvatarUrl?: string) {
  render(
    <TaskActivityRow
      event={{ ...base, ...event }}
      actorName={actorName}
      actorAvatarUrl={actorAvatarUrl}
    />,
  );
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
    expect(el).toHaveTextContent("Tạo việc");
    expect(el).not.toHaveTextContent("Cập nhật việc");
    // Ba trường, tối đa hai ô hiển thị: phần dư gộp thành "+1".
    expect(el).toHaveTextContent("Tiêu đề");
    expect(el).toHaveTextContent("+1");
  });

  it("lúc tạo việc không kể loại người phụ trách, và phần dư nói rõ là trường", () => {
    const el = row(
      {
        action: "task.created",
        changes: {
          title: { to: "Viết đặc tả" },
          assignee_kind: { to: "human" },
          status: { to: "todo" },
          priority: { to: "high" },
        },
      },
      "Lan",
    );
    expect(el).not.toHaveTextContent("Loại người phụ trách");
    expect(el).not.toHaveTextContent("human");
    expect(el).toHaveTextContent("+1 trường");
  });

  it("lúc tạo việc không liệt kê trường để trống, và mọi tên trường đều đọc bằng chữ", () => {
    const el = row(
      {
        action: "task.created",
        changes: {
          assignee_id: { to: null },
          due_at: { to: null },
          due_date: { to: null },
          start_at: { to: null },
          start_date: { to: "" },
          title: { to: "Viết đặc tả" },
          status: { to: "todo" },
        },
      },
      "Lan",
    );
    expect(el).not.toHaveTextContent("due_at");
    expect(el).not.toHaveTextContent("Không có");
    expect(el).not.toHaveTextContent("Hạn");
    expect(el).toHaveTextContent("Tiêu đề");
    expect(el).toHaveTextContent("Trạng thái");
    expect(el).not.toHaveTextContent("trường");
  });

  it("giờ bắt đầu và giờ kết thúc có tên đọc được, không lộ khoá", () => {
    const el = row(
      {
        changes: {
          start_at: { from: null, to: "2026-10-21T02:00:00Z" },
          due_at: { from: null, to: "2026-10-21T03:00:00Z" },
        },
      },
      "Lan",
    );
    expect(el).toHaveTextContent("Giờ bắt đầu");
    expect(el).toHaveTextContent("Giờ kết thúc");
    expect(el).not.toHaveTextContent("start_at");
    expect(el).not.toHaveTextContent("due_at");
  });

  it("đổi loại người phụ trách đọc bằng chữ, không lộ enum", () => {
    const el = row({ changes: { assignee_kind: { from: "human", to: "agent" } } }, "Lan");
    expect(el).toHaveTextContent("Loại người phụ trách");
    expect(el).toHaveTextContent("Người");
    expect(el).not.toHaveTextContent("human");
  });

  it("cập nhật thường hiện diff từ → đến và tên người thực hiện", () => {
    const el = row(
      { changes: { status: { from: "todo", to: "in_progress" } } },
      "Lan",
    );
    expect(el).toHaveTextContent("Cập nhật việc");
    expect(el).toHaveTextContent("Lan");
    expect(el).toHaveTextContent("Cần làm");
    expect(el).toHaveTextContent("Đang làm");
    expect(el).not.toHaveTextContent("in_progress");
    expect(screen.getByText("Cần làm")).toHaveClass("text-muted-foreground");
    expect(screen.getByText("Cần làm")).not.toHaveClass("line-through");
    expect(screen.getByText("Đang làm")).toBeInTheDocument();
    expect(el.querySelector("svg.lucide-arrow-right")).not.toBeNull();
  });

  it("ẩn position khỏi diff và số trường còn lại của timeline công việc", () => {
    const el = row(
      {
        changes: {
          status: { from: "todo", to: "in_progress" },
          priority: { from: "low", to: "high" },
          position: { from: 4094, to: 1023 },
        },
      },
      "Lan",
    );

    expect(el).toHaveTextContent("Cần làm");
    expect(el).toHaveTextContent("Đang làm");
    expect(el).toHaveTextContent("Thấp");
    expect(el).toHaveTextContent("Cao");
    expect(el).not.toHaveTextContent("Vị trí");
    expect(el).not.toHaveTextContent("4094");
    expect(el).not.toHaveTextContent("1023");
    expect(el).not.toHaveTextContent("+1");
  });

  it("vẫn hiện hoạt động khi thay đổi duy nhất là position", () => {
    const el = row(
      { changes: { position: { from: 4094, to: 1023 } } },
      "Lan",
    );

    expect(el).toHaveTextContent("Lan");
    expect(el).toHaveTextContent("Cập nhật việc");
    expect(el).not.toHaveTextContent("Vị trí");
    expect(el).not.toHaveTextContent("4094");
    expect(el).not.toHaveTextContent("1023");
    expect(el.querySelector(".rounded-md.bg-muted")).toBeNull();
  });

  it("hiển thị avatar tài khoản của người thực hiện", () => {
    row({}, "Lan", "/uploads/avatars/lan.png");
    expect(screen.getByRole("img", { name: "Lan" })).toHaveAttribute(
      "src",
      "/uploads/avatars/lan.png",
    );
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

  it("nói ứng dụng AI mà thay đổi đi qua", () => {
    const el = row({ metadata: { via: { kind: "mcp", client_name: "Claude" } } }, "Lan");
    expect(screen.getByText("qua Claude")).toBeInTheDocument();
    // Tên người thực hiện vẫn đứng đầu: đó là người đã cho phép.
    expect(el).toHaveTextContent("Lan");
  });

  it("nói thay đổi đến từ một đề xuất của Hỏi UNI", () => {
    row({ action: "task.created", metadata: { via: { kind: "ask_uni", proposal_id: "p1" } } }, "Lan");
    expect(screen.getByText("qua Hỏi UNI")).toBeInTheDocument();
  });

  it("gọi tên các bước của một đề xuất UNI thay vì mã thô", () => {
    for (const [action, label] of [
      ["ai_proposal.applied", "Áp dụng đề xuất của UNI"],
      ["ai_proposal.rejected", "Bỏ qua đề xuất của UNI"],
      ["ai_proposal.undone", "Hoàn tác đề xuất của UNI"],
    ] as const) {
      const { unmount } = render(<TaskActivityRow event={{ ...base, action }} actorName="Lan" />);
      expect(screen.getByText(label)).toBeInTheDocument();
      expect(screen.queryByText(action)).not.toBeInTheDocument();
      unmount();
    }
  });

  it("bỏ qua via mà máy chủ gửi sai dạng", () => {
    for (const via of ["Claude", null, 7, [], {}, { client_name: 3 }]) {
      const { unmount } = render(
        <TaskActivityRow event={{ ...base, metadata: { via } }} actorName="Lan" />,
      );
      expect(screen.queryByText(/qua /)).not.toBeInTheDocument();
      unmount();
    }
  });

  it("hành động lạ vẫn hiện chính tên nó thay vì bịa ra câu khác", () => {
    const el = row({ action: "task.archived_by_a_newer_server" });
    expect(el).toHaveTextContent("task.archived_by_a_newer_server");
    expect(el).not.toHaveTextContent("Cập nhật việc");
  });

  it("dịch các hành động liên kết / bỏ liên kết tệp Google Drive và tạo việc từ đề xuất của UNI", () => {
    const linked = row(
      {
        id: "drv1",
        action: "task.drive_file_linked",
        metadata: { drive_file_id: "df_1", drive_file_name: "Kế hoạch ra mắt Q4" },
      },
      "Minh",
    );
    expect(linked).toHaveTextContent("Minh");
    expect(linked).toHaveTextContent("đã liên kết Kế hoạch ra mắt Q4 từ Google Drive");

    const unlinked = row(
      {
        id: "drv2",
        action: "task.drive_file_unlinked",
        metadata: { drive_file_id: "df_1" },
      },
      "Minh",
    );
    expect(unlinked).toHaveTextContent("Bỏ liên kết tệp Google Drive");

    render(
      <TaskActivityRow
        event={{
          ...base,
          id: "drv3",
          action: "task.drive_file_linked",
          metadata: { drive_file_id: "df_99" },
        }}
        actorName="Minh"
        valueNames={new Map([["df_99", "Ngân sách Q4"]])}
      />,
    );
    expect(screen.getByTestId("task-timeline-activity-drv3")).toHaveTextContent(
      "đã liên kết Ngân sách Q4 từ Google Drive",
    );

    const fromProposal = row(
      {
        id: "drv4",
        action: "task.created",
        metadata: { source: "drive_task_proposal", drive_file_name: "Kế hoạch ra mắt Q4" },
      },
      "Minh",
    );
    expect(fromProposal).toHaveTextContent(
      "đã tạo công việc từ đề xuất của UNI (Kế hoạch ra mắt Q4)",
    );
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
