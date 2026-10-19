import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { ChatRoomRecord } from "@uniwork/core/api/endpoints/chat";
import { pickQuickCatchUp, SidebarCatchUpCard } from "./chat-sidebar-catch-up";

beforeAll(() => {
  initI18n();
});

const group = { id: "g1", name: "Design", room_id: "room-g1", member_user_ids: ["u3"] };
const channel = { id: "room-c1", name: "launch" } as ChatRoomRecord;
const contact = { user_id: "u2", display_name: "Binh", email: "b@x.vn", dm_room_id: "room-dm" };

function pick(unreadByRoomId: Record<string, number>) {
  return pickQuickCatchUp({
    unreadByRoomId,
    workspaceRoomId: "room-ws",
    workspaceTitle: "Chung",
    channels: [channel],
    groups: [group],
    contacts: [contact],
    nicknamesByUserId: {},
  });
}

describe("pickQuickCatchUp", () => {
  it("adds up the unread rooms the list knows and picks the busiest", () => {
    const result = pick({ "room-ws": 2, "room-g1": 9, "room-dm": 3, "room-c1": 0, "room-gone": 50 });
    expect(result.total).toBe(14);
    expect(result.rooms).toBe(3);
    expect(result.top).toEqual({ roomId: "room-g1", target: { kind: "group", group }, title: "Design" });
  });

  it("names a DM by its person and has nothing to open when all is read", () => {
    expect(pick({ "room-dm": 1 }).top?.title).toBe("Binh");
    expect(pick({ "room-ws": 0 })).toEqual({ total: 0, rooms: 0, top: null });
  });
});

describe("SidebarCatchUpCard", () => {
  it("opens the busiest room's brief", () => {
    const onOpen = vi.fn();
    render(<SidebarCatchUpCard catchUp={pick({ "room-ws": 2, "room-c1": 5 })} onOpen={onOpen} />);
    const card = screen.getByRole("button", { name: /Bắt kịp nhanh/ });
    expect(card).toHaveTextContent("7 tin chưa đọc ở 2 cuộc trò chuyện. UNI tóm tắt giúp bạn.");
    expect(card).toHaveTextContent("launch");
    fireEvent.click(card);
    expect(onOpen).toHaveBeenCalledWith({ kind: "channel", channel }, "room-c1");
  });

  it("says all is read, with nothing to press", () => {
    render(<SidebarCatchUpCard catchUp={pick({})} onOpen={vi.fn()} />);
    expect(screen.getByText("Bạn đã đọc hết. UNI sẽ tóm tắt khi có tin mới.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
