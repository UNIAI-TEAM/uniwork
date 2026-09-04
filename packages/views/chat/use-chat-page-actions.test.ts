import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { ApiError } from "@uniwork/core/api/http";
import { useChatPageActions } from "./use-chat-page-actions";
import type { ChatMessage } from "./chat-messages";

beforeAll(() => {
  initI18n();
});

function buildDeps(overrides: Partial<Parameters<typeof useChatPageActions>[0]> = {}) {
  const setTarget = vi.fn();
  const setDraft = vi.fn();
  const setReplyTo = vi.fn();
  const setConnectError = vi.fn();

  return {
    target: { kind: "workspace" as const },
    setTarget,
    activeRoomId: "room1",
    activeGroup: null,
    draft: "hello",
    setDraft,
    replyTo: null as ChatMessage | null,
    setReplyTo,
    ensureRoom: { mutateAsync: vi.fn().mockResolvedValue({ room_id: "room1" }) },
    sendRoomMessage: { mutateAsync: vi.fn().mockResolvedValue(undefined) },
    resolveDM: { mutateAsync: vi.fn() },
    createGroup: { mutateAsync: vi.fn().mockResolvedValue({ id: "g1", name: "Squad", member_user_ids: ["u2"] }) },
    inviteMembers: { mutateAsync: vi.fn() },
    leaveRoom: { mutateAsync: vi.fn().mockResolvedValue(undefined) },
    setConnectError,
    setCreateGroupOpen: vi.fn(),
    setAddMembersOpen: vi.fn(),
    setDmSettingsOpen: vi.fn(),
    setGroupSettingsOpen: vi.fn(),
    setCreatingGroup: vi.fn(),
    setInvitingMembers: vi.fn(),
    setLeavingConversation: vi.fn(),
    clearGroupMemberProfiles: vi.fn(),
    ...overrides,
  };
}

describe("useChatPageActions", () => {
  it("sends a trimmed draft and clears composer state", async () => {
    const deps = buildDeps();
    const { result } = renderHook(() => useChatPageActions(deps));

    await act(async () => {
      await result.current.provisionAndSend();
    });

    expect(deps.sendRoomMessage.mutateAsync).toHaveBeenCalledWith({
      roomId: "room1",
      body: "hello",
    });
    expect(deps.setReplyTo).toHaveBeenCalledWith(null);
    expect(deps.setDraft).toHaveBeenCalledWith("");
  });

  it("creates a group and selects it on success", async () => {
    const deps = buildDeps();
    const members = [
      { user_id: "u1", email: "a@example.com", display_name: "A" },
      { user_id: "u2", email: "b@example.com", display_name: "B" },
    ];
    const { result } = renderHook(() => useChatPageActions(deps));

    act(() => {
      result.current.handleCreateGroup(members, "Squad");
    });

    await waitFor(() => {
      expect(deps.createGroup.mutateAsync).toHaveBeenCalledWith({
        name: "Squad",
        member_user_ids: ["u1", "u2"],
      });
      expect(deps.setTarget).toHaveBeenCalledWith({
        kind: "group",
        group: expect.objectContaining({ id: "g1", name: "Squad" }),
      });
      expect(deps.setCreateGroupOpen).toHaveBeenCalledWith(false);
    });
  });

  it("provisions a workspace room before sending the first message", async () => {
    const deps = buildDeps({
      activeRoomId: null,
      ensureRoom: { mutateAsync: vi.fn().mockResolvedValue({ room_id: "room-ws" }) },
    });
    const { result } = renderHook(() => useChatPageActions(deps));

    await act(async () => {
      await result.current.provisionAndSend();
    });

    expect(deps.ensureRoom.mutateAsync).toHaveBeenCalled();
    expect(deps.sendRoomMessage.mutateAsync).toHaveBeenCalledWith({
      roomId: "room-ws",
      body: "hello",
    });
  });

  it("resolves a dm room before sending", async () => {
    const deps = buildDeps({
      activeRoomId: null,
      target: { kind: "dm", contact: { user_id: "u2", email: "b@example.com", display_name: "B" } },
      resolveDM: { mutateAsync: vi.fn().mockResolvedValue({ id: "room-dm" }) },
    });
    const { result } = renderHook(() => useChatPageActions(deps));

    await act(async () => {
      await result.current.provisionAndSend();
    });

    expect(deps.resolveDM.mutateAsync).toHaveBeenCalledWith("u2");
    expect(deps.sendRoomMessage.mutateAsync).toHaveBeenCalledWith({
      roomId: "room-dm",
      body: "hello",
    });
  });

  it("invites members into the active group", async () => {
    const group = { id: "g1", name: "Design", room_id: "room-g1", member_user_ids: ["u3"] };
    const deps = buildDeps({
      activeGroup: group,
      inviteMembers: {
        mutateAsync: vi.fn().mockResolvedValue({
          id: "g1",
          name: "Design",
          member_user_ids: ["u3", "u2"],
        }),
      },
    });
    const members = [{ user_id: "u2", email: "b@example.com", display_name: "B" }];
    const { result } = renderHook(() => useChatPageActions(deps));

    act(() => {
      result.current.handleAddGroupMembers(members);
    });

    await waitFor(() => {
      expect(deps.inviteMembers.mutateAsync).toHaveBeenCalledWith({
        roomId: "room-g1",
        memberUserIds: ["u2"],
      });
      expect(deps.setAddMembersOpen).toHaveBeenCalledWith(false);
    });
  });

  it("surfaces blocked-user errors when sending", async () => {
    const deps = buildDeps({
      sendRoomMessage: {
        mutateAsync: vi.fn().mockRejectedValue(new ApiError("blocked", "chat_user_blocked", 403)),
      },
    });
    const { result } = renderHook(() => useChatPageActions(deps));

    await act(async () => {
      await result.current.provisionAndSend();
    });

    expect(deps.setConnectError).toHaveBeenCalledWith("Không thể gửi tin nhắn tới người này.");
  });

  it("leaves the active conversation and resets target", async () => {
    const deps = buildDeps({
      activeGroup: { id: "g1", name: "Squad", room_id: "room-g1", member_user_ids: ["u2"] },
    });
    const cleanup = vi.fn();
    const { result } = renderHook(() => useChatPageActions(deps));

    await act(async () => {
      await result.current.handleLeaveConversation("room-g1", cleanup);
    });

    expect(deps.leaveRoom.mutateAsync).toHaveBeenCalledWith("room-g1");
    expect(cleanup).toHaveBeenCalled();
    expect(deps.setTarget).toHaveBeenCalledWith({ kind: "workspace" });
    expect(deps.clearGroupMemberProfiles).toHaveBeenCalled();
  });
});
