import { describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { defaultInviteLinkLabel } from "./invite-link-display";

const i18n = initI18n();
const t = i18n.t.bind(i18n) as (key: string, options?: Record<string, unknown>) => string;

describe("defaultInviteLinkLabel", () => {
  it("stores a sentence with the creation time, never an i18n key", () => {
    const label = defaultInviteLinkLabel("2026-09-03T07:46:00.000Z", "vi", t);
    expect(label).toContain("Liên kết");
    expect(label).toMatch(/46/);
    expect(label).not.toContain("meetings.");
  });

  it("leaves the time out of an unreadable timestamp", () => {
    const echo = (key: string, options?: Record<string, unknown>) => `${key}${JSON.stringify(options)}`;
    expect(defaultInviteLinkLabel("not-a-date", "en", echo)).toBe('meetings.linkDefaultName{"time":""}');
  });
});
