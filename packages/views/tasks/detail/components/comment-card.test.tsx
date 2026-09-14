import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { TaskComment } from "@uniwork/core/types";
import { TaskCommentCard } from "./comment-card";

initI18n();

const base: TaskComment = {
  id: "c1",
  task_id: "t1",
  author_id: "u1",
  author_kind: "human",
  body: "một",
  type: "comment",
  revision: 1,
  reactions: [],
};

describe("TaskCommentCard", () => {
  it("hiển thị reaction mà server trả về", () => {
    render(
      <TaskCommentCard
        comment={{
          ...base,
          reactions: [
            { id: "r1", comment_id: "c1", actor_type: "member", actor_id: "u1", emoji: "👍", created_at: "2026-09-12T00:00:00Z" },
          ],
        }}
        onToggleReaction={vi.fn()}
      />,
    );
    expect(screen.getByText("👍")).toBeInTheDocument();
  });

  it("không hiển thị reaction nào khi mảng rỗng", () => {
    render(<TaskCommentCard comment={base} onToggleReaction={vi.fn()} />);
    expect(screen.queryByText("👍")).not.toBeInTheDocument();
  });
});
