import { describe, expect, it } from "vitest";
import type { Meeting } from "@uniwork/core/types";
import { groupMeetingsByDay } from "./meeting-list";

const at = (starts: string, created?: string) =>
  ({
    id: created ?? starts,
    starts_at: starts,
    ends_at: starts,
    created_at: created ?? starts,
  }) as unknown as Meeting;

const hhmm = (groups: ReturnType<typeof groupMeetingsByDay>) =>
  groups.map((g) => [g.day, g.items.map((m) => m.starts_at.slice(11, 16))]);

describe("groupMeetingsByDay", () => {
  it("runs a day's rows by start time, whatever order they were created in", () => {
    const rows = [
      at("2026-08-29T14:00:00", "2026-08-29T16:00:00Z"),
      at("2026-08-29T08:00:00", "2026-08-29T09:00:00Z"),
      at("2026-08-29T11:30:00", "2026-08-20T09:00:00Z"),
    ];
    expect(hhmm(groupMeetingsByDay(rows, "2026-08-29"))).toEqual([["2026-08-29", ["08:00", "11:30", "14:00"]]]);
  });

  it("puts today and the days ahead first, soonest first, then past days newest first", () => {
    const rows = [
      at("2026-08-27T09:00:00"),
      at("2026-08-31T10:00:00"),
      at("2026-08-29T15:00:00"),
      at("2026-08-25T09:00:00"),
      at("2026-08-30T08:00:00"),
      at("2026-08-29T09:00:00"),
      at("2026-08-28T16:00:00"),
    ];
    expect(groupMeetingsByDay(rows, "2026-08-29").map((g) => g.day)).toEqual([
      "2026-08-29",
      "2026-08-30",
      "2026-08-31",
      "2026-08-28",
      "2026-08-27",
      "2026-08-25",
    ]);
  });

  it("breaks a start-time tie by id so the order never flickers", () => {
    const rows = [
      { ...at("2026-08-29T14:00:00"), id: "m-z" },
      { ...at("2026-08-29T14:00:00"), id: "m-b" },
    ] as Meeting[];
    expect(groupMeetingsByDay(rows, "2026-08-29")[0]!.items.map((m) => m.id)).toEqual(["m-b", "m-z"]);
  });
});
