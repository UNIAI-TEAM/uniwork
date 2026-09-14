import { describe, expect, it } from "vitest";
import type { TaskComment } from "@uniwork/core/types";
import { buildCommentThreads } from "./comment-thread";

const c = (over: Partial<TaskComment> & { id: string }): TaskComment => ({
  task_id: "t1",
  author_id: "u1",
  author_kind: "human",
  body: "x",
  type: "comment",
  revision: 1,
  reactions: [],
  ...over,
});

/** Total comments rendered across every thread — must always equal the input count. */
function countOut(threads: ReturnType<typeof buildCommentThreads>): number {
  return threads.reduce((n, t) => n + 1 + t.replies.length, 0);
}

describe("buildCommentThreads", () => {
  it("gom trả lời vào đúng bình luận gốc", () => {
    const threads = buildCommentThreads([
      c({ id: "r1", created_at: "2026-09-13T10:00:00Z" }),
      c({ id: "a1", parent_id: "r1", created_at: "2026-09-13T10:05:00Z" }),
      c({ id: "r2", created_at: "2026-09-13T11:00:00Z" }),
    ]);
    expect(threads.map((t) => t.root.id)).toEqual(["r1", "r2"]);
    expect(threads[0]?.replies.map((r) => r.id)).toEqual(["a1"]);
    expect(threads[1]?.replies).toEqual([]);
  });

  it("sắp xếp gốc và trả lời theo thời gian, cũ trước", () => {
    const threads = buildCommentThreads([
      c({ id: "r2", created_at: "2026-09-13T11:00:00Z" }),
      c({ id: "a2", parent_id: "r2", created_at: "2026-09-13T11:20:00Z" }),
      c({ id: "a1", parent_id: "r2", created_at: "2026-09-13T11:10:00Z" }),
      c({ id: "r1", created_at: "2026-09-13T10:00:00Z" }),
    ]);
    expect(threads.map((t) => t.root.id)).toEqual(["r1", "r2"]);
    expect(threads[1]?.replies.map((r) => r.id)).toEqual(["a1", "a2"]);
  });

  it("giữ trả lời mồ côi như một luồng riêng thay vì làm nó biến mất", () => {
    const input = [
      c({ id: "a1", parent_id: "khong-ton-tai", created_at: "2026-09-13T10:00:00Z" }),
    ];
    const threads = buildCommentThreads(input);
    expect(threads.map((t) => t.root.id)).toEqual(["a1"]);
    expect(countOut(threads)).toBe(input.length);
  });

  it("chuỗi ba cấp A → B → C: cả B lẫn C đều nằm trong luồng của A, không mất gì", () => {
    const input = [
      c({ id: "a", created_at: "2026-09-13T10:00:00Z" }),
      c({ id: "b", parent_id: "a", created_at: "2026-09-13T10:05:00Z" }),
      c({ id: "c", parent_id: "b", created_at: "2026-09-13T10:10:00Z" }),
    ];
    const threads = buildCommentThreads(input);

    expect(threads.map((t) => t.root.id)).toEqual(["a"]);
    expect(threads[0]?.replies.map((r) => r.id)).toEqual(["b", "c"]);
    expect(countOut(threads)).toBe(input.length);
  });

  it("chu trình giữa hai bình luận không treo và không làm mất bình luận nào", () => {
    const input = [
      c({ id: "x", parent_id: "y", created_at: "2026-09-13T10:00:00Z" }),
      c({ id: "y", parent_id: "x", created_at: "2026-09-13T10:05:00Z" }),
    ];
    const threads = buildCommentThreads(input);

    expect(threads.map((t) => t.root.id).sort()).toEqual(["x", "y"]);
    expect(countOut(threads)).toBe(input.length);
  });
});
