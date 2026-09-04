import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import { AddGroupMembersDialog } from "./add-group-members-dialog";

vi.mock("@uniwork/core/chat", async (orig) => ({
  ...(await orig<typeof import("@uniwork/core/chat")>()),
  useLookupChatUser: () => ({
    data: null,
    isFetching: false,
    isFetched: false,
  }),
}));

const group = {
  id: "g1",
  name: "Design",
  room_id: "room-g1",
  member_user_ids: ["u3"],
};

const contact = {
  user_id: "u2",
  email: "binh@example.com",
  display_name: "Binh",
};

beforeAll(() => {
  initI18n();
});

describe("AddGroupMembersDialog", () => {
  it("invites picked contacts from the workspace list", () => {
    const onInvite = vi.fn();
    const onOpenChange = vi.fn();

    render(
      wrap(
        <AddGroupMembersDialog
          open
          onOpenChange={onOpenChange}
          workspaceId="ws1"
          group={group}
          currentUserId="self"
          contacts={[contact]}
          onInvite={onInvite}
        />,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: /Binh/ }));
    fireEvent.click(screen.getByRole("button", { name: "Mời vào nhóm" }));
    expect(onInvite).toHaveBeenCalledWith([contact]);
  });
});
