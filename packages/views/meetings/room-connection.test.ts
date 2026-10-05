import { DisconnectReason } from "livekit-client";
import { describe, expect, it } from "vitest";
import { ApiError } from "@uniwork/core/api";
import {
  isLobbyWaiting,
  isRetryableJoinError,
  joinErrorRetryDelayMs,
  lobbyRetryDelayMs,
  lobbyWsTriggerJitterMs,
  shouldTriggerLobbyJoin,
} from "./room-connection";
import {
  mediaDisconnectKind,
  shouldLeaveOnDisconnect,
  shouldRefreshCredentialOnDisconnect,
} from "./room-disconnect";

describe("lobbyRetryDelayMs", () => {
  it("uses increasing backoff steps with jitter bounded by ±20%", () => {
    const d0 = lobbyRetryDelayMs(0);
    expect(d0).toBeGreaterThanOrEqual(8_000);
    expect(d0).toBeLessThanOrEqual(12_000);
    const d3 = lobbyRetryDelayMs(3);
    expect(d3).toBeGreaterThanOrEqual(48_000);
    expect(d3).toBeLessThanOrEqual(72_000);
  });
});

describe("shouldTriggerLobbyJoin", () => {
  it("wakes the lobby for every signal that ends a wait", () => {
    for (const type of ["join_request.rejected", "meeting.ended", "meeting.canceled"]) {
      expect(shouldTriggerLobbyJoin(type, { meeting_id: "m1" }, "m1")).toBe(true);
    }
  });

  it("matches meeting.started and join_request.approved for the same meeting", () => {
    expect(
      shouldTriggerLobbyJoin("meeting.started", { meeting_id: "m1" }, "m1"),
    ).toBe(true);
    expect(
      shouldTriggerLobbyJoin("join_request.approved", { meeting_id: "m1" }, "m1"),
    ).toBe(true);
    expect(
      shouldTriggerLobbyJoin("conference.session_ready", { meeting_id: "m1" }, "m1"),
    ).toBe(true);
    expect(
      shouldTriggerLobbyJoin("meeting.started", { meeting_id: "m2" }, "m1"),
    ).toBe(false);
    expect(
      shouldTriggerLobbyJoin("participant.removed", { meeting_id: "m1" }, "m1"),
    ).toBe(false);
  });
});

describe("shouldTriggerLobbyJoin with this client's own join request", () => {
  it("wakes only the client whose request was approved or rejected", () => {
    for (const type of ["join_request.approved", "join_request.rejected"]) {
      expect(shouldTriggerLobbyJoin(type, { meeting_id: "m1", join_request_id: "jr1" }, "m1", "jr1")).toBe(true);
      expect(shouldTriggerLobbyJoin(type, { meeting_id: "m1", join_request_id: "jr2" }, "m1", "jr1")).toBe(false);
    }
  });

  it("still wakes when the frame or the client lacks the id, so nobody is stranded", () => {
    // A frame from a server that predates join_request_id in the payload.
    expect(shouldTriggerLobbyJoin("join_request.approved", { meeting_id: "m1" }, "m1", "jr1")).toBe(true);
    // A lobby that has not learned its own request id (waiting for the host).
    expect(shouldTriggerLobbyJoin("join_request.approved", { meeting_id: "m1", join_request_id: "jr2" }, "m1")).toBe(true);
  });

  it("wakes everyone for meeting-wide signals whatever request id they carry", () => {
    for (const type of ["meeting.started", "meeting.ended", "meeting.canceled", "conference.session_ready"]) {
      expect(shouldTriggerLobbyJoin(type, { meeting_id: "m1", join_request_id: "jr2" }, "m1", "jr1")).toBe(true);
    }
  });
});

function rateLimited(status: number, retryAfterSeconds?: number): ApiError {
  const err = new ApiError("too many requests", "rate_limited", status);
  return retryAfterSeconds === undefined ? err : Object.assign(err, { retryAfterSeconds });
}

