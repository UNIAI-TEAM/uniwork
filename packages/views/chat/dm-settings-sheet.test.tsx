import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrap } from "../test/api-mock";
import { DmSettingsSheet } from "./dm-settings-sheet";

beforeAll(() => {
  initI18n();
});

const contact = {
  user_id: "u2",
  email: "binh@example.com",
  display_name: "Binh",
};

describe("DmSettingsSheet", () => {
  it("lists dm participants", () => {
    render(
      wrap(
        <DmSettingsSheet
          open
          onOpenChange={vi.fn()}
          workspaceId="ws1"
          currentUserId="u1"
          contact={contact}
          youLabel="Bạn"
          onLeave={vi.fn()}
          blockedByMe={false}
          blockedMe={false}
          onBlock={vi.fn()}
          onUnblock={vi.fn()}
        />,
      ),
    );

    expect(screen.getByRole("heading", { name: "Binh" })).toBeInTheDocument();
    expect(screen.getByText("Ghi chú, ghim, bình chọn")).toBeInTheDocument();
    expect(screen.getByText("Người tham gia")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Đặt biệt danh" })).toBeInTheDocument();
  });

  it("opens message search from settings and closes the sheet", () => {
    const onOpenChange = vi.fn();
    const onOpenSearch = vi.fn();
    render(
      wrap(
        <DmSettingsSheet
          open
          onOpenChange={onOpenChange}
          workspaceId="ws1"
          currentUserId="u1"
          contact={contact}
          youLabel="Bạn"
          onLeave={vi.fn()}
          blockedByMe={false}
          blockedMe={false}
          onBlock={vi.fn()}
          onUnblock={vi.fn()}
          onOpenSearch={onOpenSearch}
        />,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Tìm tin nhắn trong cuộc trò chuyện" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onOpenSearch).toHaveBeenCalled();
  });

  it("shows nickname in heading when set", () => {
    render(
      wrap(
        <DmSettingsSheet
          open
          onOpenChange={vi.fn()}
          workspaceId="ws1"
          currentUserId="u1"
          contact={contact}
          nicknamesByUserId={{ u2: "Bạn Binh" }}
          youLabel="Bạn"
          onLeave={vi.fn()}
          blockedByMe={false}
          blockedMe={false}
          onBlock={vi.fn()}
          onUnblock={vi.fn()}
        />,
      ),
    );

    expect(screen.getByRole("heading", { name: "Bạn Binh" })).toBeInTheDocument();
    // The participants open with the sheet (canvas).
    expect(screen.getByRole("button", { name: /Người tham gia/i })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Tên gốc: Binh")).toBeInTheDocument();
  });

  it("confirms leaving the conversation", () => {
    const onLeave = vi.fn();
    render(
      wrap(
        <DmSettingsSheet
          open
          onOpenChange={vi.fn()}
          workspaceId="ws1"
          currentUserId="u1"
          contact={contact}
          youLabel="Bạn"
          onLeave={onLeave}
          blockedByMe={false}
          blockedMe={false}
          onBlock={vi.fn()}
          onUnblock={vi.fn()}
        />,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Rời cuộc trò chuyện" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Rời cuộc trò chuyện" }));
    expect(onLeave).toHaveBeenCalled();
  });

  it("disables notes, pins and polls until the conversation exists, and says why", () => {
    render(
      wrap(
        <DmSettingsSheet
          open
          onOpenChange={vi.fn()}
          workspaceId="ws1"
          roomId={null}
          currentUserId="u1"
          contact={contact}
          youLabel="Bạn"
          onLeave={vi.fn()}
          blockedByMe={false}
          blockedMe={false}
          onBlock={vi.fn()}
          onUnblock={vi.fn()}
        />,
      ),
    );
    const row = screen.getByRole("button", { name: /Ghi chú, ghim, bình chọn/ });
    expect(row).toBeDisabled();
    expect(row).toHaveAccessibleDescription("Có sau tin nhắn đầu tiên trong cuộc trò chuyện");
  });

  it("lists the room's shared media after the bulletin rows, and photos open as a gallery", async () => {
    requestMock.mockResolvedValue({
      messages: [
        {
          id: "m1",
          room_id: "room-dm",
          workspace_id: "ws1",
          sender_id: "u2",
          sender_display_name: "Binh",
          body: "![ảnh](https://media.tenor.com/a.png)",
          created_at: "2026-10-01T03:00:00Z",
        },
      ],
    });
    render(
      wrap(
        <DmSettingsSheet
          open
          onOpenChange={vi.fn()}
          workspaceId="ws1"
          currentUserId="u1"
          contact={contact}
          roomId="room-dm"
          youLabel="Bạn"
          onLeave={vi.fn()}
          blockedByMe={false}
          blockedMe={false}
          onBlock={vi.fn()}
          onUnblock={vi.fn()}
        />,
      ),
    );
    const photos = await screen.findByRole("button", { name: "1 ảnh" });
    const bulletin = screen.getByRole("button", { name: /Ghi chú, ghim, bình chọn/ });
    expect(bulletin.compareDocumentPosition(photos) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(requestMock).toHaveBeenCalledWith(expect.stringContaining("/chat/rooms/room-dm/messages"));

    fireEvent.click(photos);
    expect(screen.getByRole("button", { name: "Quay lại" })).toBeInTheDocument();
    expect(document.querySelector('img[src="https://media.tenor.com/a.png"]')).toBeInTheDocument();
  });
});
