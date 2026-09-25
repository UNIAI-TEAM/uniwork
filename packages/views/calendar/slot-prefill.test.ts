import { describe, expect, it } from "vitest";
import { taskDefaultsFromSlot } from "./slot-prefill";

describe("taskDefaultsFromSlot", () => {
  it("all-day click sets due_date only", () => {
    expect(
      taskDefaultsFromSlot({
        start: new Date("2026-09-10T00:00:00"),
        end: null,
        allDay: true,
      }),
    ).toEqual({ due_date: "2026-09-10" });
  });

  it("multi-day all-day select sets start and inclusive due", () => {
    expect(
      taskDefaultsFromSlot({
        start: new Date("2026-09-10T00:00:00"),
        end: new Date("2026-09-13T00:00:00"),
        allDay: true,
      }),
    ).toEqual({ start_date: "2026-09-10", due_date: "2026-09-12" });
  });

  it("timed slot keeps its local day and exact time range", () => {
    const start = new Date("2026-09-10T14:30:00");
    const end = new Date("2026-09-10T15:30:00");
    expect(
      taskDefaultsFromSlot({
        start,
        end,
        allDay: false,
      }),
    ).toEqual({
      start_date: "2026-09-10",
      due_date: "2026-09-10",
      start_at: start.toISOString(),
      due_at: end.toISOString(),
    });
  });
});
