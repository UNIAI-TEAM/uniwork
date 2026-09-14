import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { TaskComment } from "@uniwork/core/types";
import { TaskReplyComposer } from "./reply-composer";

initI18n();

const parent: TaskComment = {
  id: "r1",
  task_id: "t1",
  author_id: "u1",
  author_kind: "human",
  display_name: "Ngọc",
  body: "Câu gốc",
  type: "comment",
  revision: 1,
  reactions: [],
};

describe("TaskReplyComposer", () => {
  it("hiện trích dẫn bình luận đang trả lời", () => {
    render(
      <TaskReplyComposer
        taskId="t1"
        parent={parent}
        onSubmit={vi.fn().mockResolvedValue(true)}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByTestId("reply-quote-r1")).toHaveTextContent("Câu gốc");
  });

  it("gọi onCancel khi bấm huỷ", async () => {
    const onCancel = vi.fn();
    render(
      <TaskReplyComposer
        taskId="t1"
        parent={parent}
        onSubmit={vi.fn().mockResolvedValue(true)}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByTestId("reply-cancel-r1"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
