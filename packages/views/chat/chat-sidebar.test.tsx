import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import {
  resetChatRoomPreferencesForTests,
  useChatRoomPreferencesStore,
} from "@uniwork/core/chat/room-preferences-store";
import { QueryClient } from "@tanstack/react-query";
import { chatKeys } from "@uniwork/core/chat";
import { fakeNav, wrapWithNav } from "../test/api-mock";
import { WorkspaceProvider } from "../layout/workspace-context";
import { ChatSidebar } from "./chat-sidebar";

const invitesMock = vi.hoisted(() => ({
  invites: [] as unknown[],
}));

vi.mock("@uniwork/core/workspaces", () => ({
  useMyInvitations: () => ({ data: invitesMock.invites }),
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
  invitesMock.invites = [];
});

function renderSidebar(props: Partial<Parameters<typeof ChatSidebar>[0]> = {}) {
  return render(
    wrapWithNav(
      <ChatSidebar
        currentUserId="self"
        workspaceId="ws1"
        target={{ kind: "workspace" }}
        onTargetChange={vi.fn()}
        contacts={[contact]}
        groups={[group]}
        workspaceRoomId="room-ws"
        {...props}
      />,
    ),
  );
}

describe("ChatSidebar", () => {
  it("filters conversations and switches targets", () => {
    const onTargetChange = vi.fn();
    const onCreateGroup = vi.fn();

    render(
      wrapWithNav(
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
      wrapWithNav(
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
    expect(screen.getByRole("group", { name: /Lọc cuộc trò chuyện/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tất cả", pressed: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Riêng", pressed: false })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Chung/ })).toBeInTheDocument();
  });

  it("kind filter hides other conversation types", () => {
    render(
      wrapWithNav(
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

    fireEvent.click(screen.getByRole("button", { name: "Riêng" }));
    expect(screen.getByRole("button", { name: /Binh/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Design/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Chung/ })).not.toBeInTheDocument();
  });

  it("shows contact nickname in conversation list", () => {
    render(
      wrapWithNav(
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
    // The mute comes from the server's rooms list, not this browser (UNI-1697).
    const client = new QueryClient();
    client.setQueryData(chatKeys.rooms("ws1"), [
      { id: "dm1", kind: "dm", name: "Binh", workspace_id: "ws1", member_user_ids: [], notifications_muted: true },
    ]);

    render(
      wrapWithNav(
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
        fakeNav(),
        client,
      ),
    );

    expect(screen.getByLabelText("Hội thoại đã ghim")).toBeInTheDocument();
    expect(screen.getByLabelText("Đã tắt thông báo")).toBeInTheDocument();
  });

  it("keeps a muted room's unread count, in grey, and drops the pin while there is one", () => {
    useChatRoomPreferencesStore.getState().togglePinned("dm1");
    const client = new QueryClient();
    client.setQueryData(chatKeys.rooms("ws1"), [
      { id: "dm1", kind: "dm", name: "Binh", workspace_id: "ws1", member_user_ids: [], notifications_muted: true },
    ]);
    render(
      wrapWithNav(
        <ChatSidebar
          currentUserId="self"
          workspaceId="ws1"
          target={{ kind: "workspace" }}
          onTargetChange={vi.fn()}
          contacts={[contact]}
          groups={[]}
          unreadByRoomId={{ dm1: 14 }}
          unreadBadgesReady
        />,
        fakeNav(),
        client,
      ),
    );
    expect(screen.getByLabelText("14 tin nhắn chưa đọc")).toHaveClass("bg-tint-gray-solid");
    expect(screen.queryByLabelText("Hội thoại đã ghim")).not.toBeInTheDocument();
  });

  it("sets a group preview's sender apart from the body, and keeps both in the row's name", () => {
    renderSidebar({
      roomPreviewsByRoomId: {
        "room-g1": { body: "hello: there", kind: "text", senderId: "u3", senderName: "Minh", createdAt: "2026-09-04T15:18:00.000Z" },
      },
    });
    expect(screen.getByText("Minh:")).toHaveClass("text-foreground");
    expect(screen.getByRole("button", { name: /Design.*Minh: hello: there/ })).toBeInTheDocument();
  });

  it("keeps one row in the tab order and moves between rows with the arrow keys", () => {
    const onTargetChange = vi.fn();
    renderSidebar({ onTargetChange, target: { kind: "group", group } });

    const rows = screen.getAllByRole("button").filter((el) => el.hasAttribute("data-chat-sidebar-row"));
    expect(rows).toHaveLength(3);
    // The open conversation is the tab stop.
    const active = rows.find((row) => row.getAttribute("aria-current") === "true")!;
    expect(active).toHaveAttribute("tabindex", "0");
    expect(rows.filter((row) => row.getAttribute("tabindex") === "0")).toHaveLength(1);

    // @testing-library/user-event is not a dependency here; the list listens
    // for keydown, which fireEvent drives the same way.
    const key = (k: string) => fireEvent.keyDown(document.activeElement!, { key: k });
    active.focus();
    key("Home");
    expect(rows[0]).toHaveFocus();
    key("End");
    expect(rows[2]).toHaveFocus();
    key("ArrowUp");
    expect(rows[1]).toHaveFocus();
    expect(rows[1]).toHaveAttribute("tabindex", "0");
    expect(rows[2]).toHaveAttribute("tabindex", "-1");
    // Rows are buttons: Enter activates the focused one natively.
    fireEvent.click(document.activeElement!);
    expect(onTargetChange).toHaveBeenCalledTimes(1);
  });

  it("does not announce another room's typing", () => {
    renderSidebar();
    for (const row of screen.getAllByRole("button").filter((el) => el.hasAttribute("data-chat-sidebar-row"))) {
      expect(row.querySelector("[aria-live]")).toBeNull();
    }
  });

  it("finds a conversation without its accents", () => {
    renderSidebar({ groups: [{ ...group, name: "Thiết kế" }] });
    fireEvent.change(screen.getByRole("searchbox", { name: "Tìm cuộc trò chuyện" }), {
      target: { value: "thiet ke" },
    });
    expect(screen.getByRole("button", { name: /Thiết kế/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Binh/ })).not.toBeInTheDocument();
    expect(screen.getByText("1 cuộc trò chuyện")).toHaveAttribute("role", "status");
  });

  it("says the list failed to load and offers to try again, instead of loading forever", () => {
    const onRetry = vi.fn();
    renderSidebar({ contacts: [], groups: [], loading: false, loadError: true, onRetry });
    expect(screen.getByText("Không tải được danh sách trò chuyện.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(onRetry).toHaveBeenCalled();
    expect(screen.queryByText("Đang tải…")).not.toBeInTheDocument();
  });

  it("announces its loading state", () => {
    renderSidebar({ contacts: [], groups: [], loading: true });
    expect(screen.getByText("Đang tải…").closest('[role="status"]')).not.toBeNull();
  });

  it("offers the step that fits an empty kind filter, and a way back to all", () => {
    renderSidebar({ groups: [], onCreateGroup: vi.fn() });
    fireEvent.click(screen.getByRole("button", { name: "Nhóm" }));
    expect(screen.getByText("Tạo nhóm để trò chuyện cùng vài người.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tạo nhóm chat" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Xem tất cả" }));
    expect(screen.getByRole("button", { name: "Tất cả", pressed: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Binh/ })).toBeInTheDocument();
  });

  it("keeps follow-ups and hiding the list behind the workspace name", async () => {
    const onCollapse = vi.fn();
    const onOpenFollowUps = vi.fn();
    renderSidebar({ onCollapse, onOpenFollowUps });
    const trigger = screen.getByRole("button", { name: "Tùy chọn trò chuyện trong Trò chuyện" });
    // Showing the list again lands focus on it.
    expect(trigger).toHaveAttribute("data-chat-sidebar-collapse");
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Ẩn danh sách trò chuyện" }));
    expect(onCollapse).toHaveBeenCalled();
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Việc cần theo dõi" }));
    expect(onOpenFollowUps).toHaveBeenCalled();
  });

  it("puts the counts on one tab row: notifying unread, all unread, mentions", () => {
    const client = new QueryClient();
    client.setQueryData(chatKeys.rooms("ws1"), [
      { id: "room-g1", kind: "group", name: "Design", workspace_id: "ws1", member_user_ids: [], notifications_muted: true },
    ]);
    render(
      wrapWithNav(
        <ChatSidebar
          currentUserId="self"
          workspaceId="ws1"
          target={{ kind: "workspace" }}
          onTargetChange={vi.fn()}
          contacts={[contact]}
          groups={[group]}
          workspaceRoomId="room-ws"
          unreadByRoomId={{ "room-ws": 2, dm1: 1, "room-g1": 14, gone: 5 }}
          mentionUnreadByRoomId={{ dm1: 1 }}
          unreadBadgesReady
        />,
        fakeNav(),
        client,
      ),
    );
    const tabs = screen.getByRole("group", { name: "Lọc cuộc trò chuyện" });
    // The muted group waits quietly: "All" counts two, "Unread" three; a room the list cannot show counts nowhere.
    expect(within(tabs).getByRole("button", { name: "Tất cả 2 cuộc trò chuyện", pressed: true })).toBeInTheDocument();
    expect(within(tabs).getByRole("button", { name: "Chưa đọc 3 cuộc trò chuyện" })).toBeInTheDocument();
    fireEvent.click(within(tabs).getByRole("button", { name: "Nhắc tên 1 cuộc trò chuyện" }));
    expect(screen.getByRole("button", { name: /Binh/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Design/ })).not.toBeInTheDocument();
    expect(within(tabs).getByRole("button", { name: "Riêng" })).toBeInTheDocument();
  });

  it("shows the organization over the workspace name, and no ⌘K outside UniChat", () => {
    render(
      wrapWithNav(
        <WorkspaceProvider
          workspace={{ id: "ws1", name: "Truyền thông", slug: "tt", organization_slug: "unicom", organization_name: "Unicom" } as never}
          user={{ id: "self" } as never}
        >
          <ChatSidebar
            currentUserId="self"
            workspaceId="ws1"
            target={{ kind: "workspace" }}
            onTargetChange={vi.fn()}
            contacts={[]}
            groups={[]}
          />
        </WorkspaceProvider>,
      ),
    );
    const trigger = screen.getByRole("button", { name: "Tùy chọn trò chuyện trong Truyền thông" });
    expect(within(trigger).getByText("Unicom")).toHaveClass("uppercase");
    expect(screen.getByRole("searchbox")).toHaveAttribute("placeholder", "Tìm người, nhóm, tin nhắn…");
    expect(screen.queryByText("⌘K")).not.toBeInTheDocument();
  });

  it("draws the canvas row: two-letter faces, # channels, read ticks, a photo, a voice note with its sender", () => {
    const client = new QueryClient();
    client.setQueryData(chatKeys.rooms("ws1"), [
      { id: "dm1", kind: "dm", name: "Binh", workspace_id: "ws1", member_user_ids: [], peer_last_read_at: "2026-09-04T15:20:00.000Z" },
    ]);
    render(
      wrapWithNav(
        <ChatSidebar
          currentUserId="self"
          workspaceId="ws1"
          target={{ kind: "workspace" }}
          onTargetChange={vi.fn()}
          contacts={[{ ...contact, display_name: "Nguyễn Thu Hà" }]}
          groups={[{ ...group, name: "Đội Thiết kế" }]}
          channels={[{ id: "ch1", kind: "channel", name: "thong-bao-chung", workspace_id: "ws1", member_user_ids: [], member_count: 3, unread_count: 0, mention_unread_count: 0 }]}
          roomPreviewsByRoomId={{
            dm1: { body: "Ok anh", kind: "text", senderId: "SELF", senderName: "Me", createdAt: "2026-09-04T15:18:00.000Z" },
            "room-g1": { body: "", kind: "voice", senderId: "u3", senderName: "Tuấn", createdAt: "2026-09-04T15:17:00.000Z" },
            ch1: { body: "banner.png", kind: "file", senderId: "u4", senderName: "Bảo", createdAt: "2026-09-04T15:16:00.000Z" },
          }}
        />,
        fakeNav(),
        client,
      ),
    );
    const dm = screen.getByRole("button", { name: /Nguyễn Thu Hà/ });
    expect(within(dm).getByText("TH")).toBeInTheDocument();
    expect(within(dm).getByLabelText("Đã xem")).toBeInTheDocument();
    const groupRow = screen.getByRole("button", { name: /Đội Thiết kế/ });
    expect(within(groupRow).getByText("TK")).toBeInTheDocument();
    expect(groupRow).toHaveAccessibleName(/Tuấn: Tin nhắn thoại/);
    const channelRow = screen.getByRole("button", { name: /# thong-bao-chung/ });
    expect(channelRow).toHaveAccessibleName(/Bảo: Ảnh/);
  });

  it("draws a missed call red", () => {
    renderSidebar({
      roomPreviewsByRoomId: {
        dm1: { body: "", kind: "voice_call_log", senderId: "u2", senderName: "Binh", createdAt: "2026-09-04T15:18:00.000Z", callOutcome: "unanswered" },
      },
    });
    expect(screen.getByText("Cuộc gọi nhỡ").parentElement).toHaveClass("text-destructive");
  });

  /**
   * GET /me/invitations lists invitations into any organization, and joining
   * another one is a switch: every join goes through the invitation's own
   * page (spec 2026-10-13 §6.2), so a row here only opens it.
   */
  it("opens each pending invitation on its own page instead of joining from the sidebar", () => {
    invitesMock.invites = [
      {
        id: "inv1",
        token: "tok1",
        role: "member",
        org_role: "member",
        expires_at: "2099-01-01T00:00:00Z",
        organization: { name: "Acme", slug: "acme" },
        workspace: { name: "Ops", slug: "ops" },
        invited_by: { display_name: "Lan" },
      },
    ];
    renderSidebar();

    // The link names the workspace and its organization in words, not "›".
    const link = screen.getByRole("link", { name: "Xem lời mời vào Ops trong Acme" });
    expect(link).toHaveAttribute("href", "/invite/tok1");
    expect(screen.queryByRole("button", { name: "Tham gia" })).not.toBeInTheDocument();
  });

  /** The same row as /invitations, so an invitation reads the same wherever it is listed. */
  it("lists invitations with the shared row: inviter first, then the place, role and expiry", () => {
    invitesMock.invites = [
      {
        id: "inv1",
        token: "tok1",
        role: "member",
        org_role: "admin",
        expires_at: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
        organization: { name: "Acme", slug: "acme" },
        workspace: { name: "Ops", slug: "ops" },
        invited_by: { display_name: "Lan" },
      },
    ];
    renderSidebar();

    const section = screen.getByRole("region", { name: "Lời mời đang chờ" });
    const row = within(section).getByRole("listitem");
    expect(row.textContent?.indexOf("Lan mời bạn vào")).toBe(0);
    expect(row).toHaveTextContent("Acme › Ops");
    expect(row).toHaveTextContent("Quản trị");
    expect(within(row).getByText("Sắp hết hạn")).toBeInTheDocument();
  });
});
