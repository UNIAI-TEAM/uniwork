import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import { useCreateTaskDraftStore } from "@uniwork/core/tasks/stores/create-task-draft-store";
import type { User } from "@uniwork/core/types";
import { CreateTaskDraftTray } from "./create-task-draft-tray";

initI18n();

const user: User = {
  id: "u1",
  email: "drafts@example.com",
  display_name: "Draft owner",
  onboarded_at: "2026-09-01T00:00:00Z",
  email_verified_at: "2026-09-01T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};

describe("CreateTaskDraftTray", () => {
  beforeEach(() => {
    setSessionUser(user);
    useCreateTaskDraftStore.setState({
      drafts: {},
      activeDraftIds: {},
      settings: {},
      ownerId: null,
    });
  });

  it("shows only drafts from the current workspace and opens the selected draft", () => {
    const store = useCreateTaskDraftStore.getState();
    store.saveDraft("ws1", { title: "Rà soát hợp đồng", idempotencyKey: "draft-a" });
    store.deactivateDraft("ws1");
    store.saveDraft("ws1", { title: "Gửi báo cáo", idempotencyKey: "draft-b" });
    store.deactivateDraft("ws1");
    store.saveDraft("ws2", { title: "Không hiển thị", idempotencyKey: "draft-c" });
    const onOpenDraft = vi.fn();

    render(<CreateTaskDraftTray workspaceId="ws1" onOpenDraft={onOpenDraft} />);

    const tray = screen.getByRole("region", { name: "Bản nháp" });
    expect(tray).toHaveClass("h-10", "w-full", "shrink-0", "border-t");
    expect(tray).not.toHaveClass("absolute");
    expect(screen.getByRole("button", { name: "Mở bản nháp Rà soát hợp đồng" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mở bản nháp Gửi báo cáo" })).toBeInTheDocument();
    expect(screen.queryByText("Không hiển thị")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Mở bản nháp Rà soát hợp đồng" }));

    expect(useCreateTaskDraftStore.getState().draftFor("ws1")?.idempotencyKey).toBe("draft-a");
    expect(onOpenDraft).toHaveBeenCalledOnce();
  });

  it("deletes one draft without removing its siblings", () => {
    const store = useCreateTaskDraftStore.getState();
    store.saveDraft("ws1", { title: "Việc A", idempotencyKey: "draft-a" });
    store.saveDraft("ws1", { title: "Việc B", idempotencyKey: "draft-b" });

    render(<CreateTaskDraftTray workspaceId="ws1" onOpenDraft={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Xóa bản nháp Việc A" }));

    expect(screen.queryByText("Việc A")).not.toBeInTheDocument();
    expect(screen.getByText("Việc B")).toBeInTheDocument();
    expect(store.draftFor("ws1", "draft-b")?.title).toBe("Việc B");
  });

  it("stays hidden while the composer has not been explicitly saved", () => {
    useCreateTaskDraftStore.getState().setDraft("ws1", {
      title: "Đang nhập",
      idempotencyKey: "working-draft",
    });

    render(<CreateTaskDraftTray workspaceId="ws1" onOpenDraft={() => {}} />);

    expect(screen.queryByRole("region", { name: "Bản nháp" })).not.toBeInTheDocument();
  });
});
