import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCalendarSidebar, listCalendarEvents } from "./calendar";

vi.mock("../http", () => ({
  request: vi.fn(),
}));

import { request } from "../http";

describe("listCalendarEvents", () => {
  beforeEach(() => vi.mocked(request).mockReset());

  it("returns [] on malformed payload", async () => {
    vi.mocked(request).mockResolvedValue({ nope: true });
    await expect(listCalendarEvents("ws1", { from: "2026-09-01", to: "2026-09-30" })).resolves.toEqual([]);
  });

  it("parses events envelope", async () => {
    vi.mocked(request).mockResolvedValue({
      events: [
        {
          id: "task:t1",
          kind: "task",
          entity_id: "t1",
          title: "A",
          start: "2026-09-10",
          end: "2026-09-11",
          all_day: true,
        },
      ],
    });
    const ev = await listCalendarEvents("ws1", { from: "2026-09-01", to: "2026-09-30" });
    expect(ev[0]?.entityId).toBe("t1");
    expect(ev[0]?.allDay).toBe(true);
  });
});

describe("getCalendarSidebar", () => {
  beforeEach(() => vi.mocked(request).mockReset());

  it("returns empty sections on malformed payload", async () => {
    vi.mocked(request).mockResolvedValue({ priorities: "not-an-array" });
    await expect(getCalendarSidebar("ws1")).resolves.toEqual({
      priorities: [],
      meetWith: [],
      assigned: [],
      todayOverdue: [],
      backlog: [],
    });
  });

  it("parses sidebar sections", async () => {
    vi.mocked(request).mockResolvedValue({
      priorities: [
        {
          id: "t1",
          title: "P1",
          status: "todo",
          priority: "high",
          due_date: "2026-09-15",
        },
      ],
      meet_with: [
        {
          id: "m1",
          title: "Standup",
          starts_at: "2026-09-10T03:00:00Z",
          ends_at: "2026-09-10T03:30:00Z",
        },
      ],
      assigned: [],
      today_overdue: [],
      backlog: [],
    });
    const sidebar = await getCalendarSidebar("ws1");
    expect(sidebar.priorities[0]?.dueDate).toBe("2026-09-15");
    expect(sidebar.meetWith[0]?.startsAt).toBe("2026-09-10T03:00:00Z");
  });
});
