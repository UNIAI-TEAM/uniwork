import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import {
  MeetingScheduleFields,
  scheduleProblems,
  scheduleValid,
} from "./meeting-schedule-fields";

beforeAll(() => {
  initI18n();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("scheduleValid", () => {
  it("needs a window with length; an earlier end is the next day", () => {
    expect(scheduleValid("09:00", "09:30")).toBe(true);
    expect(scheduleValid("09:00", "09:00")).toBe(false);
    expect(scheduleValid("10:00", "09:30")).toBe(true);
    expect(scheduleValid("", "09:30")).toBe(false);
  });
});

describe("scheduleProblems", () => {
  const nowMs = Date.parse("2026-08-28T03:00:00Z"); // 10:00 in Ho Chi Minh City

  it("flags a start that already passed, in the meeting's zone", () => {
    const base = { date: "2026-08-28", end: "11:30", timeZone: "Asia/Ho_Chi_Minh", nowMs };
    expect(scheduleProblems({ ...base, start: "09:30" }).startPassed).toBe(true);
    expect(scheduleProblems({ ...base, start: "10:30" }).startPassed).toBe(false);
    // 09:30 in Tokyo is 07:30 in Ho Chi Minh City: long gone too.
    expect(scheduleProblems({ ...base, start: "09:30", timeZone: "Asia/Tokyo" }).startPassed).toBe(true);
    // 12:30 in Tokyo is 10:30 in Ho Chi Minh City: still ahead.
    expect(scheduleProblems({ ...base, start: "12:30", end: "13:00", timeZone: "Asia/Tokyo" }).startPassed).toBe(false);
  });

  it("does not flag an untouched start while editing", () => {
    expect(
      scheduleProblems({ date: "2026-08-28", start: "09:30", end: "10:00", timeZone: "Asia/Ho_Chi_Minh", nowMs, checkPast: false })
        .startPassed,
    ).toBe(false);
  });
});

describe("MeetingScheduleFields", () => {
  it("names hour and minute segments apart and says an earlier end is the next day", () => {
    render(
      <MeetingScheduleFields
        idPrefix="t"
        date="2099-08-29"
        start="23:00"
        end="00:30"
        onDate={() => {}}
        onStart={() => {}}
        onEnd={() => {}}
      />,
    );
    expect(screen.getByLabelText("Giờ bắt đầu")).toBeInTheDocument();
    expect(screen.getByLabelText("Phút kết thúc")).toBeInTheDocument();
    expect(screen.getByText("Kết thúc vào hôm sau")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("flags an end equal to the start on the end field", () => {
    render(
      <MeetingScheduleFields
        idPrefix="t"
        date="2099-08-29"
        start="10:00"
        end="10:00"
        onDate={() => {}}
        onStart={() => {}}
        onEnd={() => {}}
      />,
    );
    const error = screen.getByText("Giờ kết thúc phải khác giờ bắt đầu.");
    const group = screen.getByRole("group", { name: "Kết thúc" });
    expect(group).toHaveAttribute("aria-invalid", "true");
    expect(group).toHaveAttribute("aria-describedby", error.id);
  });

  it("flags a start earlier today", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-28T03:00:00Z"));
    render(
      <MeetingScheduleFields
        idPrefix="t"
        date="2026-08-28"
        start="09:00"
        end="09:30"
        timeZone="Asia/Ho_Chi_Minh"
        onDate={() => {}}
        onStart={() => {}}
        onEnd={() => {}}
      />,
    );
    const error = screen.getByText("Giờ bắt đầu đã qua.");
    expect(screen.getByRole("group", { name: "Bắt đầu" })).toHaveAttribute("aria-describedby", error.id);
  });
});

describe("MeetingScheduleFields — start moved past the end", () => {
  it("carries the end along instead of leaving it stale", () => {
    const onEnd = vi.fn();
    render(
      <MeetingScheduleFields
        idPrefix="t"
        date="2099-08-29"
        start="17:00"
        end="18:00"
        onDate={() => {}}
        onStart={() => {}}
        onEnd={onEnd}
      />,
    );
    const hour = screen.getByLabelText("Giờ bắt đầu");
    fireEvent.keyDown(hour, { key: "ArrowUp" });
    expect(onEnd).toHaveBeenCalledWith("18:30");
  });

  it("wraps the carried end past midnight instead of clamping to 23:59", () => {
    const onEnd = vi.fn();
    render(
      <MeetingScheduleFields
        idPrefix="t"
        date="2099-08-29"
        start="22:45"
        end="23:45"
        onDate={() => {}}
        onStart={() => {}}
        onEnd={onEnd}
      />,
    );
    fireEvent.keyDown(screen.getByLabelText("Giờ bắt đầu"), { key: "ArrowUp" });
    expect(onEnd).toHaveBeenCalledWith("00:15");
  });
});
