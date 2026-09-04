import { act, renderHook } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { ApiError } from "@uniwork/core/api/http";
import { toast } from "sonner";
import { prepareVoiceCapture } from "./voice-call-media";
import { useChatVoiceHandlers } from "./use-chat-voice-handlers";

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

vi.mock("./voice-call-media", () => ({
  prepareVoiceCapture: vi.fn(),
}));

const contact = {
  user_id: "u2",
  email: "binh@example.com",
  display_name: "Binh",
};

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  vi.mocked(prepareVoiceCapture).mockResolvedValue(true);
  vi.mocked(toast.error).mockReset();
});

describe("useChatVoiceHandlers", () => {
  it("starts a dm voice call when mic access succeeds", async () => {
    const startCall = vi.fn().mockResolvedValue(true);
    const { result } = renderHook(() =>
      useChatVoiceHandlers({
        targetKind: "dm",
        activeRoomId: "room1",
        activeContact: contact,
        activeGroup: null,
        startCall,
        acceptCall: vi.fn(),
        declineCall: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.handleStartVoiceCall();
    });

    expect(startCall).toHaveBeenCalledWith("room1", "Binh", "dm");
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
        acceptCall: vi.fn(),
        declineCall: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.handleStartVoiceCall();
    });

    expect(startCall).toHaveBeenCalledWith("room-g1", "Design", "group");
  });

  it("shows mic denied toast when capture fails", async () => {
    vi.mocked(prepareVoiceCapture).mockResolvedValue(false);
    const startCall = vi.fn();
    const { result } = renderHook(() =>
      useChatVoiceHandlers({
        targetKind: "dm",
        activeRoomId: "room1",
        activeContact: contact,
        activeGroup: null,
        startCall,
        acceptCall: vi.fn(),
        declineCall: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.handleStartVoiceCall();
    });

    expect(startCall).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });

  it("maps livekit errors to a toast message on accept", async () => {
    const acceptCall = vi.fn().mockRejectedValue(new ApiError("not configured", "livekit_not_configured", 503));
    const declineCall = vi.fn();
    const { result } = renderHook(() =>
      useChatVoiceHandlers({
        targetKind: "dm",
        activeRoomId: "room1",
        activeContact: contact,
        activeGroup: null,
        startCall: vi.fn(),
        acceptCall,
        declineCall,
      }),
    );

    await act(async () => {
      await result.current.handleAcceptVoiceCall();
    });

    expect(toast.error).toHaveBeenCalledWith("Cuộc gọi thoại chưa được cấu hình trên server.");
    expect(declineCall).toHaveBeenCalled();
  });
});
