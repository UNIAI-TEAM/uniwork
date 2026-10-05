import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/endpoints/auth", () => ({
  refreshSession: vi.fn(),
  logout: vi.fn(),
}));

import { resetAuthStoreForTests, useAuthStore } from "../../auth/store";
import type { User } from "../../types/user";
import { useCreateTaskDraftStore } from "./create-task-draft-store";

const user: User = {
  id: "u1",
  email: "a@b.c",
  display_name: "A",
  onboarded_at: null,
  email_verified_at: "2026-08-25T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};

describe("create task draft store", () => {
  beforeEach(() => {
    resetAuthStoreForTests();
    useAuthStore.getState().setUser(user);
    useCreateTaskDraftStore.setState({
      drafts: {},
      activeDraftIds: {},
      settings: {},
      ownerId: null,
    });
  });

  it("keeps drafts isolated by workspace", () => {
    useCreateTaskDraftStore.getState().setDraft("ws1", {
      title: "Việc A",
      idempotencyKey: "key-a",
    });
    useCreateTaskDraftStore.getState().setDraft("ws2", {
      title: "Việc B",
      idempotencyKey: "key-b",
    });

    expect(useCreateTaskDraftStore.getState().draftFor("ws1")?.title).toBe("Việc A");
    expect(useCreateTaskDraftStore.getState().draftFor("ws2")?.title).toBe("Việc B");
  });

  it("keeps multiple drafts in one workspace and activates them independently", () => {
    const store = useCreateTaskDraftStore.getState();
    store.saveDraft("ws1", { title: "Việc A", idempotencyKey: "key-a" });
    store.deactivateDraft("ws1");
    store.saveDraft("ws1", { title: "Việc B", idempotencyKey: "key-b" });

    expect(store.draftsFor("ws1").map((draft) => draft.title)).toEqual(["Việc A", "Việc B"]);
    expect(useCreateTaskDraftStore.getState().draftFor("ws1")?.title).toBe("Việc B");

    store.activateDraft("ws1", "key-a");
    expect(useCreateTaskDraftStore.getState().draftFor("ws1")?.title).toBe("Việc A");
  });

  it("deactivates a saved draft so the next composer starts fresh", () => {
    const store = useCreateTaskDraftStore.getState();
    store.saveDraft("ws1", { title: "Đang rà soát", idempotencyKey: "key-a" });
    store.deactivateDraft("ws1", "key-a");

    expect(store.draftFor("ws1")).toBeNull();
    expect(store.draftFor("ws1", "key-a")?.title).toBe("Đang rà soát");
  });

  it("does not list a working composer as a draft and discards it on close", () => {
    const store = useCreateTaskDraftStore.getState();
    store.setDraft("ws1", { title: "Chưa bấm lưu", idempotencyKey: "working-key" });

    expect(store.draftsFor("ws1")).toEqual([]);

    store.closeDraft("ws1");

    expect(store.draftFor("ws1", "working-key")).toBeNull();
  });

  it("migrates the previous single-draft storage without losing content", async () => {
    localStorage.setItem(
      "uniwork_create_task_drafts",
      JSON.stringify({
        version: 0,
        state: {
          drafts: {
            ws1: { title: "Bản nháp cũ", description: "Giữ lại", idempotencyKey: "legacy-key" },
          },
          settings: {},
          ownerId: "u1",
        },
      }),
    );

    await useCreateTaskDraftStore.persist.rehydrate();

    expect(useCreateTaskDraftStore.getState().draftFor("ws1")).toMatchObject({
      title: "Bản nháp cũ",
      description: "Giữ lại",
      idempotencyKey: "legacy-key",
    });
  });

  it("prunes a blank draft instead of growing forever", () => {
    useCreateTaskDraftStore.getState().setDraft("ws1", {
      title: "Việc A",
      idempotencyKey: "same-key",
    });
    useCreateTaskDraftStore.getState().setDraft("ws1", {
      title: "   ",
      description: "  ",
      idempotencyKey: "same-key",
    });

    expect(useCreateTaskDraftStore.getState().draftFor("ws1")).toBeNull();
  });

  it("keeps an agent prompt and actor even when the manual fields are blank", () => {
    useCreateTaskDraftStore.getState().setDraft("ws1", {
      title: "",
      agentPrompt: "Điều tra lỗi đăng nhập",
      agentId: "agent-1",
      idempotencyKey: "agent-key",
    });

    expect(useCreateTaskDraftStore.getState().draftFor("ws1")).toMatchObject({
      agentPrompt: "Điều tra lỗi đăng nhập",
      agentId: "agent-1",
    });
  });

  it("keeps the idempotency key until the accepted draft is cleared", () => {
    useCreateTaskDraftStore.getState().setDraft("ws1", {
      title: "Việc A",
      idempotencyKey: "retry-key",
    });

    expect(useCreateTaskDraftStore.getState().draftFor("ws1")?.idempotencyKey).toBe("retry-key");
    useCreateTaskDraftStore.getState().clearDraft("ws1", "different-key");
    expect(useCreateTaskDraftStore.getState().draftFor("ws1")?.idempotencyKey).toBe("retry-key");
    useCreateTaskDraftStore.getState().clearDraft("ws1", "retry-key");
    expect(useCreateTaskDraftStore.getState().draftFor("ws1")).toBeNull();
  });

  it("clears only the submitted draft", () => {
    const store = useCreateTaskDraftStore.getState();
    store.saveDraft("ws1", { title: "Việc A", idempotencyKey: "key-a" });
    store.deactivateDraft("ws1");
    store.saveDraft("ws1", { title: "Việc B", idempotencyKey: "key-b" });

    store.clearDraft("ws1", "key-a");

    expect(store.draftsFor("ws1").map((draft) => draft.title)).toEqual(["Việc B"]);
    expect(store.draftFor("ws1")?.title).toBe("Việc B");
  });

  it("does not clear a newer edit when an older submit resolves late", () => {
    useCreateTaskDraftStore.getState().setDraft("ws1", {
      title: "Bản gửi",
      idempotencyKey: "same-key",
      version: 1,
    });
    useCreateTaskDraftStore.getState().setDraft("ws1", {
      title: "Bản mới hơn",
      idempotencyKey: "same-key",
      version: 2,
    });

    useCreateTaskDraftStore.getState().clearDraft("ws1", "same-key", 1);

    expect(useCreateTaskDraftStore.getState().draftFor("ws1")?.title).toBe("Bản mới hơn");
  });

  it("refuses writes without a signed-in owner", async () => {
    await useAuthStore.getState().logout();
    useCreateTaskDraftStore.getState().setDraft("ws1", {
      title: "Không được lưu",
      idempotencyKey: "key-a",
    });

    expect(useCreateTaskDraftStore.getState().draftFor("ws1")).toBeNull();
  });

  it("remembers create settings per workspace", () => {
    useCreateTaskDraftStore.getState().setSettings("ws1", {
      status: "in_review",
      priority: "high",
      projectId: "project-1",
      stage: "2",
    });

    expect(useCreateTaskDraftStore.getState().settingsFor("ws1")).toEqual({
      status: "in_review",
      priority: "high",
      projectId: "project-1",
      stage: "2",
    });
    expect(useCreateTaskDraftStore.getState().settingsFor("ws2")).toBeNull();
  });
});
