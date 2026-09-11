import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
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
    fireEvent.click(screen.getByRole("button", { name: /Người tham gia/i }));
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
});
