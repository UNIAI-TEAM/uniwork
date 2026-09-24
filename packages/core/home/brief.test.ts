import { describe, expect, it } from "vitest";
import type { Meeting, Task } from "../types";
import type { HomeSummary } from "../types/home";
import { buildHomeBrief, overdueDays } from "./brief";

const zero = { open: 0, overdue: 0, due_today: 0, meetings_today: 0, unread: 0 };

function summary(over: Partial<HomeSummary>): HomeSummary {
  return {
    today: "2026-09-14", timezone: "Asia/Ho_Chi_Minh", counts: zero,
    my_work: [], upcoming_meetings: [], inbox: [], partial: [], generated_at: "", ...over,
  };
}

const task = (title: string, due?: string) => ({ id: title, title, due_date: due }) as Task;
const meeting = (title: string, startsAt: string, status = "SCHEDULED") =>
  ({ id: title, title, starts_at: startsAt, status }) as Meeting;

describe("overdueDays", () => {
  it("counts whole days before today and never goes negative", () => {
    expect(overdueDays("2026-09-14", "2026-09-10")).toBe(4);
    expect(overdueDays("2026-09-14", "2026-09-14")).toBe(0);
    expect(overdueDays("2026-09-14", "2026-09-20")).toBe(0);
    expect(overdueDays("2026-09-14", undefined)).toBe(0);
    expect(overdueDays("2026-09-14", "soon")).toBe(0);
  });
});

describe("buildHomeBrief", () => {
  it("says nothing when every count is zero", () => {
    expect(buildHomeBrief(summary({}))).toEqual([]);
  });

  it("names the oldest overdue task with its age", () => {
    const lines = buildHomeBrief(summary({
      counts: { ...zero, overdue: 2 },
      my_work: [task("Cũ nhất", "2026-09-01"), task("Mới hơn", "2026-09-10")],
    }));
    expect(lines).toEqual([{ key: "home.brief.overdue", params: { count: 2, title: "Cũ nhất", days: 13 } }]);
  });

  it("falls back to the count when the overdue task is not in the list", () => {
    expect(buildHomeBrief(summary({ counts: { ...zero, overdue: 5 }, my_work: [task("Hôm nay", "2026-09-14")] }))).toEqual([
      { key: "home.brief.overdue_plain", params: { count: 5 } },
    ]);
  });

  it("names the next meeting starting today, not one in progress or tomorrow", () => {
    const lines = buildHomeBrief(summary({
      counts: { ...zero, meetings_today: 1 },
      upcoming_meetings: [
        meeting("Đang họp", "2026-09-14T01:00:00Z", "IN_PROGRESS"),
        meeting("Chiều nay", "2026-09-14T07:00:00Z"),
        meeting("Ngày mai", "2026-09-15T02:00:00Z"),
      ],
    }));
    expect(lines).toEqual([{ key: "home.brief.meetings", params: { count: 1, title: "Chiều nay" } }]);
  });

  it("keeps overdue, meetings, due today and unread in that order, three at most", () => {
    const lines = buildHomeBrief(summary({
      counts: { open: 4, overdue: 1, due_today: 2, meetings_today: 1, unread: 3 },
      my_work: [task("Quá hạn", "2026-09-13")],
    }));
    expect(lines.map((l) => l.key)).toEqual(["home.brief.overdue", "home.brief.meetings_plain", "home.brief.due_today"]);
  });
});
