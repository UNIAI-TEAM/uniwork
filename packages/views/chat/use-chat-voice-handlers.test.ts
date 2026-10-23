import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useChatVoiceHandlers } from "./use-chat-voice-handlers";

const contact = {
  user_id: "u2",
  email: "binh@example.com",
  display_name: "Binh",
};

describe("useChatVoiceHandlers", () => {
  it("starts a dm voice call", async () => {
    const startCall = vi.fn().mockResolvedValue(true);
    const { result } = renderHook(() =>
      useChatVoiceHandlers({
        targetKind: "dm",
        activeRoomId: "room1",
        activeContact: contact,
        activeGroup: null,
        startCall,
      }),
    );

    await act(async () => {
      await result.current.handleStartVoiceCall();
    });

    expect(startCall).toHaveBeenCalledWith("room1", "Binh", "dm", { withCamera: false });
  });

  it("starts a dm video call with camera enabled", async () => {
    const startCall = vi.fn().mockResolvedValue(true);
    const { result } = renderHook(() =>
      useChatVoiceHandlers({
        targetKind: "dm",
        activeRoomId: "room1",
        activeContact: contact,
        activeGroup: null,
        startCall,
      }),
    );

    await act(async () => {
      await result.current.handleStartVideoCall();
    });

    expect(startCall).toHaveBeenCalledWith("room1", "Binh", "dm", { withCamera: true });
  });

  it("starts a channel voice call", async () => {
    const startCall = vi.fn().mockResolvedValue(true);
    const { result } = renderHook(() =>
      useChatVoiceHandlers({
        targetKind: "channel",
        activeRoomId: "room-c1",
        activeContact: null,
        activeGroup: null,
        activeChannel: { name: "general" },
        startCall,
      }),
    );

    await act(async () => {
      await result.current.handleStartVoiceCall();
    });

    expect(startCall).toHaveBeenCalledWith("room-c1", "#general", "channel", { withCamera: false });
  });

  it("starts a group voice call", async () => {
    const startCall = vi.fn().mockResolvedValue(true);
    const { result } = renderHook(() =>
      useChatVoiceHandlers({
        targetKind: "group",
        activeRoomId: "room-g1",
        activeContact: null,
        activeGroup: {
          id: "g1",
          name: "Design",
          room_id: "room-g1",
          member_user_ids: ["u2"],
        },
        startCall,
      }),
    );

    await act(async () => {
      await result.current.handleStartVoiceCall();
    });

    expect(startCall).toHaveBeenCalledWith("room-g1", "Design", "group", { withCamera: false });
  });

  it("does not call without a room", async () => {
    const startCall = vi.fn();
    const { result } = renderHook(() =>
      useChatVoiceHandlers({
        targetKind: "dm",
        activeRoomId: null,
        activeContact: contact,
        activeGroup: null,
        startCall,
      }),
    );

    await act(async () => {
      await result.current.handleStartVoiceCall();
    });

    expect(startCall).not.toHaveBeenCalled();
  });
});
