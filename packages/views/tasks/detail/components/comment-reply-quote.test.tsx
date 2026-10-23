import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { TaskComment } from "@uniwork/core/types";
import { TaskCommentReplyQuote } from "./comment-reply-quote";

initI18n();

function makeComment(body: string): TaskComment {
  return {
    id: "c1",
    task_id: "t1",
    author_id: "u1",
    author_kind: "human",
    display_name: "Ngọc",
    body,
    type: "comment",
    revision: 1,
    reactions: [],
  };
}

describe("TaskCommentReplyQuote", () => {
  it("hiện chữ rút gọn từ nội dung Markdown", () => {
    render(<TaskCommentReplyQuote comment={makeComment("Xem **tài liệu** này")} />);
    expect(screen.getByTestId("reply-quote-c1")).toHaveTextContent("Xem tài liệu này");
  });

  it("hiện nhãn thay thế khi nội dung chỉ có khối code (rút gọn ra chuỗi rỗng)", () => {
    render(<TaskCommentReplyQuote comment={makeComment("```js\nconst a = 1;\n```")} />);
    expect(screen.getByTestId("reply-quote-c1")).toHaveTextContent(
      "Bình luận không có chữ",
    );
  });
});
