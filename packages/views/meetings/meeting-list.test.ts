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

describe("groupMeetingsByDay", () => {
  it("groups by day and orders rows newest-created-first within each day", () => {
    const rows = [
      at("2026-08-29T14:00:00", "2026-08-29T16:00:00Z"),
      at("2026-08-30T10:00:00", "2026-08-30T09:00:00Z"),
      at("2026-08-29T08:00:00", "2026-08-29T09:00:00Z"),
      at("2026-08-28T15:00:00", "2026-08-28T12:00:00Z"),
    ];
    expect(groupMeetingsByDay(rows).map((g) => [g.day, g.items.map((m) => m.starts_at.slice(11, 16))])).toEqual([
      ["2026-08-29", ["14:00", "08:00"]],
      ["2026-08-30", ["10:00"]],
      ["2026-08-28", ["15:00"]],
    ]);
  });

  it("sorts by id when created_at is missing", () => {
    const rows = [
      { ...at("2026-08-29T14:00:00"), id: "m-b", created_at: undefined },
      { ...at("2026-08-29T08:00:00"), id: "m-z", created_at: undefined },
    ] as Meeting[];
    const items = groupMeetingsByDay(rows)[0]!.items;
    expect(items.map((m) => m.id)).toEqual(["m-z", "m-b"]);
  });
});
