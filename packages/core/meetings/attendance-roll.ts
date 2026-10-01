import type { AttendanceStatus, MeetingAttendance, MeetingAttendanceRow } from "../types/meeting";

/**
 * Whether a row counts toward the summary and the quorum. A finalized roll is a
 * snapshot of its marks: someone added after finalize has no mark and waits for
 * the roll to be reopened, while a marked person later removed still counts.
 */
export function countsOnRoll(roll: Pick<MeetingAttendance, "finalized_at">, row: MeetingAttendanceRow): boolean {
  if (row.standing !== "MEMBER") return false;
  return !(roll.finalized_at && row.joined_after_finalize);
}

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
    if (!countsOnRoll(roll, r)) continue;
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

/**
 * Where the roll stands against its minimum attendance, in people. Read from
 * the summary, which already leaves out rows added after finalize.
 */
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

/**
 * How many people a motion opened now would put on its voter roll, the way
 * MeetingService.OpenMotion builds it: members attending, minus anyone the
 * finalized snapshot still counts but who has since left the meeting.
 */
export function motionVoterCount(roll: MeetingAttendance): number {
  const { present, late } = roll.summary;
  const gone = roll.rows.filter(
    (r) => r.removed && countsOnRoll(roll, r) && (r.status === "PRESENT" || r.status === "LATE"),
  ).length;
  return Math.max(0, present + late - gone);
}
