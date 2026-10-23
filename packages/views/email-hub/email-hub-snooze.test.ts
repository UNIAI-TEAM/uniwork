import { describe, expect, it } from "vitest";
import { emailHubSnoozeNextWeekMorning, emailHubSnoozeTomorrowMorning } from "./email-hub-snooze";

describe("emailHubSnooze presets", () => {
  it("tomorrow morning is after today and at 9:00 local", () => {
    const base = new Date("2026-09-24T15:00:00");
    const d = emailHubSnoozeTomorrowMorning(base);
    expect(d.getHours()).toBe(9);
    expect(d.getDate()).toBe(25);
  });

  it("next week is seven days after tomorrow morning", () => {
    const base = new Date("2026-09-24T15:00:00");
    const tomorrow = emailHubSnoozeTomorrowMorning(base);
    const next = emailHubSnoozeNextWeekMorning(base);
    expect(next.getTime() - tomorrow.getTime()).toBe(6 * 24 * 60 * 60 * 1000);
  });
});
