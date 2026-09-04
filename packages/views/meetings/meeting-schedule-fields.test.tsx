import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import {
  MeetingScheduleFields,
  scheduleValid,
} from "./meeting-schedule-fields";

beforeAll(() => {
  initI18n();
});

describe("scheduleValid", () => {
  it("needs the end after the start", () => {
    expect(scheduleValid("09:00", "09:30")).toBe(true);
    expect(scheduleValid("09:00", "09:00")).toBe(false);
    expect(scheduleValid("10:00", "09:30")).toBe(false);
  });
});

describe("MeetingScheduleFields", () => {
  it("names hour and minute segments apart and flags an end before the start", () => {
    render(
      <MeetingScheduleFields
        idPrefix="t"
        date="2026-08-29"
        start="10:00"
        end="09:30"
        onDate={() => {}}
        onStart={() => {}}
        onEnd={() => {}}
      />,
    );
    expect(screen.getByLabelText("Giờ bắt đầu")).toBeInTheDocument();
    expect(screen.getByLabelText("Phút kết thúc")).toBeInTheDocument();
    expect(
      screen.getByText("Giờ kết thúc phải sau giờ bắt đầu."),
    ).toBeInTheDocument();
  });
});

describe("MeetingScheduleFields — start moved past the end", () => {
  it("carries the end along instead of leaving it stale", () => {
    const onEnd = vi.fn();
    render(
      <MeetingScheduleFields
        idPrefix="t"
        date="2026-08-29"
        start="17:00"
        end="17:30"
        onDate={() => {}}
        onStart={() => {}}
        onEnd={onEnd}
      />,
    );
    const hour = screen.getByLabelText("Giờ bắt đầu");
    fireEvent.keyDown(hour, { key: "ArrowUp" });
    expect(onEnd).toHaveBeenCalledWith("18:30");
  });
});
