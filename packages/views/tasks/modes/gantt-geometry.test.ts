import { describe, expect, it } from "vitest";
import type { Task } from "@uniwork/core/types";
import { barGeometry, computeRange, DAY_PX_BY_ZOOM } from "./gantt-geometry";

const base = {
  id: "t1",
  organization_id: "",
  workspace_id: "w1",
  number: 1,
  identifier: "T-1",
  revision: 1,
  title: "A",
  description: "",
  status: "todo" as const,
  priority: "medium" as const,
  assignee_kind: "human",
  position: 1,
  kind: "normal" as const,
  created_by: "u1",
  created_by_kind: "human",
  created_at: "2026-09-06T00:00:00Z",
  updated_at: "2026-09-06T00:00:00Z",
};

function task(over: Partial<Task> = {}): Task {
  return { ...base, ...over } as Task;
}

describe("computeRange", () => {
  const today = new Date("2026-09-15T12:00:00Z");

  it("pads around today when tasks have no dates", () => {
    const range = computeRange([], today, "day");
    expect(range.start.getTime()).toBeLessThan(today.getTime());
    expect(range.end.getTime()).toBeGreaterThan(today.getTime());
  });

  it("expands to cover start and due dates", () => {
    const range = computeRange(
      [
        task({ start_date: "2026-08-01", due_date: "2026-10-01" }),
        task({ start_date: "2026-07-01" }),
        task({ due_date: "2026-11-01" }),
      ],
      today,
      "week",
    );
    expect(range.start.getUTCFullYear()).toBe(2026);
    expect(range.start.getUTCMonth()).toBeLessThanOrEqual(6);
    expect(range.end.getUTCMonth()).toBeGreaterThanOrEqual(10);
  });

  it("uses month zoom padding", () => {
    const day = computeRange([], today, "day");
    const month = computeRange([], today, "month");
    expect(month.end.getTime() - month.start.getTime()).toBeGreaterThan(
      day.end.getTime() - day.start.getTime(),
    );
  });
});

describe("barGeometry", () => {
  const today = new Date("2026-09-15T00:00:00Z");
  const range = computeRange(
    [task({ start_date: "2026-09-10", due_date: "2026-09-20" })],
    today,
    "day",
  );
  const dayPx = DAY_PX_BY_ZOOM.day;
  const totalDays = Math.ceil(
    (range.end.getTime() - range.start.getTime()) / (24 * 60 * 60 * 1000),
  );

  it("returns null when task has no dates", () => {
    expect(barGeometry(task(), range, dayPx, totalDays)).toBeNull();
  });

  it("returns a marker for a single-date task", () => {
    const geo = barGeometry(task({ due_date: "2026-09-18" }), range, dayPx, totalDays);
    expect(geo).toMatchObject({ isMarker: true, inverted: false });
    expect(geo!.width).toBeGreaterThanOrEqual(12);
  });

  it("returns a bar for a date range", () => {
    const geo = barGeometry(
      task({ start_date: "2026-09-12", due_date: "2026-09-18" }),
      range,
      dayPx,
      totalDays,
    );
    expect(geo).toMatchObject({ isMarker: false, inverted: false });
    expect(geo!.width).toBeGreaterThan(dayPx);
  });

  it("marks inverted ranges when start is after due", () => {
    const geo = barGeometry(
      task({ start_date: "2026-09-20", due_date: "2026-09-12" }),
      range,
      dayPx,
      totalDays,
    );
    expect(geo).toMatchObject({ inverted: true, isMarker: false });
  });

  it("returns null when the bar is fully outside the visible window", () => {
    expect(
      barGeometry(
        task({ start_date: "2020-01-01", due_date: "2020-01-02" }),
        range,
        dayPx,
        totalDays,
      ),
    ).toBeNull();
  });
});
