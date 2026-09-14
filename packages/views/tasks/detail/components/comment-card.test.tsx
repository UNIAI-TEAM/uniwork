import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
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
  beforeEach(() => {
    resetAuthStoreForTests();
    setSessionUser({
      id: "u1",
      email: "me@example.com",
      display_name: "Me",
      locale: "vi",
      onboarded_at: "2026-09-01T00:00:00Z",
      email_verified_at: "2026-09-01T00:00:00Z",
      onboarding_questionnaire: {},
    });
  });

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

  it("yêu cầu xác nhận trước khi xoá bình luận", () => {
    const onDelete = vi.fn();
    render(
      <TaskCommentCard
        comment={base}
        onToggleReaction={vi.fn()}
        onDelete={onDelete}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^xóa$|^delete$/i }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /xóa bình luận|delete comment/i }),
    );
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
