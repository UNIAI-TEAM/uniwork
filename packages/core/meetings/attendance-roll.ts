import type { AttendanceStatus, MeetingAttendance } from "../types/meeting";

/**
 * The roll after one clerk mark, counted the way MeetingService.attendanceReport
 * counts it: members only, late counts as attending for the quorum. Used for
 * the optimistic cache write; the refetch after it is the source of truth.
 */
export function applyAttendanceMark(
  roll: MeetingAttendance,
  participantId: string,
  status: AttendanceStatus,
  note?: string,
): MeetingAttendance {
  const rows = roll.rows.map((r) =>
    r.participant_id === participantId
      ? { ...r, status, source: "MANUAL", note: status === "EXCUSED" ? (note ?? "").trim() : "" }
      : r,
  );
  const summary = { members: 0, present: 0, late: 0, excused: 0, absent: 0, quorum_met: null as boolean | null };
  for (const r of rows) {
    if (r.standing !== "MEMBER") continue;
    summary.members++;
    if (r.status === "PRESENT") summary.present++;
    else if (r.status === "LATE") summary.late++;
    else if (r.status === "EXCUSED") summary.excused++;
    else summary.absent++;
  }
  const quorum = roll.quorum_percent;
  if (quorum && summary.members > 0) {
    summary.quorum_met = (summary.present + summary.late) * 100 >= quorum * summary.members;
  }
  return { ...roll, rows, summary };
}

/** Where the roll stands against its minimum attendance, in people. */
export function attendanceQuorum(roll: MeetingAttendance): {
  attended: number;
  members: number;
  percent: number;
  required: number | null;
  missing: number;
} {
  const { members, present, late } = roll.summary;
  const attended = present + late;
  const required = roll.quorum_percent || null;
  const needed = required && members > 0 ? Math.ceil((required * members) / 100) : 0;
  return {
    attended,
    members,
    // Rounded down: 199 of 200 must not read as 100% next to "below quorum".
    percent: members > 0 ? Math.floor((attended * 100) / members) : 0,
    required,
    missing: Math.max(0, needed - attended),
  };
}