describe("joinErrorRetryDelayMs", () => {
  it("treats 429 and 503 as retryable and everything else as final", () => {
    expect(isRetryableJoinError(rateLimited(429))).toBe(true);
    expect(isRetryableJoinError(rateLimited(503))).toBe(true);
    expect(isRetryableJoinError(new ApiError("forbidden", "forbidden", 403))).toBe(false);
    expect(isRetryableJoinError(new ApiError("boom", "internal", 500))).toBe(false);
    expect(isRetryableJoinError(new Error("network"))).toBe(false);
    expect(isRetryableJoinError(null)).toBe(false);
    expect(joinErrorRetryDelayMs(new ApiError("forbidden", "forbidden", 403), 0)).toBeNull();
    expect(joinErrorRetryDelayMs(undefined, 0)).toBeNull();
  });

  it("does not wait out a missing configuration: it will not fix itself, so the lobby must say so", () => {
    const notConfigured = new ApiError("x", "livekit_not_configured", 503);
    expect(isRetryableJoinError(notConfigured)).toBe(false);
    expect(joinErrorRetryDelayMs(notConfigured, 0)).toBeNull();
    expect(isRetryableJoinError(new ApiError("x", "provider_unavailable", 503))).toBe(true);
  });

  it("honours Retry-After, plus jitter so one office does not come back in the same second", () => {
    const delay = joinErrorRetryDelayMs(rateLimited(429, 7), 0);
    expect(delay).toBeGreaterThanOrEqual(7_000);
    expect(delay).toBeLessThanOrEqual(10_000);
  });

  it("falls back to the lobby backoff without a usable Retry-After", () => {
    for (const err of [rateLimited(503), rateLimited(429, Number.NaN), rateLimited(429, -1)]) {
      const delay = joinErrorRetryDelayMs(err, 1);
      expect(delay).toBeGreaterThanOrEqual(16_000);
      expect(delay).toBeLessThanOrEqual(24_000);
    }
  });

  it("caps an absurd Retry-After so the lobby still comes back", () => {
    expect(joinErrorRetryDelayMs(rateLimited(429, 86_400), 0)).toBeLessThanOrEqual(303_000);
  });
});

describe("isLobbyWaiting", () => {
  it("includes provider-preparing state", () => {
    expect(isLobbyWaiting("WAITING_FOR_PROVIDER")).toBe(true);
    expect(isLobbyWaiting("ADMIT")).toBe(false);
  });

  it("includes host and approval wait states", () => {
    expect(isLobbyWaiting("WAITING_FOR_HOST")).toBe(true);
    expect(isLobbyWaiting("WAITING_APPROVAL")).toBe(true);
    expect(isLobbyWaiting(undefined)).toBe(false);
  });
});

describe("shouldLeaveOnDisconnect", () => {
  it("leaves when the host ended the session or this participant was removed", () => {
    expect(shouldLeaveOnDisconnect(DisconnectReason.PARTICIPANT_REMOVED)).toBe(true);
    expect(shouldLeaveOnDisconnect(DisconnectReason.ROOM_DELETED)).toBe(true);
    expect(shouldLeaveOnDisconnect(DisconnectReason.ROOM_CLOSED)).toBe(true);
  });

  it("stays on a local disconnect so remount or Leave unmount does not double-navigate", () => {
    expect(shouldLeaveOnDisconnect(DisconnectReason.CLIENT_INITIATED)).toBe(false);
    expect(shouldLeaveOnDisconnect(undefined)).toBe(false);
    expect(shouldLeaveOnDisconnect(DisconnectReason.UNKNOWN_REASON)).toBe(false);
    expect(shouldLeaveOnDisconnect(DisconnectReason.JOIN_FAILURE)).toBe(false);
    expect(shouldLeaveOnDisconnect(DisconnectReason.SIGNAL_CLOSE)).toBe(false);
  });
});

describe("lobbyWsTriggerJitterMs", () => {
  it("returns a bounded random delay", () => {
    expect(lobbyWsTriggerJitterMs(100)).toBeGreaterThanOrEqual(0);
    expect(lobbyWsTriggerJitterMs(100)).toBeLessThanOrEqual(100);
  });
});

describe("mediaDisconnectKind", () => {
  it("maps duplicate joins to replaced and join failures to connection", () => {
    expect(mediaDisconnectKind(DisconnectReason.DUPLICATE_IDENTITY)).toBe("replaced");
    expect(mediaDisconnectKind(DisconnectReason.JOIN_FAILURE)).toBe("connection");
    expect(mediaDisconnectKind(DisconnectReason.CLIENT_INITIATED)).toBeNull();
    expect(mediaDisconnectKind(undefined)).toBeNull();
  });
});

describe("shouldRefreshCredentialOnDisconnect", () => {
  it("does not refresh after join/media failures — a new token will not fix ICE", () => {
    expect(shouldRefreshCredentialOnDisconnect(DisconnectReason.JOIN_FAILURE)).toBe(false);
    expect(shouldRefreshCredentialOnDisconnect(DisconnectReason.USER_REJECTED)).toBe(false);
    expect(shouldRefreshCredentialOnDisconnect(DisconnectReason.STATE_MISMATCH)).toBe(false);
    expect(shouldRefreshCredentialOnDisconnect(DisconnectReason.DUPLICATE_IDENTITY)).toBe(false);
  });

  it("refreshes on unexpected disconnects but not when leaving the conference", () => {
    expect(shouldRefreshCredentialOnDisconnect(DisconnectReason.SIGNAL_CLOSE)).toBe(true);
    expect(shouldRefreshCredentialOnDisconnect(DisconnectReason.UNKNOWN_REASON)).toBe(true);
    expect(shouldRefreshCredentialOnDisconnect(DisconnectReason.SERVER_SHUTDOWN)).toBe(true);
    expect(shouldRefreshCredentialOnDisconnect(DisconnectReason.CLIENT_INITIATED)).toBe(false);
    expect(shouldRefreshCredentialOnDisconnect(DisconnectReason.ROOM_CLOSED)).toBe(false);
  });
});
