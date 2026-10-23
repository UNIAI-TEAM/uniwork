import { describe, expect, it } from "vitest";
import {
  DEFAULT_CALENDAR_PREFERENCES,
  calendarPreferencesSearch,
  parseCalendarPreferences,
} from "./preferences";

describe("calendar preferences", () => {
  it("parses supported URL preferences", () => {
    const params = new URLSearchParams("view=work_week&mine=1&weekends=0");

    expect(parseCalendarPreferences(params)).toEqual({
      viewMode: "work_week",
      mine: true,
      showWeekends: false,
    });
  });

  it("falls back when URL preference values are absent or invalid", () => {
    const params = new URLSearchParams("view=agenda&mine=yes&weekends=no");

    expect(parseCalendarPreferences(params)).toEqual(DEFAULT_CALENDAR_PREFERENCES);
  });

  it("writes only non-default preferences and preserves unrelated params", () => {
    expect(
      calendarPreferencesSearch("source=sidebar&view=day", {
        viewMode: "week",
        mine: true,
        showWeekends: false,
      }),
    ).toBe("source=sidebar&view=week&mine=1&weekends=0");

    expect(
      calendarPreferencesSearch("source=sidebar&view=week&mine=1&weekends=0", {
        ...DEFAULT_CALENDAR_PREFERENCES,
      }),
    ).toBe("source=sidebar");
  });
});
