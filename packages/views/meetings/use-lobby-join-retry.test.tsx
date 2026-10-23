import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, type WSMessage } from "@uniwork/core/api";
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

  it("coalesces a burst of lobby events into one join", () => {
    const onRetry = vi.fn();
    renderHook(() =>
      useLobbyJoinRetry({ meetingId: "m1", decision: "WAITING_FOR_HOST", admitted: false, hasJoinError: false, onRetry }),
    );
    for (let i = 0; i < 5; i += 1) {
      handlers[0]!({ type: "meeting.started", payload: { meeting_id: "m1" } } as WSMessage);
      vi.advanceTimersByTime(50);
    }
    vi.advanceTimersByTime(1_000);
    expect(onRetry).toHaveBeenCalledTimes(1);

    // Once that join has gone out, the next signal schedules a fresh one.
    handlers[0]!({ type: "meeting.ended", payload: { meeting_id: "m1" } } as WSMessage);
    vi.advanceTimersByTime(500);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it("ignores another person's approval and answers its own", () => {
    const onRetry = vi.fn();
    renderHook(() =>
      useLobbyJoinRetry({
        meetingId: "m1",
        decision: "WAITING_APPROVAL",
        admitted: false,
        hasJoinError: false,
        joinRequestId: "jr1",
        onRetry,
      }),
    );
    handlers[0]!({ type: "join_request.approved", payload: { meeting_id: "m1", join_request_id: "jr2" } } as WSMessage);
    handlers[0]!({ type: "join_request.rejected", payload: { meeting_id: "m1", join_request_id: "jr3" } } as WSMessage);
    vi.advanceTimersByTime(1_000);
    expect(onRetry).not.toHaveBeenCalled();

    handlers[0]!({ type: "join_request.approved", payload: { meeting_id: "m1", join_request_id: "jr1" } } as WSMessage);
    vi.advanceTimersByTime(500);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("asks again after Retry-After when /join is rate limited", () => {
    const onRetry = vi.fn();
    const err = Object.assign(new ApiError("too many requests", "rate_limited", 429), { retryAfterSeconds: 5 });
    renderHook(() =>
      useLobbyJoinRetry({
        meetingId: "m1",
        decision: "WAITING_APPROVAL",
        admitted: false,
        hasJoinError: true,
        joinError: err,
        onRetry,
      }),
    );
    // An event during the wait does not jump the server's Retry-After.
    handlers[0]?.({ type: "join_request.approved", payload: { meeting_id: "m1" } } as WSMessage);
    vi.advanceTimersByTime(4_999);
    expect(onRetry).not.toHaveBeenCalled();
    // Retry-After plus up to 3s of jitter.
    vi.advanceTimersByTime(3_001);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("retries a 503 on the lobby backoff even before any lobby answer", () => {
    const onRetry = vi.fn();
    renderHook(() =>
      useLobbyJoinRetry({
        meetingId: "m1",
        decision: undefined,
        admitted: false,
        hasJoinError: true,
        joinError: new ApiError("unavailable", "unavailable", 503),
        onRetry,
      }),
    );
    vi.advanceTimersByTime(7_999);
    expect(onRetry).not.toHaveBeenCalled();
    vi.advanceTimersByTime(4_001);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("does not retry a refusal", () => {
    const onRetry = vi.fn();
    renderHook(() =>
      useLobbyJoinRetry({
        meetingId: "m1",
        decision: "WAITING_APPROVAL",
        admitted: false,
        hasJoinError: true,
        joinError: new ApiError("forbidden", "forbidden", 403),
        onRetry,
      }),
    );
    vi.advanceTimersByTime(120_000);
    expect(onRetry).not.toHaveBeenCalled();
  });
});
