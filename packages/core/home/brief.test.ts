import { describe, expect, it } from "vitest";
import type { Meeting, Task } from "../types";
import type { HomeSummary } from "../types/home";
import { buildHomeHeadline, overdueDays } from "./brief";

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

describe("buildHomeHeadline", () => {
  it("calls a clear day clear", () => {
    expect(buildHomeHeadline(summary({}))).toEqual({ key: "home.headline.clear", params: {} });
  });

  it("puts a failed source before anything its zeros would hide", () => {
    expect(buildHomeHeadline(summary({ partial: ["tasks"], counts: { ...zero, unread: 3 } })).key).toBe("home.headline.partial");
  });

  it("names the oldest overdue task with its age", () => {
    expect(buildHomeHeadline(summary({
      counts: { ...zero, overdue: 2, meetings_today: 1 },
      my_work: [task("Cũ nhất", "2026-09-01"), task("Mới hơn", "2026-09-10")],
    }))).toEqual({ key: "home.headline.overdue", params: { title: "Cũ nhất", count: 13 } });
  });

  it("falls back to the count when the overdue task is not in the list", () => {
    expect(buildHomeHeadline(summary({ counts: { ...zero, overdue: 5 }, my_work: [task("Hôm nay", "2026-09-14")] }))).toEqual({
      key: "home.headline.overdue_plain", params: { count: 5 },
    });
  });

  it("points at a meeting in progress before the next one", () => {
    expect(buildHomeHeadline(summary({
      counts: { ...zero, meetings_today: 2 },
      upcoming_meetings: [meeting("Đang họp", "2026-09-14T01:00:00Z", "IN_PROGRESS"), meeting("Chiều nay", "2026-09-14T07:00:00Z")],
    }))).toEqual({ key: "home.headline.live", params: { title: "Đang họp" } });
  });

  it("names the next meeting starting today, not tomorrow's, with its start", () => {
    expect(buildHomeHeadline(summary({
      counts: { ...zero, meetings_today: 1, due_today: 2 },
      upcoming_meetings: [meeting("Chiều nay", "2026-09-14T07:00:00Z"), meeting("Ngày mai", "2026-09-15T02:00:00Z")],
    }))).toEqual({ key: "home.headline.meeting", params: { title: "Chiều nay" }, at: "2026-09-14T07:00:00Z" });
  });

  it("then counts what is due today, then what is unread", () => {
    expect(buildHomeHeadline(summary({ counts: { ...zero, due_today: 2, unread: 1 } })).key).toBe("home.headline.due_today");
    expect(buildHomeHeadline(summary({ counts: { ...zero, unread: 1 } }))).toEqual({ key: "home.headline.unread", params: { count: 1 } });
  });
});
