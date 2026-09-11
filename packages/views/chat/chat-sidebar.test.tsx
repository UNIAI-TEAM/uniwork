import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import {
  resetChatRoomPreferencesForTests,
  useChatRoomPreferencesStore,
} from "@uniwork/core/chat/room-preferences-store";
import { wrap } from "../test/api-mock";
import { ChatSidebar } from "./chat-sidebar";

vi.mock("@uniwork/core/workspaces", () => ({
  useMyInvitations: () => ({ data: [] }),
  useAcceptInvite: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("./start-dm-dialog", () => ({
  StartDmDialog: () => null,
}));

vi.mock("./create-group-dialog", () => ({
  CreateGroupDialog: () => null,
}));

vi.mock("./create-channel-dialog", () => ({
  CreateChannelDialog: () => null,
}));

vi.mock("./channel-directory-sheet", () => ({
  ChannelDirectorySheet: () => null,
}));

const contact = {
  user_id: "u2",
  email: "binh@example.com",
  display_name: "Binh",
  dm_room_id: "dm1",
};

const group = {
  id: "g1",
  name: "Design",
  room_id: "room-g1",
  member_user_ids: ["u3"],
};

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  resetChatRoomPreferencesForTests();
});

describe("ChatSidebar", () => {
  it("filters conversations and switches targets", () => {
    const onTargetChange = vi.fn();
    const onCreateGroup = vi.fn();

    render(
      wrap(
        <ChatSidebar
          currentUserId="self"
          workspaceId="ws1"
          target={{ kind: "workspace" }}
          onTargetChange={onTargetChange}
          contacts={[contact]}
          groups={[group]}
          onCreateGroup={onCreateGroup}
          workspaceRoomId="room-ws"
          unreadByRoomId={{ "room-ws": 2, dm1: 1, "room-g1": 3 }}
          unreadBadgesReady
        />,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: /Design/ }));
    expect(onTargetChange).toHaveBeenCalledWith({ kind: "group", group });

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "binh" } });
    fireEvent.click(screen.getByRole("button", { name: /Binh/ }));
    expect(onTargetChange).toHaveBeenCalledWith({ kind: "dm", contact });
  });

  it("shows a flat list with kind filters instead of section headers", () => {
    render(
      wrap(
        <ChatSidebar
          currentUserId="self"
          workspaceId="ws1"
          target={{ kind: "workspace" }}
          onTargetChange={vi.fn()}
          contacts={[]}
          groups={[]}
        />,
      ),
    );

    expect(screen.queryByText(/Chưa có nhóm nào/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Chưa có cuộc trò chuyện/)).not.toBeInTheDocument();
    expect(screen.getByRole("toolbar", { name: /Lọc cuộc trò chuyện/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tất cả", pressed: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tin nhắn", pressed: false })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Chung/ })).toBeInTheDocument();
  });

  it("kind filter hides other conversation types", () => {
    render(
      wrap(
        <ChatSidebar
          currentUserId="self"
          workspaceId="ws1"
          target={{ kind: "workspace" }}
          onTargetChange={vi.fn()}
          contacts={[contact]}
          groups={[group]}
          workspaceRoomId="room-ws"
        />,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Tin nhắn" }));
    expect(screen.getByRole("button", { name: /Binh/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Design/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Chung/ })).not.toBeInTheDocument();
  });

  it("shows contact nickname in conversation list", () => {
    render(
      wrap(
        <ChatSidebar
          currentUserId="self"
          workspaceId="ws1"
          target={{ kind: "workspace" }}
          onTargetChange={vi.fn()}
          contacts={[contact]}
          groups={[]}
          nicknamesByUserId={{ u2: "Bạn Binh" }}
        />,
      ),
    );

    expect(screen.getByRole("button", { name: /Bạn Binh/ })).toBeInTheDocument();
  });

  it("shows mute and pin indicators on separate rows like Zalo", () => {
    useChatRoomPreferencesStore.getState().togglePinned("dm1");
    useChatRoomPreferencesStore.getState().toggleNotificationsMuted("dm1");

    render(
      wrap(
        <ChatSidebar
          currentUserId="self"
          workspaceId="ws1"
          target={{ kind: "workspace" }}
          onTargetChange={vi.fn()}
          contacts={[contact]}
          groups={[]}
          roomPreviewsByRoomId={{
            dm1: {
              body: "hello",
              kind: "text",
              senderId: "u2",
              senderName: "Binh",
              createdAt: "2026-09-04T15:18:00.000Z",
            },
          }}
        />,
      ),
    );

    expect(screen.getByLabelText("Hội thoại đã ghim")).toBeInTheDocument();
    expect(screen.getByLabelText("Đã tắt thông báo")).toBeInTheDocument();
  });
});
