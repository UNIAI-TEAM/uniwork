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
    useCreateTaskDraftStore.setState({ drafts: {}, settings: {}, ownerId: null });
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
