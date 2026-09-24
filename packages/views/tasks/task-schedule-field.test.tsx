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

    expect(screen.getByRole("button", { name: "Thêm giờ" })).toBeEnabled();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Thêm giờ" }));

    expect(onChange).toHaveBeenCalledWith({
      start_date: "2026-09-10",
      due_date: "2026-09-10",
      start_at: localIso("2026-09-10T08:00"),
      due_at: localIso("2026-09-10T09:00"),
    });
  });
});
