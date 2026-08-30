import { DisconnectReason } from "livekit-client";
import { describe, expect, it } from "vitest";
import { shouldLeaveOnDisconnect, tokenRefreshDelayMs } from "./room-connection";

describe("tokenRefreshDelayMs", () => {
  const now = Date.parse("2026-08-28T08:00:00.000Z");

  it("returns null when expires_at is missing or unparseable", () => {
    expect(tokenRefreshDelayMs(undefined, now)).toBeNull();
    expect(tokenRefreshDelayMs("", now)).toBeNull();
    expect(tokenRefreshDelayMs("not-a-date", now)).toBeNull();
  });

  it("schedules 15s before expiry and never a negative delay", () => {
    expect(tokenRefreshDelayMs("2026-08-28T08:02:00.000Z", now)).toBe(105_000);
    expect(tokenRefreshDelayMs("2026-08-28T07:59:00.000Z", now)).toBe(0);
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
