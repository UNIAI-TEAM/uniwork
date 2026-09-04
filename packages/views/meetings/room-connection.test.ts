import { DisconnectReason } from "livekit-client";
import { describe, expect, it } from "vitest";
import {
  isLobbyWaiting,
  lobbyRetryDelayMs,
  lobbyWsTriggerJitterMs,
  mediaDisconnectKind,
  shouldLeaveOnDisconnect,
  shouldRefreshCredentialOnDisconnect,
  shouldTriggerLobbyJoin,
} from "./room-connection";

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
