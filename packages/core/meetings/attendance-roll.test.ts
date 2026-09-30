import { describe, expect, it } from "vitest";
import type { MeetingAttendance, MeetingAttendanceRow } from "../types/meeting";
import { applyAttendanceMark, attendanceQuorum } from "./attendance-roll";

const row = (over: Partial<MeetingAttendanceRow>): MeetingAttendanceRow => ({
  participant_id: "p1", principal_type: "USER", display_name: "An", standing: "MEMBER", is_secretary: false,
  status: "ABSENT", source: "SUGGESTED", present_seconds: 0, session_count: 0, ...over,
});

const roll = (rows: MeetingAttendanceRow[], quorum: number | null = 60): MeetingAttendance => ({
  quorum_percent: quorum,
  summary: { members: 0, present: 0, late: 0, excused: 0, absent: 0, quorum_met: null },
  rows,
});

describe("applyAttendanceMark — the optimistic copy of MeetingService.attendanceReport", () => {
  it("marks the row manual and recounts members only", () => {
    const next = applyAttendanceMark(
      roll([row({}), row({ participant_id: "p2", status: "PRESENT" }), row({ participant_id: "g1", standing: "OBSERVER" })]),
      "p1",
      "LATE",
    );
    expect(next.rows[0]).toMatchObject({ status: "LATE", source: "MANUAL" });
    expect(next.summary).toEqual({ members: 2, present: 1, late: 1, excused: 0, absent: 0, quorum_met: true });
  });

  it("keeps a note only for an excused absence", () => {
    const start = roll([row({ note: "ốm" })]);
    expect(applyAttendanceMark(start, "p1", "EXCUSED", "Đi công tác").rows[0]?.note).toBe("Đi công tác");
    expect(applyAttendanceMark(start, "p1", "PRESENT").rows[0]?.note).toBe("");
  });

  it("has no quorum verdict without a quorum or without members", () => {
    expect(applyAttendanceMark(roll([row({})], null), "p1", "PRESENT").summary.quorum_met).toBeNull();
    expect(applyAttendanceMark(roll([row({ standing: "OBSERVER" })]), "p1", "PRESENT").summary.quorum_met).toBeNull();
  });
});

describe("attendanceQuorum", () => {
  it("counts late arrivals as attending and says how many are still needed", () => {
    const a = applyAttendanceMark(
      roll([row({}), row({ participant_id: "p2" }), row({ participant_id: "p3" }), row({ participant_id: "p4" })]),
      "p1",
      "LATE",
    );
    // 60% of 4 is 2.4, so 3 must attend: one is, two are missing.
    expect(attendanceQuorum(a)).toEqual({ attended: 1, members: 4, percent: 25, required: 60, missing: 2 });
  });

  it("never rounds a roll that is short up to 100%", () => {
    const rows = Array.from({ length: 200 }, (_, i) => row({ participant_id: `p${i}`, status: i === 0 ? "ABSENT" : "PRESENT" }));
    const q = attendanceQuorum(applyAttendanceMark(roll(rows, 100), "p1", "PRESENT"));
    expect(q).toMatchObject({ attended: 199, percent: 99, missing: 1 });
  });

  it("needs nobody once the threshold is met and has no requirement without a quorum", () => {
    const met = applyAttendanceMark(roll([row({})]), "p1", "PRESENT");
    expect(attendanceQuorum(met).missing).toBe(0);
    expect(attendanceQuorum(roll([row({})], null)).required).toBeNull();
  });
});
