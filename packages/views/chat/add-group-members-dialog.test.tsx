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

// The dialog now lists workspace members (shared picker) instead of a separate
// "quick pick from contacts" list, so the member comes from useMembers.
vi.mock("@uniwork/core/workspaces", () => ({
  useMembers: () => ({
    data: [
      { workspace_id: "ws1", user_id: "u2", role: "member", email: "binh@example.com", display_name: "Binh" },
      { workspace_id: "ws1", user_id: "u3", role: "member", email: "an@example.com", display_name: "An" },
    ],
    isLoading: false,
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

    fireEvent.click(screen.getByRole("checkbox", { name: /Binh/ }));
    expect(screen.getByRole("checkbox", { name: /Binh/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Đã chọn 1 người")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mời vào nhóm" }));
    expect(onInvite).toHaveBeenCalledWith([contact]);
  });

  it("keeps people already in the group ticked and locked, and says why the invite is disabled", () => {
    render(
      wrap(
        <AddGroupMembersDialog
          open
          onOpenChange={vi.fn()}
          workspaceId="ws1"
          group={group}
          currentUserId="self"
          contacts={[]}
          onInvite={vi.fn()}
        />,
      ),
    );

    const already = screen.getByRole("checkbox", { name: /An/ });
    expect(already).toHaveAttribute("aria-checked", "true");
    expect(already).toHaveAttribute("aria-disabled", "true");
    expect(already).toHaveTextContent("Đã có trong nhóm");
    fireEvent.click(already);
    expect(already).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: "Mời vào nhóm" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Chọn ít nhất một người để mời.")).toBeInTheDocument();
  });
});
