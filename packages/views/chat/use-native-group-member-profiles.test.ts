import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { fetchChatUserById } from "@uniwork/core/chat/user-lookup";
import { requestMock, wrap } from "../test/api-mock";
import { useNativeGroupMemberProfiles } from "./use-native-group-member-profiles";

vi.mock("@uniwork/core/chat/user-lookup", async (orig) => ({
  ...(await orig<typeof import("@uniwork/core/chat/user-lookup")>()),
  fetchChatUserById: vi.fn(),
}));

beforeAll(() => {
  vi.mocked(fetchChatUserById).mockImplementation(async (_ws, userId) => ({
    user_id: userId,
    display_name: `User ${userId}`,
    email: `${userId}@example.com`,
  }));
});

const wrapper = ({ children }: { children: ReactNode }) => wrap(children as ReactElement);

describe("useNativeGroupMemberProfiles", () => {
  it("loads profiles for active group members", async () => {
    const { result } = renderHook(() =>
      useNativeGroupMemberProfiles({
        workspaceId: "ws1",
        targetKind: "group",
        activeGroup: {
          id: "g1",
          name: "Design",
          room_id: "room-g1",
          member_user_ids: ["u2", "u3"],
        },
      }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.groupMemberProfiles.u2).toEqual({
        user_id: "u2",
        display_name: "User u2",
        email: "u2@example.com",
      });
    });
  });

  it("reads a channel's profiles from one room-members call, not one lookup per member", async () => {
    vi.mocked(fetchChatUserById).mockClear();
    requestMock.mockReset();
    requestMock.mockResolvedValue({
      members: ["u2", "u3", "u4"].map((id) => ({
        user_id: id,
        role: "member",
        email: `${id}@example.com`,
        display_name: `User ${id}`,
      })),
    });
    const { result } = renderHook(
      () =>
        useNativeGroupMemberProfiles({
          workspaceId: "ws1",
          targetKind: "channel",
          activeGroup: null,
          activeChannel: { id: "ch1" },
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(Object.keys(result.current.groupMemberProfiles)).toEqual(["u2", "u3", "u4"]);
    });
    expect(result.current.groupMemberProfiles.u3).toEqual({
      user_id: "u3",
      display_name: "User u3",
      email: "u3@example.com",
    });
    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(String(requestMock.mock.calls[0]?.[0])).toBe("/api/v1/workspaces/ws1/chat/rooms/ch1/members");
    expect(fetchChatUserById).not.toHaveBeenCalled();
  });

  it("clears cached profiles", async () => {
    const { result } = renderHook(() =>
      useNativeGroupMemberProfiles({
        workspaceId: "ws1",
        targetKind: "group",
        activeGroup: {
          id: "g1",
          name: "Design",
          room_id: "room-g1",
          member_user_ids: ["u2"],
        },
      }),
      { wrapper },
    );

    await waitFor(() => {
      expect(Object.keys(result.current.groupMemberProfiles)).toHaveLength(1);
    });

    act(() => {
      result.current.clearGroupMemberProfiles();
    });

    expect(result.current.groupMemberProfiles).toEqual({});
  });
});
