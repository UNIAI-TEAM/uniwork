import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { Member } from "@uniwork/core/types/workspace";
import { wrap } from "../test/api-mock";
import { WorkspaceProvider } from "../layout/workspace-context";
import { ChannelSettingsSheet } from "./channel-settings-sheet";
import { GroupSettingsSheet } from "./group-settings-sheet";
import { WorkspaceSettingsSheet } from "./workspace-settings-sheet";

/*
 * Settings sheets against the audit (UNI-761): a failed member list is an
 * error, never "0 members"; removing from the workspace room says it removes
 * from the workspace; the channel form is the channel admin's only; unsaved
 * edits are not dropped silently.
 */

const state = vi.hoisted(() => ({
  members: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  wsRole: "owner" as string,
  updateChannel: vi.fn(),
}));

vi.mock("@uniwork/core/chat", () => ({
  useChatRoomMembers: () => state.members,
  useChatRooms: () => ({ data: [] }),
  useUpdateChatRoomMember: () => ({ mutateAsync: vi.fn() }),
  useRemoveChatRoomMember: () => ({ mutateAsync: vi.fn() }),
  useUpdateChatRoomSettings: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateChatChannel: () => ({ mutateAsync: state.updateChannel, isPending: false }),
  useArchiveChatChannel: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUnarchiveChatChannel: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useChatRoomMessages: () => ({ data: [], isPending: false, isError: false }),
  useSendChatRoomMessage: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSetChatNickname: () => ({ mutateAsync: vi.fn(), isPending: false }),
  chatKeys: { roomBulletinOlder: (...parts: string[]) => ["bulletin-older", ...parts] },
}));

vi.mock("@uniwork/core/tasks", () => ({
  useProjects: () => ({ data: { projects: [{ id: "p1", title: "Ra mắt" }] } }),
}));

vi.mock("@uniwork/core/permissions", async (orig) => ({
  ...(await orig<typeof import("@uniwork/core/permissions")>()),
  useCurrentMember: () => ({ role: state.wsRole, userId: "self", member: null, source: "membership", isLoading: false }),
  useWorkspacePermissions: () => ({
    decideRemove: () => ({ allowed: true, reason: "allowed", message: "" }),
  }),
}));

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  state.members = { data: [], isPending: false, isError: false, refetch: vi.fn() };
  state.wsRole = "owner";
  state.updateChannel.mockReset();
});

const member = (id: string, name: string, role = "member") => ({
  user_id: id,
  role,
  send_restricted: false,
  email: `${id}@example.com`,
  display_name: name,
});

const workspace = {
  id: "ws1",
  slug: "team",
  name: "Nhóm Sản phẩm",
  organization_id: "o1",
  organization_slug: "acme",
  organization_name: "Acme",
};

function renderWorkspaceSheet(workspaceMembers: Member[]) {
  return render(
    wrap(
      <WorkspaceProvider workspace={workspace as never} user={{} as never}>
        <WorkspaceSettingsSheet
          open
          onOpenChange={vi.fn()}
          workspaceId="ws1"
          roomId="room-ws"
          title="Chung"
          workspaceMembers={workspaceMembers}
          currentUserId="self"
          youLabel="Bạn"
        />
      </WorkspaceProvider>,
    ),
  );
}

const group = { id: "g1", name: "Design", room_id: "room-g1", member_user_ids: ["u2"] };

describe("member lists that failed to load", () => {
  it("group sheet shows an error with a retry and no member count", () => {
    state.members = { data: [], isPending: false, isError: true, refetch: vi.fn() };
    render(
      wrap(
        <GroupSettingsSheet
          open
          onOpenChange={vi.fn()}
          workspaceId="ws1"
          group={group}
          currentUserId="self"
          youLabel="Bạn"
          memberProfiles={{}}
          onAddMembers={vi.fn()}
          onLeave={vi.fn()}
        />,
      ),
    );
    const section = screen.getByRole("button", { name: /Thành viên nhóm/ });
    expect(section).not.toHaveTextContent(/thành viên$/);
    fireEvent.click(section);
    expect(screen.getByRole("alert")).toHaveTextContent("Không tải được danh sách thành viên.");
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(state.members.refetch).toHaveBeenCalled();
  });

  it("workspace sheet shows the error instead of 0 members", () => {
    state.members = { data: [], isPending: false, isError: true, refetch: vi.fn() };
    renderWorkspaceSheet([]);
    const section = screen.getByRole("button", { name: /Thành viên workspace/ });
    expect(section).not.toHaveTextContent("0 thành viên");
    fireEvent.click(section);
    expect(screen.getByRole("alert")).toHaveTextContent("Không tải được danh sách thành viên.");
  });
});

