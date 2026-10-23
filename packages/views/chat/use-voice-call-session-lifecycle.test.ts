import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVoiceCallSessionLifecycle } from "./use-voice-call-session-lifecycle";
import type { VoiceCallConnectionState } from "./voice-call-room-context";

type Props = { remote: number; state: VoiceCallConnectionState };

function setup(callKind: "dm" | "group", isCaller: boolean, initial: Props) {
  const handlers = { onConnected: vi.fn(), onLeave: vi.fn(), onEndForAll: vi.fn() };
  const hook = renderHook(
    ({ remote, state }: Props) =>
      useVoiceCallSessionLifecycle({
        callKind,
        isCaller,
        connectionState: state,
        remoteParticipantCount: remote,
        ...handlers,
      }),
    { initialProps: initial },
  );
  return { ...hook, handlers };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useVoiceCallSessionLifecycle", () => {
  it("only counts a 1-1 call as live once the other person is in the room", () => {
    const { result, rerender, handlers } = setup("dm", false, { remote: 0, state: "connected" });
    expect(result.current.live).toBe(false);
    expect(handlers.onConnected).not.toHaveBeenCalled();
    rerender({ remote: 1, state: "connected" });
    expect(result.current.live).toBe(true);
    expect(handlers.onConnected).toHaveBeenCalledTimes(1);
  });

  it("ends a 1-1 call with a reason when the peer leaves, after a grace period", () => {
    const { rerender, handlers } = setup("dm", true, { remote: 1, state: "connected" });
    rerender({ remote: 0, state: "connected" });
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(handlers.onEndForAll).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1_500);
    });
    expect(handlers.onEndForAll).toHaveBeenCalledWith({ reason: "peer_left" });
  });

  it("does not end the call while our own connection is healing", () => {
    const { rerender, handlers } = setup("dm", true, { remote: 1, state: "connected" });
    rerender({ remote: 0, state: "reconnecting" });
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(handlers.onEndForAll).not.toHaveBeenCalled();
  });

  it("ends a 1-1 call the peer never joins and says why", () => {
    const { handlers } = setup("dm", false, { remote: 0, state: "connected" });
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(handlers.onEndForAll).toHaveBeenCalledWith({ reason: "peer_unreachable" });
  });

  it("closes a group call its starter sits in alone after a minute", () => {
    const { handlers } = setup("group", true, { remote: 0, state: "connected" });
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(handlers.onEndForAll).toHaveBeenCalledWith({ reason: "alone" });
  });
});
