import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import {
  TaskScheduleField,
  taskScheduleLocalValue,
  updateTaskSchedule,
} from "./task-schedule-field";

initI18n();

const localIso = (value: string) => new Date(value).toISOString();

describe("task schedule transport", () => {
  it("shows persisted instants in the viewer local date and time", () => {
    expect(
      taskScheduleLocalValue(
        {
          start_date: "2026-09-10",
          due_date: "2026-09-10",
          start_at: "2026-09-10T02:30:00Z",
          due_at: "2026-09-10T04:00:00Z",
        },
        "start",
      ),
    ).toBe("2026-09-10T09:30");
  });

  it("falls back to each date-only value when its instant is absent or invalid", () => {
    expect(taskScheduleLocalValue({ start_date: "2026-09-08" }, "start")).toBe("2026-09-08");
    expect(
      taskScheduleLocalValue({ due_date: "2026-09-12", due_at: "not-an-instant" }, "due"),
    ).toBe("2026-09-12");
  });

  it("adds the missing end one hour after a newly timed start", () => {
    expect(
      updateTaskSchedule(
        { start_date: "2026-09-10", due_date: "2026-09-10" },
        "start",
        "2026-09-10T09:30",
      ),
    ).toEqual({
      start_date: "2026-09-10",
      due_date: "2026-09-10",
      start_at: localIso("2026-09-10T09:30"),
      due_at: localIso("2026-09-10T10:30"),
    });
  });

  it("adds the missing start one hour before a newly timed due date", () => {
    expect(
      updateTaskSchedule(
        { due_date: "2026-09-10" },
        "due",
        "2026-09-10T16:00",
      ),
    ).toEqual({
      start_date: "2026-09-10",
      due_date: "2026-09-10",
      start_at: localIso("2026-09-10T15:00"),
      due_at: localIso("2026-09-10T16:00"),
    });
  });

  it("keeps an existing valid opposite bound", () => {
    const startAt = localIso("2026-09-10T09:00");
    const dueAt = localIso("2026-09-10T12:00");

    expect(
      updateTaskSchedule(
        { start_date: "2026-09-10", due_date: "2026-09-10", due_at: dueAt },
        "start",
        "2026-09-10T10:00",
      ).due_at,
    ).toBe(dueAt);
    expect(
      updateTaskSchedule(
        { start_date: "2026-09-10", due_date: "2026-09-10", start_at: startAt },
        "due",
        "2026-09-10T11:00",
      ).start_at,
    ).toBe(startAt);
  });

  it("repairs an opposite bound that would invert the range", () => {
    const movedStart = updateTaskSchedule(
      {
        start_date: "2026-09-10",
        due_date: "2026-09-10",
        due_at: localIso("2026-09-10T09:00"),
      },
      "start",
      "2026-09-10T10:00",
    );
    expect(movedStart.due_at).toBe(localIso("2026-09-10T11:00"));

    const movedDue = updateTaskSchedule(
      {
        start_date: "2026-09-10",
        due_date: "2026-09-10",
        start_at: localIso("2026-09-10T12:00"),
      },
      "due",
      "2026-09-10T10:00",
    );
    expect(movedDue.start_at).toBe(localIso("2026-09-10T09:00"));
  });

  it("returns to all-day dates when either time is removed", () => {
    expect(
      updateTaskSchedule(
        {
          start_date: "2026-09-10",
          due_date: "2026-09-10",
          start_at: localIso("2026-09-10T09:30"),
          due_at: localIso("2026-09-10T10:30"),
        },
        "due",
        "2026-09-10",
      ),
    ).toEqual({
      start_date: "2026-09-10",
      due_date: "2026-09-10",
      start_at: undefined,
      due_at: undefined,
    });
  });

  it("clears one date and both instants when the field is cleared", () => {
    expect(
      updateTaskSchedule(
        {
          start_date: "2026-09-10",
          due_date: "2026-09-11",
          start_at: localIso("2026-09-10T09:30"),
          due_at: localIso("2026-09-11T10:30"),
        },
        "start",
        "",
      ),
    ).toEqual({
      start_date: undefined,
      due_date: "2026-09-11",
      start_at: undefined,
      due_at: undefined,
    });
  });
});

describe("TaskScheduleField", () => {
  it("keeps an all-day value until the user explicitly adds a time", () => {
    const onChange = vi.fn();
    render(
      <TaskScheduleField
        kind="due"
        label="Hạn chót"
        value={{ due_date: "2026-09-10" }}
        onChange={onChange}
      />,
    );

    expect(screen.getByRole("button", { name: "Hạn chót: Thêm giờ" })).toBeEnabled();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Hạn chót: Thêm giờ" }));

    expect(onChange).toHaveBeenCalledWith({
      start_date: "2026-09-10",
      due_date: "2026-09-10",
      start_at: localIso("2026-09-10T08:00"),
      due_at: localIso("2026-09-10T09:00"),
    });
  });

  it("removes both instants through the contextual remove-time action", () => {
    const onChange = vi.fn();
    render(
      <TaskScheduleField
        kind="start"
        label="Ngày bắt đầu"
        compact
        value={{
          start_date: "2026-09-10",
          due_date: "2026-09-10",
          start_at: localIso("2026-09-10T09:00"),
          due_at: localIso("2026-09-10T10:00"),
        }}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Ngày bắt đầu: Bỏ giờ" }));
    expect(onChange).toHaveBeenCalledWith({
      start_date: "2026-09-10",
      due_date: "2026-09-10",
      start_at: undefined,
      due_at: undefined,
    });
  });
});
