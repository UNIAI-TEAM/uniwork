import { describe, expect, it } from "vitest";
import { shouldInvalidateCalendar } from "./should-invalidate-calendar";

describe("shouldInvalidateCalendar", () => {
  it("includes task lifecycle events", () => {
    expect(shouldInvalidateCalendar("task.created")).toBe(true);
    expect(shouldInvalidateCalendar("task.updated")).toBe(true);
    expect(shouldInvalidateCalendar("task.deleted")).toBe(true);
  });

  it("includes meeting lifecycle events", () => {
    expect(shouldInvalidateCalendar("meeting.created")).toBe(true);
    expect(shouldInvalidateCalendar("meeting.updated")).toBe(true);
    expect(shouldInvalidateCalendar("meeting.canceled")).toBe(true);
  });

  it("includes participant and invitation events", () => {
    expect(shouldInvalidateCalendar("participant.invited")).toBe(true);
    expect(shouldInvalidateCalendar("participant.removed")).toBe(true);
    expect(shouldInvalidateCalendar("invitation.responded")).toBe(true);
  });

  it("excludes comment and chat events", () => {
    expect(shouldInvalidateCalendar("task.comment_added")).toBe(false);
    expect(shouldInvalidateCalendar("chat.message.created")).toBe(false);
  });
});