describe("GroupSettingsSheet", () => {
  it("reports the manage panel as expanded/collapsed, not pressed", () => {
    render(
      wrap(
        <GroupSettingsSheet
          open
          onOpenChange={vi.fn()}
          workspaceId="ws1"
          group={group}
          currentUserId="self"
          youLabel="Bạn"
          memberProfiles={{}}
          onAddMembers={vi.fn()}
          onLeave={vi.fn()}
        />,
      ),
    );
    const manage = screen.getByRole("button", { name: "Quản lý nhóm" });
    expect(manage).not.toHaveAttribute("aria-pressed");
    expect(manage).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(manage);
    expect(manage).toHaveAttribute("aria-expanded", "true");
    const panel = document.getElementById(manage.getAttribute("aria-controls") ?? "");
    expect(panel).not.toBeNull();
  });

  it("asks to remove a member in plain words", () => {
    state.members = { data: [member("self", "Tôi", "admin"), member("u2", "Binh")], isPending: false, isError: false, refetch: vi.fn() };
    render(
      wrap(
        <GroupSettingsSheet
          open
          onOpenChange={vi.fn()}
          workspaceId="ws1"
          group={group}
          currentUserId="self"
          youLabel="Bạn"
          memberProfiles={{}}
          onAddMembers={vi.fn()}
          onLeave={vi.fn()}
        />,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: /Thành viên nhóm/ }));
    fireEvent.click(screen.getByRole("button", { name: /Thao tác.*Binh/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Xóa Binh/ }));
    expect(screen.getByRole("alertdialog", { name: "Gỡ Binh khỏi nhóm chat?" })).toBeInTheDocument();
  });
});

describe("WorkspaceSettingsSheet", () => {
  const wsMembers = (ids: string[]) =>
    ids.map((id) => ({ user_id: id, role: "member" }) as unknown as Member);

  it("says removing from the workspace room removes from the workspace", () => {
    state.members = { data: [member("self", "Tôi", "admin"), member("u2", "Binh")], isPending: false, isError: false, refetch: vi.fn() };
    renderWorkspaceSheet(wsMembers(["self", "u2"]));
    fireEvent.click(screen.getByRole("button", { name: /Thành viên workspace/ }));
    fireEvent.click(screen.getByRole("button", { name: /Binh/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Xóa Binh khỏi workspace" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("mất quyền vào workspace Nhóm Sản phẩm");
    expect(within(dialog).getByRole("button", { name: "Xóa khỏi workspace" })).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent("không còn thấy hay nhắn tin trong phòng");
  });

  it("searches members accent-insensitively and shows them a page at a time", () => {
    const many = Array.from({ length: 60 }, (_, i) => member(`u${i}`, i === 42 ? "Nguyễn Thị Tuấn" : `Người ${i}`));
    state.members = { data: many, isPending: false, isError: false, refetch: vi.fn() };
    renderWorkspaceSheet(wsMembers(many.map((m) => m.user_id)));
    fireEvent.click(screen.getByRole("button", { name: /Thành viên workspace/ }));
    const list = () => screen.getAllByRole("listitem");
    expect(list()).toHaveLength(50);
    fireEvent.click(screen.getByRole("button", { name: /Hiện thêm 10 người/ }));
    expect(list()).toHaveLength(60);

    fireEvent.change(screen.getByRole("searchbox", { name: "Tìm thành viên" }), { target: { value: "tuan" } });
    expect(list()).toHaveLength(1);
    expect(list()[0]).toHaveTextContent("Nguyễn Thị Tuấn");
  });
});

describe("ChannelSettingsSheet", () => {
  const channel = {
    id: "c1",
    kind: "channel",
    name: "marketing",
    topic: "Chiến dịch Q4",
    visibility: "public",
    project_id: "p1",
    is_default: false,
    member_user_ids: [],
  };

  function renderChannel(onOpenChange = vi.fn()) {
    render(
      wrap(
        <ChannelSettingsSheet
          open
          onOpenChange={onOpenChange}
          workspaceId="ws1"
          channel={channel as never}
          currentUserId="self"
          youLabel="Bạn"
        />,
      ),
    );
    return onOpenChange;
  }

  it("shows a plain member the settings read-only, with who can change them", () => {
    state.wsRole = "member";
    state.members = { data: [member("self", "Tôi")], isPending: false, isError: false, refetch: vi.fn() };
    renderChannel();
    expect(screen.queryByRole("textbox", { name: "Tên kênh" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Lưu trữ kênh/ })).toBeNull();
    expect(screen.getByText("Chiến dịch Q4")).toBeInTheDocument();
    expect(screen.getByText("Ra mắt")).toBeInTheDocument();
    expect(screen.getByText(/Chỉ admin kênh mới đổi được/)).toBeInTheDocument();
  });

  it("lets a channel admin edit, and asks before dropping unsaved edits", () => {
    state.wsRole = "member";
    state.members = { data: [member("self", "Tôi", "admin")], isPending: false, isError: false, refetch: vi.fn() };
    const onOpenChange = renderChannel();
    fireEvent.change(screen.getByRole("textbox", { name: "Tên kênh" }), { target: { value: "marketing-2" } });
    fireEvent.click(screen.getByRole("button", { name: "Đóng" }));
    expect(onOpenChange).not.toHaveBeenCalled();
    const confirm = screen.getByRole("alertdialog", { name: "Bỏ thay đổi chưa lưu?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Bỏ thay đổi" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
