import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import { GroupSettingsSheet } from "./group-settings-sheet";

beforeAll(() => {
  initI18n();
});

describe("GroupSettingsSheet", () => {
  it("lists members and opens add-members flow", () => {
    const onAddMembers = vi.fn();
    render(
      wrap(
        <GroupSettingsSheet
          open
          onOpenChange={vi.fn()}
          group={{
            id: "g1",
            name: "Design",
            room_id: "room-g1",
            member_user_ids: ["u2"],
          }}
          currentUserId="self"
          youLabel="Bạn"
          memberProfiles={{
            u2: { user_id: "u2", display_name: "Binh", email: "binh@example.com" },
          }}
          onAddMembers={onAddMembers}
          onLeave={vi.fn()}
        />,
      ),
    );

    expect(screen.getByRole("heading", { name: "Design" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Thêm thành viên" }));
    expect(onAddMembers).toHaveBeenCalled();
  });

  it("confirms leaving the group", () => {
    const onLeave = vi.fn();
    render(
      wrap(
        <GroupSettingsSheet
          open
          onOpenChange={vi.fn()}
          group={{
            id: "g1",
            name: "Design",
            room_id: "room-g1",
            member_user_ids: ["u2"],
          }}
          currentUserId="self"
          youLabel="Bạn"
          memberProfiles={{}}
          onAddMembers={vi.fn()}
          onLeave={onLeave}
        />,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Rời cuộc trò chuyện" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Rời cuộc trò chuyện" }));
    expect(onLeave).toHaveBeenCalled();
  });
});
