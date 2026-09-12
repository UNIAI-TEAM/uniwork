import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearWorkspaceStorage } from "../../platform/storage-cleanup";
import { useCommentDraftStore } from "./comment-draft-store";

describe("comment draft store", () => {
  beforeEach(() => {
    useCommentDraftStore.setState({ drafts: {} });
  });

  it("giữ nháp theo từng khóa", () => {
    useCommentDraftStore.getState().setDraft("t1", "đang gõ dở");
    useCommentDraftStore.getState().setDraft("t1:r1", "trả lời dở");
    expect(useCommentDraftStore.getState().draftFor("t1")).toBe("đang gõ dở");
    expect(useCommentDraftStore.getState().draftFor("t1:r1")).toBe("trả lời dở");
  });

  it("trả chuỗi rỗng cho khóa chưa có nháp", () => {
    expect(useCommentDraftStore.getState().draftFor("chua-co")).toBe("");
  });

  it("xoá nháp sau khi gửi xong", () => {
    useCommentDraftStore.getState().setDraft("t1", "x");
    useCommentDraftStore.getState().clearDraft("t1");
    expect(useCommentDraftStore.getState().draftFor("t1")).toBe("");
  });

  it("không giữ lại khóa rỗng, để store khỏi phình theo thời gian", () => {
    useCommentDraftStore.getState().setDraft("t1", "x");
    useCommentDraftStore.getState().setDraft("t1", "   ");
    expect(Object.keys(useCommentDraftStore.getState().drafts)).toEqual([]);
  });

  it("tự đăng ký vào sổ dọn nháp, nên đăng xuất/xoá workspace là xoá được", () => {
    const adapter = {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };

    clearWorkspaceStorage(adapter, "ws_123");

    // Bare key, no `:slug` suffix — the store persists through
    // `defaultStorage`, not `createWorkspaceAwareStorage`, so registering it
    // as workspace-scoped would remove a key that never existed and leave the
    // real one behind.
    expect(adapter.removeItem).toHaveBeenCalledWith(
      "uniwork_task_comment_drafts",
    );
    expect(adapter.removeItem).not.toHaveBeenCalledWith(
      "uniwork_task_comment_drafts:ws_123",
    );
  });
});
