import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestMock } from "../test/api-mock";
import { useNativeVoiceCall } from "./use-native-voice-call";
import { VOICE_CALL_CONNECTING_TIMEOUT_MS, VOICE_CALL_RING_TIMEOUT_MS } from "./voice-call-overlay-types";

const wsHandlers = new Map<string, (payload: unknown) => void>();
const fakeWs = {
  on: (event: string, handler: (payload: unknown) => void) => {
    wsHandlers.set(event, handler);
    return () => wsHandlers.delete(event);
  },
  onReconnect: () => () => undefined,
};

vi.mock("@uniwork/core/realtime", async (orig) => ({
  ...(await orig<typeof import("@uniwork/core/realtime")>()),
  useOptionalWS: () => ({ client: fakeWs }),
}));

let pendingInvites: unknown[] = [];

function paths(fragment: string): string[] {
  return requestMock.mock.calls.map((call) => String(call[0])).filter((path) => path.includes(fragment));
}

const allowed = new Set(["room-dm", "room-other"]);

function renderCall(mintToken = vi.fn().mockResolvedValue({ token: "tok", url: "wss://lk" })) {
  return renderHook(() =>
    useNativeVoiceCall({ workspaceId: "ws1", currentUserId: "me", mintToken, allowedRoomIds: allowed }),
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  wsHandlers.clear();
  pendingInvites = [];
  requestMock.mockReset();
  requestMock.mockImplementation(async (path: string) =>
    path.includes("/voice/pending") ? { invites: pendingInvites } : { status: "ok" },
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useNativeVoiceCall", () => {
  it("hangs up an outgoing call nobody answers and says so", async () => {
    const { result } = renderCall();
    await act(async () => {
      await result.current.startCall("room-dm", "Long", "dm");
    });
    expect(result.current.voiceCall.status).toBe("ringing");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(VOICE_CALL_RING_TIMEOUT_MS);
    });

    expect(result.current.voiceCall).toMatchObject({ status: "ended", reason: "no_answer", peerName: "Long" });
    expect(paths("/voice/hangup")).toHaveLength(1);
  });

  it("stops ringing an incoming call after the ring timeout without hanging up", async () => {
    const { result } = renderCall();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      wsHandlers.get("chat.voice.invite")?.({
        room_id: "room-dm",
        call_id: "c1",
        caller_id: "peer",
        caller_name: "Long",
        target_user_id: "me",
        call_kind: "dm",
      });
    });
    expect(result.current.voiceCall.status).toBe("incoming");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(VOICE_CALL_RING_TIMEOUT_MS);
    });

    expect(result.current.voiceCall).toMatchObject({ status: "ended", reason: "missed" });
    expect(paths("/voice/hangup")).toHaveLength(0);
  });

  it("does not resurrect an invite that already rang out", async () => {
    const now = Date.now();
    pendingInvites = [
      {
        room_id: "room-dm",
        call_id: "stale",
        caller_id: "peer",
        caller_name: "Long",
        call_kind: "dm",
        invited_at: new Date(now - 2 * 60_000).toISOString(),
      },
    ];
    const { result } = renderCall();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.voiceCall.status).toBe("idle");
  });

  it("rings for a pending invite that is still fresh", async () => {
    pendingInvites = [
      {
        room_id: "room-dm",
        call_id: "fresh",
        caller_id: "peer",
        caller_name: "Long",
        call_kind: "dm",
        invited_at: new Date(Date.now() - 5_000).toISOString(),
      },
    ];
    const { result } = renderCall();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.voiceCall).toMatchObject({ status: "incoming", callId: "fresh" });
  });

  it("declines a second 1-1 call as busy instead of replacing the current one", async () => {
    const { result } = renderCall();
    await act(async () => {
      await result.current.startCall("room-dm", "Long", "dm");
    });
    const current = result.current.voiceCall;

    await act(async () => {
      wsHandlers.get("chat.voice.invite")?.({
        room_id: "room-other",
        call_id: "second",
        caller_id: "someone",
        target_user_id: "me",
        call_kind: "dm",
      });
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.voiceCall).toBe(current);
    expect(paths("/rooms/room-other/voice/hangup")).toHaveLength(1);
  });

  it("hangs up and reports on the panel when the token cannot be minted after the peer accepts", async () => {
    const mintToken = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const { result } = renderCall(mintToken);
    await act(async () => {
      await result.current.startCall("room-dm", "Long", "dm");
    });
    const callId = result.current.voiceCall.status === "ringing" ? result.current.voiceCall.callId : "";

    await act(async () => {
      wsHandlers.get("chat.voice.accept")?.({
        room_id: "room-dm",
        call_id: callId,
        user_id: "peer",
        target_user_id: "me",
        call_kind: "dm",
      });
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.voiceCall).toMatchObject({ status: "ended", reason: "connect_failed" });
    expect(paths("/voice/hangup")).toHaveLength(1);
  });

  it("gives up on a connect phase that never finishes", async () => {
    const mintToken = vi.fn(() => new Promise<null>(() => undefined));
    const { result } = renderCall(mintToken);
    await act(async () => {
      void result.current.startCall("room-group", "Team", "group");
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.voiceCall.status).toBe("connecting");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(VOICE_CALL_CONNECTING_TIMEOUT_MS);
    });

    expect(result.current.voiceCall).toMatchObject({ status: "ended", reason: "connect_failed" });
  });

  it("keeps the same API object between renders while nothing changes", () => {
    const { result, rerender } = renderCall();
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
