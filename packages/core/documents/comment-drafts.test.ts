import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/endpoints/auth", () => ({
  refreshSession: vi.fn(),
  logout: vi.fn(),
}));

import { resetAuthStoreForTests, useAuthStore } from "../auth/store";
import { defaultStorage } from "../platform/storage";
import { clearWorkspaceStorage } from "../platform/storage-cleanup";
import type { User } from "../types/user";
import {
  documentCommentDraftKey,
  useDocumentCommentDraftStore,
  type DocumentCommentDraftTarget,
} from "./comment-drafts";

const STORAGE_KEY = "uniwork_document_comment_drafts";

function makeUser(id: string): User {
  return {
    id,
    email: `${id}@example.com`,
    display_name: id,
    onboarded_at: null,
    email_verified_at: "2026-08-25T00:00:00Z",
    onboarding_questionnaire: {},
    locale: "vi",
  };
}

const userA = makeUser("user-a");
const userB = makeUser("user-b");

function target(over: Partial<DocumentCommentDraftTarget> = {}): DocumentCommentDraftTarget {
  return {
    accountId: userA.id,
    orgId: "org-1",
    wsId: "ws-1",
    documentId: "doc-1",
    ...over,
  };
}

beforeEach(() => {
  resetAuthStoreForTests();
  useAuthStore.getState().setUser(userA);
  useDocumentCommentDraftStore.setState({ drafts: {}, ownerId: null });
  defaultStorage.removeItem(STORAGE_KEY);
});

describe("document comment draft store", () => {
  it("khóa nháp gồm account/org/workspace/document/parent", () => {
    expect(documentCommentDraftKey(target())).toBe("user-a/org-1/ws-1/doc-1/root");
    expect(documentCommentDraftKey(target({ parentId: "c1" }))).toBe("user-a/org-1/ws-1/doc-1/c1");
    // Cùng tài liệu nhưng khác workspace/org/account là khóa khác.
    expect(documentCommentDraftKey(target({ wsId: "ws-2" }))).not.toBe(documentCommentDraftKey(target()));
    expect(documentCommentDraftKey(target({ orgId: "org-2" }))).not.toBe(documentCommentDraftKey(target()));
    expect(documentCommentDraftKey(target({ accountId: userB.id }))).not.toBe(documentCommentDraftKey(target()));
  });

  it("giữ nháp theo từng khóa: hộp gốc và hộp trả lời của cùng tài liệu khác nhau", () => {
    const root = documentCommentDraftKey(target());
    const reply = documentCommentDraftKey(target({ parentId: "c1" }));
    useDocumentCommentDraftStore.getState().setDraft(root, "đang gõ dở");
    useDocumentCommentDraftStore.getState().setDraft(reply, "trả lời dở");
    expect(useDocumentCommentDraftStore.getState().draftFor(root)).toBe("đang gõ dở");
    expect(useDocumentCommentDraftStore.getState().draftFor(reply)).toBe("trả lời dở");
  });

  it("không đọc được nháp của tài khoản khác, kể cả khi biết khóa", () => {
    const mine = documentCommentDraftKey(target());
    useDocumentCommentDraftStore.getState().setDraft(mine, "nháp của A");
    const theirs = documentCommentDraftKey(target({ accountId: userB.id }));
    expect(useDocumentCommentDraftStore.getState().draftFor(theirs)).toBe("");
    // Và không ghi được vào khóa mang tên tài khoản khác.
    useDocumentCommentDraftStore.getState().setDraft(theirs, "chen vào");
    expect(useDocumentCommentDraftStore.getState().drafts[theirs]).toBeUndefined();
  });

  it("khi không còn phiên đăng nhập, đọc trả rỗng và ghi bị từ chối", async () => {
    const key = documentCommentDraftKey(target());
    useDocumentCommentDraftStore.getState().setDraft(key, "của phiên cũ");
    await useAuthStore.getState().logout();

    expect(useDocumentCommentDraftStore.getState().draftFor(key)).toBe("");
    useDocumentCommentDraftStore.getState().setDraft(key, "viết sau khi đăng xuất");
    useDocumentCommentDraftStore.getState().clearDraft(key);
    expect(useDocumentCommentDraftStore.getState().drafts[key]).toBe("của phiên cũ");
  });

  it("xoá nháp sau khi gửi và không giữ khóa rỗng", () => {
    const key = documentCommentDraftKey(target());
    useDocumentCommentDraftStore.getState().setDraft(key, "x");
    useDocumentCommentDraftStore.getState().clearDraft(key);
    expect(useDocumentCommentDraftStore.getState().draftFor(key)).toBe("");

    useDocumentCommentDraftStore.getState().setDraft(key, "x");
    useDocumentCommentDraftStore.getState().setDraft(key, "   ");
    expect(Object.keys(useDocumentCommentDraftStore.getState().drafts)).toEqual([]);
  });

  it("nháp của A bị xoá khỏi bộ nhớ và storage khi B đăng nhập", () => {
    const key = documentCommentDraftKey(target());
    useDocumentCommentDraftStore.getState().setDraft(key, "nháp chưa gửi của A");
    expect(defaultStorage.getItem(STORAGE_KEY)).toContain("nháp chưa gửi của A");

    useAuthStore.getState().setUser(userB);

    expect(useDocumentCommentDraftStore.getState().draftFor(key)).toBe("");
    expect(useDocumentCommentDraftStore.getState().drafts).toEqual({});
    expect(defaultStorage.getItem(STORAGE_KEY) ?? "").not.toContain("nháp chưa gửi của A");
  });

  it("tự đăng ký vào sổ dọn nháp nên xoá workspace là xoá được khóa toàn cục", () => {
    const adapter = {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };

    clearWorkspaceStorage(adapter, "ws_123");

    expect(adapter.removeItem).toHaveBeenCalledWith(STORAGE_KEY);
    expect(adapter.removeItem).not.toHaveBeenCalledWith(`${STORAGE_KEY}:ws_123`);
  });
});
