import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
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

  it("shows empty states when there are no groups or contacts", () => {
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

    expect(screen.getByText(/Chưa có nhóm nào/)).toBeInTheDocument();
    expect(screen.getByText(/Chưa có cuộc trò chuyện/)).toBeInTheDocument();
  });
});
