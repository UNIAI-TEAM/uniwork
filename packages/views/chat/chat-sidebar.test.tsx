import { act, fireEvent, render, screen } from "@testing-library/react";
import { toast } from "sonner";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { initI18n } from "@uniwork/core/i18n";
import {
  resetChatRoomPreferencesForTests,
  useChatRoomPreferencesStore,
} from "@uniwork/core/chat/room-preferences-store";
import { wrap } from "../test/api-mock";
import { ChatSidebar } from "./chat-sidebar";

const invitesMock = vi.hoisted(() => ({
  invites: [] as unknown[],
  mutate: vi.fn(),
}));

vi.mock("@uniwork/core/workspaces", () => ({
  useMyInvitations: () => ({ data: invitesMock.invites }),
  useAcceptInvite: () => ({ mutate: invitesMock.mutate, isPending: false }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

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
  invitesMock.mutate.mockReset();
  vi.mocked(toast.error).mockClear();
});

function renderSidebar(props: Partial<Parameters<typeof ChatSidebar>[0]> = {}) {
  return render(
    wrap(
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
    expect(screen.getByRole("group", { name: /Lọc cuộc trò chuyện/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tất cả", pressed: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Riêng", pressed: false })).toBeInTheDocument();
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

    fireEvent.click(screen.getByRole("button", { name: "Riêng" }));
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

  it("marks the collapse control as expanded", () => {
    renderSidebar({ onCollapse: vi.fn() });
    expect(screen.getByRole("button", { name: "Ẩn danh sách trò chuyện" })).toHaveAttribute("aria-expanded", "true");
  });

  it("joins an invited workspace, shows which invite is pending, and says why a join failed", () => {
    invitesMock.invites = [
      {
        id: "inv1",
        token: "tok1",
        role: "member",
        organization: { name: "Acme", slug: "acme" },
        workspace: { name: "Ops", slug: "ops" },
        invited_by: { display_name: "Lan" },
      },
    ];
    const onJoinedWorkspace = vi.fn();
    renderSidebar({ onJoinedWorkspace });

    fireEvent.click(screen.getByRole("button", { name: "Tham gia" }));
    expect(screen.getByRole("button", { name: "Đang tham gia…" })).toBeDisabled();
    const [token, handlers] = invitesMock.mutate.mock.calls[0] as [
      string,
      { onSuccess: (r: unknown) => void; onError: (e: unknown) => void; onSettled: () => void },
    ];
    expect(token).toBe("tok1");

    act(() => {
      handlers.onError(new ApiError("server text", "gone", 410));
      handlers.onSettled();
    });
    expect(toast.error).toHaveBeenCalledWith("Không tham gia được workspace. Thử lại.");
    expect(screen.getByRole("button", { name: "Tham gia" })).not.toBeDisabled();

    const workspace = { id: "ws2", slug: "ops", organization_slug: "acme" };
    act(() => handlers.onSuccess({ workspace }));
    expect(onJoinedWorkspace).toHaveBeenCalledWith(workspace);
  });
});
