import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import { CreateGroupDialog } from "./create-group-dialog";

const members = [
  {
    workspace_id: "ws1",
    user_id: "u1",
    role: "member" as const,
    email: "long@example.com",
    display_name: "Tran Hoang Long",
  },
  {
    workspace_id: "ws1",
    user_id: "u2",
    role: "member" as const,
    email: "binh@example.com",
    display_name: "Binh",
  },
];

vi.mock("./workspace-member-picker", () => ({
  useWorkspaceMemberPicker: () => ({
    filteredMembers: members,
    isLoading: false,
    lookup: { isFetching: false, isFetched: false, data: null },
    lookupEnabled: false,
    workspaceEmailMatch: null,
  }),
  WorkspaceMemberSearchField: ({
    label,
    onSubmit,
    onQueryChange,
  }: {
    label: string;
    onSubmit: () => void;
    onQueryChange: (value: string) => void;
  }) => (
    <div>
      <label htmlFor="group-member-search">{label}</label>
      <input id="group-member-search" onChange={(event) => onQueryChange(event.target.value)} />
      <button type="button" onClick={onSubmit}>
        Search
      </button>
    </div>
  ),
  WorkspaceMemberPickerList: ({
    members: rows,
    onPick,
  }: {
    members: typeof members;
    onPick: (contact: { user_id: string; email: string; display_name: string }) => void;
  }) => (
    <ul>
      {rows.map((member) => (
        <li key={member.user_id}>
          <button
            type="button"
            onClick={() =>
              onPick({
                user_id: member.user_id,
                email: member.email,
                display_name: member.display_name,
              })
            }
          >
            {member.display_name}
          </button>
        </li>
      ))}
    </ul>
  ),
  ExternalMemberLookupRow: () => null,
}));

beforeAll(() => {
  initI18n();
});

describe("CreateGroupDialog", () => {
  it("creates a group after picking at least two members", () => {
    const onCreate = vi.fn();
    const onOpenChange = vi.fn();

    render(
      wrap(
        <CreateGroupDialog
          open
          onOpenChange={onOpenChange}
          workspaceId="ws1"
          currentUserId="self"
          onCreate={onCreate}
        />,
      ),
    );

    fireEvent.change(screen.getByLabelText("Tên nhóm"), { target: { value: "Squad" } });
    fireEvent.click(screen.getByRole("button", { name: "Tran Hoang Long" }));
    fireEvent.click(screen.getByRole("button", { name: "Binh" }));

    const startButton = screen.getByRole("button", { name: "Tạo nhóm chat" });
    expect(startButton).not.toBeDisabled();
    fireEvent.click(startButton);

    expect(onCreate).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ user_id: "u1" }),
        expect.objectContaining({ user_id: "u2" }),
      ]),
      "Squad",
    );
  });
});
