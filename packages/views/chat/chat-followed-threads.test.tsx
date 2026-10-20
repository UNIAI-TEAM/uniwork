import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getI18n } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { requestMock, wrap } from "../test/api-mock";
import { ChatFollowedThreadsSheet } from "./chat-followed-threads-sheet";

const user = {
  id: "u1",
  email: "a@b.co",
  display_name: "A",
  onboarded_at: null,
  email_verified_at: null,
  onboarding_questionnaire: {},
  locale: "vi",
  has_password: true,
};

const t = (key: string) => getI18n().t(key);

const thread = (id: string, extra: Record<string, unknown> = {}) => ({
  thread_root_id: id,
  room_id: "room-ch",
  workspace_id: "ws1",
  root_body: `Tin gốc ${id}`,
  reply_count: 2,
  unread: false,
  ...extra,
});

beforeEach(() => {
  requestMock.mockReset();
  resetAuthStoreForTests();
  setSessionUser(user);
});

describe("ChatFollowedThreadsSheet", () => {
  it("lists threads and navigates with the root message as anchor", async () => {
    requestMock.mockResolvedValue({
      threads: [thread("root1", { unread: true }), thread("root2")],
    });
    const onOpenThread = vi.fn();
    render(
      wrap(
        <ChatFollowedThreadsSheet
          open
          onOpenChange={vi.fn()}
          workspaceId="ws1"
          onOpenThread={onOpenThread}
        />,
      ),
    );
    await screen.findByText("Tin gốc root1");
    expect(screen.getByText("Tin gốc root2")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Tin gốc root1"));
    expect(onOpenThread).toHaveBeenCalledWith(expect.objectContaining({ thread_root_id: "root1", room_id: "room-ch" }));
  });

  it("shows empty state when the list is empty", async () => {
    requestMock.mockResolvedValue({ threads: [] });
    render(
      wrap(
        <ChatFollowedThreadsSheet open onOpenChange={vi.fn()} workspaceId="ws1" onOpenThread={vi.fn()} />,
      ),
    );
    expect(await screen.findByText(t("chat.followed_threads.empty_hint"))).toBeInTheDocument();
  });

  it("shows empty state when the response is malformed", async () => {
    requestMock.mockResolvedValue({ nope: true });
    render(
      wrap(
        <ChatFollowedThreadsSheet open onOpenChange={vi.fn()} workspaceId="ws1" onOpenThread={vi.fn()} />,
      ),
    );
    await waitFor(() => {
      expect(screen.getByText(t("chat.followed_threads.empty_hint"))).toBeInTheDocument();
    });
  });
});
