import { describe, expect, it } from "vitest";
import { proactiveTokenRefreshDelayMs, tokenRefreshRetryDelayMs } from "./meeting-token-refresh";

describe("proactiveTokenRefreshDelayMs", () => {
  it("returns null without a valid expiry", () => {
    expect(proactiveTokenRefreshDelayMs(undefined)).toBeNull();
    expect(proactiveTokenRefreshDelayMs("not-a-date")).toBeNull();
  });

  it("schedules refresh before expiry with a minimum lead", () => {
    const now = Date.parse("2026-01-01T00:00:00.000Z");
    const delay = proactiveTokenRefreshDelayMs("2026-01-01T00:10:00.000Z", now);
    expect(delay).toBe(510_000);
  });

  it("returns null when less than 15s remain", () => {
    const now = Date.parse("2026-01-01T00:09:50.000Z");
    expect(proactiveTokenRefreshDelayMs("2026-01-01T00:10:00.000Z", now)).toBeNull();
  });
});

describe("tokenRefreshRetryDelayMs", () => {
  const now = Date.parse("2026-01-01T00:00:00.000Z");

  it("retries every 15s while the token has time left", () => {
    expect(tokenRefreshRetryDelayMs("2026-01-01T00:01:00.000Z", now)).toBe(15_000);
  });

  it("makes a last attempt just before expiry, then stops", () => {
    expect(tokenRefreshRetryDelayMs("2026-01-01T00:00:12.000Z", now)).toBe(7_000);
    expect(tokenRefreshRetryDelayMs("2026-01-01T00:00:04.000Z", now)).toBeNull();
    expect(tokenRefreshRetryDelayMs(undefined, now)).toBeNull();
  });
});
