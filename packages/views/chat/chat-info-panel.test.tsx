import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import type { User } from "@uniwork/core/types";
import { requestMock, wrap } from "../test/api-mock";
import { ChatInfoPanel, type ChatInfoPanelProps } from "./chat-info-panel";
import { previewMembers } from "./chat-info-panel-members";
import { linkedTaskLine } from "./chat-info-panel-utils";

initI18n();

const user: User = {
  id: "u1",
  email: "quang@unicom.vn",
  display_name: "Quang",
  onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z",
  onboarding_questionnaire: {},
} as User;

const group = { id: "g1", name: "Ra mắt UniWork Q4", room_id: "room-g1", member_user_ids: ["u2", "u3"] };

const member = (user_id: string, display_name: string, role = "member") => ({
  user_id,
  display_name,
  email: `${user_id}@unicom.vn`,
  role,
  send_restricted: false,
  is_creator: false,
});

function serve(path: string): unknown {
  if (path.endsWith("/chat/rooms")) {
    return {
      rooms: [
        {
          id: "room-g1",
          kind: "group",
          name: "Ra mắt UniWork Q4",
          workspace_id: "ws1",
          member_user_ids: ["u2", "u3"],
          member_count: 3,
          topic: "Phối hợp ra mắt UniWork bản Q4.",
        },
      ],
    };
  }
  if (path.endsWith("/members")) {
    return { members: [member("u1", "Quang", "admin"), member("u2", "Nguyễn Thu Hà", "admin"), member("u3", "Võ Minh")] };
  }
  if (path.includes("/linked-tasks")) {
    return {
      tasks: [
        { id: "t1", workspace_id: "ws1", number: 1, title: "Chỉnh màu nút CTA", status: "in_progress", priority: "high", assignee_name: "Hoàng Lan", linked_at: "2026-10-17T10:00:00Z" },
        { id: "t2", workspace_id: "ws1", number: 2, title: "Kịch bản livestream", status: "todo", priority: "high", due_date: "2020-01-01", linked_at: "2026-10-17T09:00:00Z" },
        { id: "t3", workspace_id: "ws1", number: 3, title: "Danh sách khách mời", status: "done", priority: "low", linked_at: "2026-10-17T08:00:00Z" },
        { id: "t4", workspace_id: "ws1", number: 4, title: "Ảnh sân khấu", status: "todo", priority: "low", linked_at: "2026-10-17T07:00:00Z" },
      ],
      total: 4,
    };
  }
  if (path.includes("/messages")) return { messages: [] };
  return {};
}

function renderPanel(overrides: Partial<ChatInfoPanelProps> = {}) {
  const props: ChatInfoPanelProps = {
    target: { kind: "group", group },
    workspaceId: "ws1",
    roomId: "room-g1",
    title: "Ra mắt UniWork Q4",
    currentUserId: "u1",
    activeContact: null,
    activeGroup: group,
    activeChannel: null,
    workspaceMemberIds: [],
    channelMemberIds: [],
    memberAvatarByUserId: {},
    nicknamesByUserId: {},
    docked: true,
    onClose: vi.fn(),
    onSearch: vi.fn(),
    onVoiceCall: vi.fn(),
    voiceCallDisabled: false,
    onVideoCall: vi.fn(),
    videoCallDisabled: false,
    onAddMembers: vi.fn(),
    onOpenSettings: vi.fn(),
    onJumpToMessage: vi.fn(),
    ...overrides,
  };
  render(wrap(<ChatInfoPanel {...props} />));
  return props;
}

beforeEach(() => {
  resetAuthStoreForTests();
  setSessionUser(user);
  requestMock.mockReset();
  requestMock.mockImplementation((path: string) => Promise.resolve(serve(path)));
});

