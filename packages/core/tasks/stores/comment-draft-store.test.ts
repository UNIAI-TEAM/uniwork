import { beforeEach, describe, expect, it } from "vitest";
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
});
