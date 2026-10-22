// The phone's privacy choices (Settings › Privacy & security; audit "Security &
// privacy", no-app-switcher-privacy-or-lock) and the rules that follow from
// them. Pure: data/privacy-settings.ts keeps the choices, components/app/
// privacy-guard.tsx draws the cover and the lock screen.
//
// - App lock: UniChat opens only after Face ID, a fingerprint or the phone's
//   passcode, on a cold start and when it comes back after `relockAfterMs` in
//   the background.
// - Screen security: no screenshots or screen recording of UniChat, and the
//   app switcher shows no content (Android FLAG_SECURE; iOS secure capture and
//   app switcher protection).
// Either one also covers the app while it is not in front, so the app
// switcher's snapshot shows no conversation.

/** The choices "lock again after leaving the app" offers: at once, 1, 5 or 15 minutes. */
export const RELOCK_AFTER_MS = [0, 60_000, 300_000, 900_000] as const;
export type RelockAfterMs = (typeof RELOCK_AFTER_MS)[number];

export interface PrivacySettings {
  appLock: boolean;
  relockAfterMs: RelockAfterMs;
  screenSecurity: boolean;
  /** Anonymous usage counters (data/analytics.ts): on unless the person turns them off. */
  usageStats: boolean;
}

export const DEFAULT_PRIVACY_SETTINGS: PrivacySettings = { appLock: false, relockAfterMs: 60_000, screenSecurity: false, usageStats: true };

const isRelock = (value: unknown): value is RelockAfterMs => RELOCK_AFTER_MS.some((option) => option === value);

/** The saved choices; anything missing or unreadable reads as its default (both protections off, usage counters on). */
export function parsePrivacySettings(raw: string | null): PrivacySettings {
  let value: unknown = null;
  try {
    value = raw ? JSON.parse(raw) : null;
  } catch {
    value = null;
  }
  const saved = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return {
    appLock: saved.appLock === true,
    relockAfterMs: isRelock(saved.relockAfterMs) ? saved.relockAfterMs : DEFAULT_PRIVACY_SETTINGS.relockAfterMs,
    screenSecurity: saved.screenSecurity === true,
    // Only an explicit no turns the counters off: a choice saved before they existed keeps the default.
    usageStats: saved.usageStats !== false,
  };
}

export const serializePrivacySettings = (settings: PrivacySettings): string => JSON.stringify(settings);

/**
 * Whether UniChat locks as it comes to the front. `leftAt` is when it went to the background, null for a cold start
 * (which always locks while the lock is on).
 */
export function shouldLock(settings: PrivacySettings, leftAt: number | null, now: number): boolean {
  if (!settings.appLock) return false;
  return leftAt === null || now - leftAt >= settings.relockAfterMs;
}

/** Whether the app is covered while it is not in front (the app switcher's snapshot, the notification shade). */
export function coversWhenAway(settings: PrivacySettings): boolean {
  return settings.appLock || settings.screenSecurity;
}

/** A choice of the option group (its value is a string) back to its delay; anything else is the default. */
export function relockFromValue(value: string): RelockAfterMs {
  return RELOCK_AFTER_MS.find((ms) => `${ms}` === value) ?? DEFAULT_PRIVACY_SETTINGS.relockAfterMs;
}

/** "Lock again after" as the option group names it: the i18n key of each choice. */
export function relockLabel(ms: RelockAfterMs): string {
  switch (ms) {
    case 0:
      return "mobile.security.app_lock_after_now";
    case 60_000:
      return "mobile.security.app_lock_after_1m";
    case 300_000:
      return "mobile.security.app_lock_after_5m";
    default:
      return "mobile.security.app_lock_after_15m";
  }
}
