import { describe, expect, it } from "vitest";
import type { Meeting } from "@uniwork/core/types";
import { groupMeetingsByDay } from "./meeting-list";

const at = (iso: string) => ({ id: iso, starts_at: iso, ends_at: iso }) as unknown as Meeting;

describe("groupMeetingsByDay", () => {
  it("merges a day split by the server's upcoming/past boundary and orders its rows chronologically", () => {
    // Server order: upcoming ascending, then past descending — today appears in both halves.
    const rows = [at("2026-08-29T14:00:00"), at("2026-08-30T10:00:00"), at("2026-08-29T08:00:00"), at("2026-08-28T15:00:00")];
    expect(groupMeetingsByDay(rows).map((g) => [g.day, g.items.map((m) => m.starts_at.slice(11, 16))])).toEqual([
      ["2026-08-29", ["08:00", "14:00"]],
      ["2026-08-30", ["10:00"]],
      ["2026-08-28", ["15:00"]],
    ]);
  });
});
