import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
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
          start_at: "2026-09-10T02:30:00Z",
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
    expect(updateTaskSchedule({ due_date: "2026-09-10" }, "due", "2026-09-10T16:00")).toEqual({
      start_date: "2026-09-10",
      due_date: "2026-09-10",
      start_at: localIso("2026-09-10T15:00"),
      due_at: localIso("2026-09-10T16:00"),
    });
  });

  it("returns to all-day dates when time is removed", () => {
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
  beforeAll(async () => {
    await import("@uniwork/ui/components/ui/calendar");
  }, 60_000);

  it("adds time inside the shared picker instead of beside the date trigger", async () => {
    const onChange = vi.fn();
    render(
      <TaskScheduleField
        kind="due"
        label="Hạn chót"
        value={{ due_date: "2026-09-10" }}
        onChange={onChange}
      />,
    );

    expect(screen.queryByRole("button", { name: "Thêm giờ" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hạn chót" }));
    await screen.findAllByRole("gridcell", {}, { timeout: 20_000 });
    fireEvent.click(screen.getByRole("button", { name: "Thêm giờ" }));

    expect(onChange).toHaveBeenLastCalledWith({
      start_date: "2026-09-10",
      due_date: "2026-09-10",
      start_at: localIso("2026-09-10T08:00"),
      due_at: localIso("2026-09-10T09:00"),
    });
  });

  it("returns a timed task to all day from the same picker", async () => {
    const onChange = vi.fn();
    render(
      <TaskScheduleField
        kind="start"
        label="Ngày bắt đầu"
        value={{
          start_date: "2026-09-10",
          due_date: "2026-09-10",
          start_at: localIso("2026-09-10T09:00"),
          due_at: localIso("2026-09-10T10:00"),
        }}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Ngày bắt đầu" }));
    await screen.findByLabelText("Ngày bắt đầu: Giờ", {}, { timeout: 20_000 });
    fireEvent.click(screen.getByRole("button", { name: "Cả ngày" }));

    expect(onChange).toHaveBeenLastCalledWith({
      start_date: "2026-09-10",
      due_date: "2026-09-10",
      start_at: undefined,
      due_at: undefined,
    });
  });
});
