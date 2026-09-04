import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import {
  ExternalMemberLookupRow,
  WorkspaceMemberPickerList,
  WorkspaceMemberSearchField,
  useWorkspaceMemberPicker,
} from "./workspace-member-picker";
import { renderHook } from "@testing-library/react";

vi.mock("@uniwork/core/workspaces", () => ({
  useMembers: () => ({
    data: [
      {
        workspace_id: "ws1",
        user_id: "u1",
        role: "member",
        email: "long@example.com",
        display_name: "Tran Hoang Long",
      },
    ],
    isLoading: false,
  }),
}));

vi.mock("@uniwork/core/chat", async (orig) => ({
  ...(await orig<typeof import("@uniwork/core/chat")>()),
  useLookupChatUser: () => ({
    data: null,
    isFetching: false,
    isFetched: false,
  }),
}));

beforeAll(() => {
  initI18n();
});

describe("workspace-member-picker", () => {
  it("submits search queries from the search field", () => {
    const onSubmit = vi.fn();
    const onQueryChange = vi.fn();

    render(
      wrap(
        <WorkspaceMemberSearchField
          id="member-search"
          label="Tìm thành viên"
          query=""
          onQueryChange={onQueryChange}
          onSubmit={onSubmit}
          placeholder="Email"
        />,
      ),
    );

    fireEvent.change(screen.getByLabelText("Tìm thành viên"), { target: { value: "long" } });
    expect(onQueryChange).toHaveBeenCalledWith("long");
    fireEvent.click(screen.getByRole("button", { name: "Tìm" }));
    expect(onSubmit).toHaveBeenCalled();
  });

  it("shows loading and empty member lists", () => {
    const { rerender } = render(
      wrap(<WorkspaceMemberPickerList members={[]} loading emptyLabel="Không có ai" onPick={vi.fn()} />),
    );
    expect(screen.getByText("Đang tải thành viên…")).toBeInTheDocument();

    rerender(wrap(<WorkspaceMemberPickerList members={[]} emptyLabel="Không có ai" onPick={vi.fn()} />));
    expect(screen.getByText("Không có ai")).toBeInTheDocument();
  });

  it("renders members and handles pick", () => {
    const onPick = vi.fn();
    render(
      wrap(
        <WorkspaceMemberPickerList
          members={[
            {
              workspace_id: "ws1",
              user_id: "u1",
              role: "member",
              email: "long@example.com",
              display_name: "Tran Hoang Long",
            },
          ]}
          emptyLabel="Empty"
          onPick={onPick}
        />,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: /Tran Hoang Long/ }));
    expect(onPick).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "u1", email: "long@example.com" }),
    );
  });

  it("shows external lookup results", () => {
    const onPick = vi.fn();
    render(
      wrap(
        <ExternalMemberLookupRow
          lookup={{
            user_id: "u9",
            email: "guest@example.com",
            display_name: "Guest",
          }}
          onPick={onPick}
          actionLabel="Thêm"
          hint="Found outside workspace"
        />,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Thêm" }));
    expect(onPick).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "u9", email: "guest@example.com" }),
    );
  });

  it("filters workspace members through the picker hook", () => {
    const { result } = renderHook(() =>
      useWorkspaceMemberPicker({
        workspaceId: "ws1",
        currentUserId: "self",
        open: true,
        query: "long",
        searchSubmitted: false,
      }),
    );

    expect(result.current.filteredMembers.map((member) => member.user_id)).toEqual(["u1"]);
  });

  it("matches workspace members by submitted email", () => {
    const { result } = renderHook(() =>
      useWorkspaceMemberPicker({
        workspaceId: "ws1",
        currentUserId: "self",
        open: true,
        query: "long@example.com",
        searchSubmitted: true,
      }),
    );

    expect(result.current.workspaceEmailMatch?.user_id).toBe("u1");
    expect(result.current.lookupEnabled).toBe(false);
  });
});
