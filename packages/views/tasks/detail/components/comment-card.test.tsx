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
  created_at: "2026-09-15T03:00:00Z",
  updated_at: "2026-09-15T03:00:00Z",
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
        getActorName={(_type, id) => (id === "u2" ? "Lan" : "Me")}
      />,
    );
    expect(screen.getByText("👍")).toBeInTheDocument();
  });

  it("hiển thị thời gian tương đối và giờ tuyệt đối từ timestamp đã lưu", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-15T03:05:00Z"));

    render(<TaskCommentCard comment={base} onToggleReaction={vi.fn()} />);

    const time = screen.getByText(/5 phút trước|5 minutes ago/i);
    expect(time).toHaveAttribute("title");
    expect(time.getAttribute("title")).toMatch(/2026|15\/09|09\/15/);
    vi.useRealTimers();
  });

  it("bình luận đã sửa hiển thị thời điểm cập nhật thay vì thời điểm tạo", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-15T03:05:00Z"));

    render(
      <TaskCommentCard
        comment={{ ...base, updated_at: "2026-09-15T03:04:00Z" }}
        onToggleReaction={vi.fn()}
      />,
    );

    expect(screen.getByText(/đã sửa.*1 phút trước|edited.*1 minute ago/i)).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("thu gọn cả thread và hiện preview cùng số reply", () => {
    render(
      <TaskCommentCard
        comment={base}
        replies={[{ ...base, id: "c2", parent_id: "c1", body: "trả lời" }]}
        onToggleReaction={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /thu gọn|collapse/i }));

    expect(screen.getByText(/1 trả lời|1 reply/i)).toBeInTheDocument();
    expect(screen.queryByText("trả lời")).not.toBeInTheDocument();
    expect(screen.getByText("một")).toBeInTheDocument();
  });

  it("đưa action thứ cấp vào menu ba chấm thay vì dàn ngang", () => {
    render(
      <TaskCommentCard
        comment={base}
        onToggleReaction={vi.fn()}
        onEdit={vi.fn().mockResolvedValue(true)}
        onResolveToggle={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: /^sửa$|^edit$/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /thao tác bình luận|comment actions/i }));
    expect(screen.getByRole("menuitem", { name: /^sửa$|^edit$/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /đánh dấu đã xử lý|resolve/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /^xóa$|^delete$/i })).toBeInTheDocument();
  });

  it("dùng đúng tên từng người reaction trong nhãn và tooltip", () => {
    render(
      <TaskCommentCard
        comment={{
          ...base,
          reactions: [
            { id: "r2", comment_id: "c1", actor_type: "member", actor_id: "u2", emoji: "👍", created_at: "2026-09-15T03:01:00Z" },
          ],
        }}
        onToggleReaction={vi.fn()}
        getActorName={(_type, id) => (id === "u2" ? "Lan" : "Me")}
      />,
    );

    expect(screen.getByRole("button", { name: /👍 1: Lan/ })).toBeInTheDocument();
  });

  it("hiển thị avatar tài khoản của tác giả", () => {
    render(
      <TaskCommentCard
        comment={{
          ...base,
          author: {
            id: "u1",
            kind: "human",
            display_name: "Me",
            avatar_url: "/uploads/avatars/me.png",
          },
        }}
        onToggleReaction={vi.fn()}
      />,
    );
    expect(screen.getByRole("img", { name: "Me" })).toHaveAttribute(
      "src",
      "/uploads/avatars/me.png",
    );
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

    fireEvent.click(screen.getByRole("button", { name: /thao tác bình luận|comment actions/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^xóa$|^delete$/i }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /xóa bình luận|delete comment/i }),
    );
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
