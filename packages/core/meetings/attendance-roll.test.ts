import { describe, expect, it } from "vitest";
import type { MeetingAttendance, MeetingAttendanceRow } from "../types/meeting";
import { applyAttendanceMark, attendanceQuorum, countsOnRoll, motionVoterCount } from "./attendance-roll";

const row = (over: Partial<MeetingAttendanceRow>): MeetingAttendanceRow => ({
  participant_id: "p1", principal_type: "USER", display_name: "An", standing: "MEMBER", is_secretary: false,
  status: "ABSENT", source: "SUGGESTED", present_seconds: 0, session_count: 0, removed: false,
  joined_after_finalize: false, ...over,
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

  it("leaves out people added after finalize but keeps a marked person who was removed", () => {
    const finalized: MeetingAttendance = {
      ...roll([
        row({ status: "PRESENT", source: "MANUAL" }),
        row({ participant_id: "p2", status: "PRESENT", source: "MANUAL", removed: true }),
        row({ participant_id: "p3", status: "ABSENT", source: "MANUAL" }),
        row({ participant_id: "late", status: "PRESENT", joined_after_finalize: true }),
      ]),
      finalized_at: "2026-09-30T03:00:00Z",
    };
    const next = applyAttendanceMark(finalized, "p3", "ABSENT");
    // 2 of 3 counted members attended; the newcomer would have made it 3 of 4.
    expect(next.summary).toEqual({ members: 3, present: 2, late: 0, excused: 0, absent: 1, quorum_met: true });
    expect(countsOnRoll(finalized, finalized.rows[3]!)).toBe(false);
    expect(countsOnRoll(finalized, finalized.rows[1]!)).toBe(true);
    // An open roll has no snapshot to protect.
    expect(countsOnRoll({ finalized_at: undefined }, finalized.rows[3]!)).toBe(true);
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

  it("meets 60% of five members at exactly three, late arrivals included", () => {
    const five = (attending: number) =>
      roll(
        Array.from({ length: 5 }, (_, i) =>
          row({ participant_id: `p${i}`, status: i < attending ? (i === 0 ? "LATE" : "PRESENT") : "ABSENT" }),
        ),
      );
    // 60% of 5 is exactly 3: three attending meet it with nobody missing.
    const met = applyAttendanceMark(five(3), "p4", "ABSENT");
    expect(met.summary.quorum_met).toBe(true);
    expect(attendanceQuorum(met)).toEqual({ attended: 3, members: 5, percent: 60, required: 60, missing: 0 });
    const short = applyAttendanceMark(five(2), "p4", "ABSENT");
    expect(short.summary.quorum_met).toBe(false);
    expect(attendanceQuorum(short)).toEqual({ attended: 2, members: 5, percent: 40, required: 60, missing: 1 });
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

describe("motionVoterCount — the roll OpenMotion would freeze", () => {
  it("drops removed attendees and newcomers from a finalized roll", () => {
    const finalized = applyAttendanceMark(
      {
        ...roll([
          row({ status: "PRESENT" }),
          row({ participant_id: "p2", status: "LATE", removed: true }),
          row({ participant_id: "p3", status: "ABSENT", removed: true }),
          row({ participant_id: "p4", status: "PRESENT", joined_after_finalize: true }),
        ]),
        finalized_at: "2026-09-30T03:00:00Z",
      },
      "p1",
      "PRESENT",
    );
    expect(finalized.summary.present + finalized.summary.late).toBe(2);
    expect(motionVoterCount(finalized)).toBe(1);
  });

  it("is the attending members on an open roll", () => {
    expect(motionVoterCount(applyAttendanceMark(roll([row({}), row({ participant_id: "p2" })]), "p1", "LATE"))).toBe(1);
  });
});
