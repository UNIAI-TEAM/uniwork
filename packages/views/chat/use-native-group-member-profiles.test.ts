import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { fetchChatUserById } from "@uniwork/core/chat";
import { useNativeGroupMemberProfiles } from "./use-native-group-member-profiles";

vi.mock("@uniwork/core/chat", async (orig) => ({
  ...(await orig<typeof import("@uniwork/core/chat")>()),
  fetchChatUserById: vi.fn(),
}));

beforeAll(() => {
  vi.mocked(fetchChatUserById).mockImplementation(async (_ws, userId) => ({
    user_id: userId,
    display_name: `User ${userId}`,
    email: `${userId}@example.com`,
  }));
});

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
    );

    await waitFor(() => {
      expect(result.current.groupMemberProfiles.u2).toEqual({
        user_id: "u2",
        display_name: "User u2",
        email: "u2@example.com",
      });
    });
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