describe("ChatInfoPanel", () => {
  it("shows the group's hero, quick actions, description, tasks, media tabs and members", async () => {
    const props = renderPanel();
    const panel = screen.getByRole("complementary", { name: "Thông tin nhóm" });
    expect(within(panel).getByText("Nhóm · 3 thành viên")).toBeInTheDocument();
    expect(await screen.findByText("Phối hợp ra mắt UniWork bản Q4.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Tìm" }));
    fireEvent.click(screen.getByRole("button", { name: "Gọi" }));
    fireEvent.click(screen.getByRole("button", { name: "Thêm" }));
    expect(props.onSearch).toHaveBeenCalledTimes(1);
    expect(props.onVoiceCall).toHaveBeenCalledTimes(1);
    expect(props.onAddMembers).toHaveBeenCalledTimes(1);

    // Tasks from the room: three until "Xem 4", overdue said in red.
    expect(await screen.findByText("Chỉnh màu nút CTA")).toBeInTheDocument();
    expect(screen.getByText(/Quá hạn \d+ ngày/)).toHaveClass("text-destructive");
    expect(screen.getByText("Đã xong")).toBeInTheDocument();
    expect(screen.queryByText("Ảnh sân khấu")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Xem 4" }));
    expect(screen.getByText("Ảnh sân khấu")).toBeInTheDocument();

    expect(await screen.findByRole("button", { name: "Ảnh 0" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Tệp 0" }));
    expect(screen.getByRole("button", { name: "Tệp 0" })).toHaveAttribute("aria-pressed", "true");

    expect(await screen.findByText("Nguyễn Thu Hà")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Xem tất cả" }));
    expect(props.onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("edits the description in place for whoever may change the room", async () => {
    renderPanel();
    await screen.findByText("Phối hợp ra mắt UniWork bản Q4.");
    // The caller is a room admin: the text itself opens the editor.
    fireEvent.click(await screen.findByRole("button", { name: /^Sửa mô tả/ }));
    const box = screen.getByRole("textbox", { name: "Mô tả" });
    fireEvent.change(box, { target: { value: "Mô tả mới" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await vi.waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith(
        "/api/v1/workspaces/ws1/chat/rooms/room-g1",
        expect.objectContaining({ method: "PATCH", body: expect.objectContaining({ topic: "Mô tả mới" }) }),
      ),
    );
  });

  it("closes from its X, and over the conversation from Escape too", () => {
    const docked = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Đóng" }));
    expect(docked.onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(docked.onClose).toHaveBeenCalledTimes(1);
  });

  it("over the conversation, takes focus and gives it back on Escape", () => {
    const props = renderPanel({ docked: false });
    expect(screen.getByRole("button", { name: "Đóng" })).toHaveFocus();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});

describe("linkedTaskLine", () => {
  const now = new Date(2026, 9, 18, 9, 0);
  it("says done, overdue by whole days, or open with its due date", () => {
    expect(linkedTaskLine({ status: "done", due_date: "2026-10-01" }, now)).toEqual({ tone: "done" });
    expect(linkedTaskLine({ status: "todo", due_date: "2026-10-17" }, now)).toEqual({ tone: "overdue", days: 1 });
    expect(linkedTaskLine({ status: "todo", due_date: "2026-10-18" }, now)).toEqual({ tone: "open", due: "2026-10-18" });
    expect(linkedTaskLine({ status: "cancelled", due_date: "2026-10-01" }, now)).toEqual({ tone: "open", due: "2026-10-01" });
    expect(linkedTaskLine({ status: "in_progress" }, now)).toEqual({ tone: "open", due: undefined });
  });
});

describe("previewMembers", () => {
  it("puts whoever is online first, the caller included", () => {
    const rows = [member("u2", "Hà"), member("u3", "Minh"), member("u1", "Quang"), member("u4", "Lan")];
    const ids = previewMembers(rows, { U4: true }, "u1", 3).map((row) => row.user_id);
    expect(ids).toEqual(["u1", "u4", "u2"]);
  });
});
