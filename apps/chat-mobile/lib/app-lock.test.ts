import { describe, expect, it } from "vitest";
import { DEFAULT_PRIVACY_SETTINGS, RELOCK_AFTER_MS, coversWhenAway, parsePrivacySettings, relockFromValue, relockLabel, serializePrivacySettings, shouldLock } from "./app-lock";

describe("parsePrivacySettings", () => {
  it("reads what was saved, and both protections off when nothing or nothing usable was", () => {
    const saved = { appLock: true, relockAfterMs: 300_000, screenSecurity: true, usageStats: false } as const;
    expect(parsePrivacySettings(serializePrivacySettings(saved))).toEqual(saved);
    for (const raw of [null, "", "not json", "[]", "null", '"on"']) expect(parsePrivacySettings(raw)).toEqual(DEFAULT_PRIVACY_SETTINGS);
    expect(DEFAULT_PRIVACY_SETTINGS).toEqual({ appLock: false, relockAfterMs: 60_000, screenSecurity: false, usageStats: true });
  });

  it("takes only a true as on and only an offered delay", () => {
    expect(parsePrivacySettings(JSON.stringify({ appLock: "yes", relockAfterMs: 42, screenSecurity: 1 }))).toEqual(DEFAULT_PRIVACY_SETTINGS);
    expect(parsePrivacySettings(JSON.stringify({ appLock: true, relockAfterMs: 0 }))).toEqual({ appLock: true, relockAfterMs: 0, screenSecurity: false, usageStats: true });
    // The usage counters go off only on an explicit false (audit "no-product-analytics": the person's opt-out).
    expect(parsePrivacySettings(JSON.stringify({ usageStats: false })).usageStats).toBe(false);
    expect(parsePrivacySettings(JSON.stringify({ usageStats: "no" })).usageStats).toBe(true);
  });
});

describe("shouldLock", () => {
  const on = { ...DEFAULT_PRIVACY_SETTINGS, appLock: true };

  it("never locks with the lock off", () => {
    expect(shouldLock(DEFAULT_PRIVACY_SETTINGS, null, 0)).toBe(false);
    expect(shouldLock(DEFAULT_PRIVACY_SETTINGS, 0, 10_000_000)).toBe(false);
  });

  it("locks every cold start, and a return after the chosen time away", () => {
    expect(shouldLock(on, null, 0)).toBe(true);
    expect(shouldLock(on, 1_000, 1_000 + 59_999)).toBe(false);
    expect(shouldLock(on, 1_000, 1_000 + 60_000)).toBe(true);
    expect(shouldLock({ ...on, relockAfterMs: 0 }, 1_000, 1_000)).toBe(true);
  });
});

describe("coversWhenAway and relockLabel", () => {
  it("covers the app away from the front when either protection is on", () => {
    expect(coversWhenAway(DEFAULT_PRIVACY_SETTINGS)).toBe(false);
    expect(coversWhenAway({ ...DEFAULT_PRIVACY_SETTINGS, appLock: true })).toBe(true);
    expect(coversWhenAway({ ...DEFAULT_PRIVACY_SETTINGS, screenSecurity: true })).toBe(true);
  });

  it("reads an option's value back as its delay, and anything else as the default", () => {
    expect(RELOCK_AFTER_MS.map((ms) => relockFromValue(`${ms}`))).toEqual([...RELOCK_AFTER_MS]);
    expect(relockFromValue("42")).toBe(60_000);
  });

  it("names every delay it offers", () => {
    expect(RELOCK_AFTER_MS.map(relockLabel)).toEqual([
      "mobile.security.app_lock_after_now",
      "mobile.security.app_lock_after_1m",
      "mobile.security.app_lock_after_5m",
      "mobile.security.app_lock_after_15m",
    ]);
  });
});
