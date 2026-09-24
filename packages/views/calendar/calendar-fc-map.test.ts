import { describe, expect, it } from "vitest";
import { toFcEvent } from "./calendar-fc-map";

describe("toFcEvent", () => {
  it("maps core fields and extendedProps", () => {
    expect(
      toFcEvent({
        id: "ev1",
        kind: "task",
        entityId: "task-1",
        title: "Ship calendar",
        start: "2026-09-10",
        end: "2026-09-11",
        allDay: true,
      }),
    ).toEqual({
      id: "ev1",
      title: "Ship calendar",
      start: "2026-09-10",
      end: "2026-09-11",
      allDay: true,
      extendedProps: { kind: "task", entityId: "task-1" },
    });
  });

  it("omits end when the source has no end", () => {
    const fc = toFcEvent({
      id: "m1",
      kind: "meeting",
      entityId: "meet-1",
      title: "Standup",
      start: "2026-09-10T09:00:00Z",
      allDay: false,
    });
    expect(fc.end).toBeUndefined();
    expect(fc.extendedProps).toEqual({ kind: "meeting", entityId: "meet-1" });
  });

  it("preserves optional metadata on the source without putting it on the FC event", () => {
    const fc = toFcEvent({
      id: "t2",
      kind: "task",
      entityId: "task-2",
      title: "Review",
      start: "2026-09-12",
      allDay: true,
      status: "in_progress",
      priority: "high",
      projectId: "proj-1",
    });
    expect(fc).toMatchObject({
      id: "t2",
      title: "Review",
      extendedProps: { kind: "task", entityId: "task-2" },
    });
    expect("status" in fc).toBe(false);
  });
});
