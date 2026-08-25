import { describe, expect, it } from "vitest";
import { splitMeetings } from "./hooks";
import type { Meeting } from "../types";

const mk = (id: string, starts: string, ends: string): Meeting => ({
  id,
  workspace_id: "w",
  title: id,
  description: "",
  starts_at: starts,
  ends_at: ends,
  room_name: `uniwork-${id}`,
  created_by: "u",
});

describe("splitMeetings", () => {
  it("splits by ends_at and sorts each side", () => {
    const now = new Date("2026-08-24T12:00:00Z");
    const a = mk("a", "2026-08-24T13:00:00Z", "2026-08-24T14:00:00Z"); // upcoming
    const b = mk("b", "2026-08-25T09:00:00Z", "2026-08-25T10:00:00Z"); // upcoming, sau a
    const c = mk("c", "2026-08-20T09:00:00Z", "2026-08-20T10:00:00Z"); // past
    const d = mk("d", "2026-08-23T09:00:00Z", "2026-08-23T10:00:00Z"); // past, mới hơn c
    const { upcoming, past } = splitMeetings([d, b, c, a], now);
    expect(upcoming.map((m) => m.id)).toEqual(["a", "b"]);
    expect(past.map((m) => m.id)).toEqual(["d", "c"]);
  });
});
