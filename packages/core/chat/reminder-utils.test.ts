import { describe, expect, it } from "vitest";
import {
  advanceReminderDate,
  canSubmitReminder,
  formatReminderTime,
  isSameCalendarDay,
  isTomorrow,
  parseDatetimeLocalValue,
  remindAtFromPreset,
  reminderBodyLabel,
  toDatetimeLocalValue,
} from "./reminder-utils";

describe("reminder-utils", () => {
  const now = new Date("2026-09-04T22:00:00");

  it("builds quick preset times", () => {
    expect(remindAtFromPreset("15m", now)!.getTime() - now.getTime()).toBe(15 * 60_000);
    expect(remindAtFromPreset("30m", now)!.getTime() - now.getTime()).toBe(30 * 60_000);
    expect(remindAtFromPreset("tomorrow_9", now)?.getHours()).toBe(9);
    expect(remindAtFromPreset("custom", now)).toBeNull();
  });

  it("round-trips datetime-local values", () => {
    const value = toDatetimeLocalValue(new Date("2026-09-04T23:35:00"));
    expect(value).toBe("2026-09-04T23:35");
    expect(parseDatetimeLocalValue(value)?.getMinutes()).toBe(35);
  });

  it("validates reminder submission", () => {
    const future = new Date(now.getTime() + 60_000);
    expect(canSubmitReminder("", future, now.getTime())).toBe(false);
    expect(canSubmitReminder("Nhắc họp", future, now.getTime())).toBe(true);
    expect(canSubmitReminder("Nhắc họp", new Date(now.getTime() - 1), now.getTime())).toBe(false);
  });

  it("detects calendar day helpers", () => {
    const today = new Date("2026-09-04T18:00:00");
    const laterToday = new Date("2026-09-04T23:00:00");
    const tomorrow = new Date("2026-09-05T09:00:00");
    expect(isSameCalendarDay(today, laterToday)).toBe(true);
    expect(isTomorrow(today, tomorrow)).toBe(true);
    expect(formatReminderTime(laterToday)).toBe("23:00");
  });

  it("advances repeating reminders", () => {
    const base = new Date("2026-09-04T09:00:00");
    expect(advanceReminderDate(base, "none")).toBeNull();
    expect(advanceReminderDate(base, "daily")?.getDate()).toBe(5);
    expect(advanceReminderDate(base, "weekly")?.getDate()).toBe(11);
    expect(advanceReminderDate(base, "monthly")?.getMonth()).toBe(9);
  });

  it("reads legacy reminder labels", () => {
    expect(reminderBodyLabel({ title: "Cũ" })).toBe("Cũ");
    expect(reminderBodyLabel({ body: "Mới" })).toBe("Mới");
  });
});
