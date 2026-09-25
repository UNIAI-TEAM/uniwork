import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WSMessage } from "@uniwork/core/api";
import { useLobbyJoinRetry } from "./use-lobby-join-retry";

const handlers: Array<(msg: WSMessage) => void> = [];
const client = {
  onAny: (fn: (msg: WSMessage) => void) => {
    handlers.push(fn);
    return () => handlers.splice(handlers.indexOf(fn), 1);
  },
  onReconnect: () => () => undefined,
  isAuthenticated: () => true,
};

vi.mock("@uniwork/core/realtime", () => ({
  useOptionalWS: () => ({ client }),
  useOptionalMeetingLobbyWS: () => null,
}));

vi.mock("./room-connection", async (orig) => ({
  ...(await orig<typeof import("./room-connection")>()),
  shouldTriggerLobbyJoin: () => true,
  lobbyWsTriggerJitterMs: () => 500,
}));

beforeEach(() => {
  vi.useFakeTimers();
  handlers.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useLobbyJoinRetry", () => {
  it("retries after the jitter when the host lets people in", () => {
    const onRetry = vi.fn();
    renderHook(() =>
      useLobbyJoinRetry({ meetingId: "m1", decision: "WAITING_APPROVAL", admitted: false, hasJoinError: false, onRetry }),
    );
    handlers[0]!({ type: "join_request.approved", payload: { meeting_id: "m1" } } as WSMessage);
    vi.advanceTimersByTime(500);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("drops a pending jittered retry once the lobby stops waiting", () => {
    const onRetry = vi.fn();
    const { rerender } = renderHook(
      ({ decision }: { decision: string | undefined }) =>
        useLobbyJoinRetry({ meetingId: "m1", decision, admitted: false, hasJoinError: false, onRetry }),
      { initialProps: { decision: "WAITING_APPROVAL" as string | undefined } },
    );
    handlers[0]!({ type: "join_request.approved", payload: { meeting_id: "m1" } } as WSMessage);
    rerender({ decision: undefined });
    vi.advanceTimersByTime(1_000);
    expect(onRetry).not.toHaveBeenCalled();
  });
});
