import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import { StartDmDialog } from "./start-dm-dialog";

const members = [
  {
    workspace_id: "ws1",
    user_id: "u1",
    role: "member" as const,
    email: "long@example.com",
    display_name: "Tran Hoang Long",
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
      <label htmlFor="start-dm-search">{label}</label>
      <input id="start-dm-search" onChange={(event) => onQueryChange(event.target.value)} />
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

describe("StartDmDialog", () => {
  it("starts a dm from workspace member list", () => {
    const onStartDm = vi.fn();
    const onOpenChange = vi.fn();

    render(
      wrap(
        <StartDmDialog
          open
          onOpenChange={onOpenChange}
          workspaceId="ws1"
          currentUserId="self"
          contacts={[]}
          onStartDm={onStartDm}
        />,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Tran Hoang Long" }));
    expect(onStartDm).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "u1", display_name: "Tran Hoang Long" }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
