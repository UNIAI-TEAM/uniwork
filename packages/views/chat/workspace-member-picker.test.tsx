import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import {
  ExternalMemberLookupRow,
  WorkspaceMemberLookupResult,
  WorkspaceMemberPickerList,
  WorkspaceMemberSearchField,
  useMemberPickerFocus,
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
    fireEvent.submit(screen.getByLabelText("Tìm thành viên").closest("form")!);
    expect(onSubmit).toHaveBeenCalled();
  });

  it("clears the query from the clear button", () => {
    const onQueryChange = vi.fn();
    render(
      wrap(
        <WorkspaceMemberSearchField
          id="member-search"
          label="Tìm thành viên"
          query="long"
          onQueryChange={onQueryChange}
          onSubmit={vi.fn()}
          placeholder="Email"
        />,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Xóa tìm kiếm" }));
    expect(onQueryChange).toHaveBeenCalledWith("");
    // Clearing hands focus back to the field, not to the page.
    expect(screen.getByLabelText("Tìm thành viên")).toHaveFocus();
  });

  it("enters the list from the search field with ↓, and the list is one tab stop", () => {
    const people = [
      { workspace_id: "ws1", user_id: "u1", role: "member" as const, email: "a@example.com", display_name: "An" },
      { workspace_id: "ws1", user_id: "u2", role: "member" as const, email: "b@example.com", display_name: "Binh" },
    ];
    function Harness() {
      const focus = useMemberPickerFocus();
      return (
        <>
          <WorkspaceMemberSearchField
            id="member-search"
            label="Tìm thành viên"
            query=""
            onQueryChange={vi.fn()}
            onSubmit={vi.fn()}
            placeholder="Email"
            inputRef={focus.inputRef}
            onArrowDown={focus.focusFirstRow}
          />
          <WorkspaceMemberPickerList members={people} onPick={focus.focusInput} listRef={focus.listRef} />
        </>
      );
    }
    render(wrap(<Harness />));
    const input = screen.getByLabelText("Tìm thành viên");
    const an = screen.getByRole("button", { name: /An/ });
    const binh = screen.getByRole("button", { name: /Binh/ });
    expect(an).toHaveAttribute("tabindex", "0");
    expect(binh).toHaveAttribute("tabindex", "-1");

    input.focus();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(an).toHaveFocus();
    fireEvent.keyDown(an, { key: "ArrowDown" });
    expect(binh).toHaveFocus();
    expect(binh).toHaveAttribute("tabindex", "0");
    expect(an).toHaveAttribute("tabindex", "-1");

    // A pick sends focus back to the field (here onPick is focusInput).
    fireEvent.click(binh);
    expect(input).toHaveFocus();
  });

  it("shows loading and empty member lists", () => {
    const { rerender } = render(
      wrap(<WorkspaceMemberPickerList members={[]} loading emptyLabel="Không có ai" onPick={vi.fn()} />),
    );
    expect(screen.getByText("Đang tải thành viên…")).toBeInTheDocument();

    // The "no match" line now only shows when a query was typed.
    rerender(
      wrap(<WorkspaceMemberPickerList members={[]} query="lan" emptyLabel="Không có ai" onPick={vi.fn()} />),
    );
    expect(screen.getByText("Không có ai")).toBeInTheDocument();
  });

  it("does not blame an empty query when the workspace has nobody else", () => {
    render(
      wrap(
        <WorkspaceMemberPickerList
          members={[]}
          query=""
          hasOtherMembers={false}
          emptyLabel="Không có ai"
          onPick={vi.fn()}
        />,
      ),
    );
    expect(screen.queryByText("Không có ai")).not.toBeInTheDocument();
  });

  it("moves focus between rows with the arrow keys", () => {
    render(
      wrap(
        <WorkspaceMemberPickerList
          members={[
            { workspace_id: "ws1", user_id: "u1", role: "member", email: "a@example.com", display_name: "An" },
            { workspace_id: "ws1", user_id: "u2", role: "member", email: "b@example.com", display_name: "Binh" },
          ]}
          onPick={vi.fn()}
        />,
      ),
    );
    const first = screen.getByRole("button", { name: /An/ });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(screen.getByRole("button", { name: /Binh/ })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(first).toHaveFocus();
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

  it("says when an email lookup found nobody, and marks people already in the room", () => {
    const base = { isFetching: false, isFetched: true, data: null } as unknown as Parameters<
      typeof WorkspaceMemberLookupResult
    >[0]["lookup"];
    const { rerender } = render(
      wrap(<WorkspaceMemberLookupResult enabled lookup={base} onPick={vi.fn()} actionLabel="Thêm" />),
    );
    expect(screen.getByText("Không tìm thấy người dùng với email này.")).toBeInTheDocument();

    const found = {
      ...base,
      data: { user_id: "u9", email: "guest@example.com", display_name: "Guest" },
    } as typeof base;
    rerender(
      wrap(
        <WorkspaceMemberLookupResult
          enabled
          lookup={found}
          onPick={vi.fn()}
          actionLabel="Thêm"
          unavailableLabel={() => "Đã có trong nhóm"}
        />,
      ),
    );
    expect(screen.getByText("Đã có trong nhóm")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Thêm" })).not.toBeInTheDocument();
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
