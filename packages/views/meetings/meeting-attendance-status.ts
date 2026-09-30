import { ATTENDANCE_STATUSES, type AttendanceStatus } from "@uniwork/core/types/meeting";
import type { MeetingTone } from "./meeting-status-badge";

/**
 * One colour per attendance status, shared by the summary tiles, the clerk's
 * picker and the read-only badge, so a status reads the same wherever it is.
 * Absent is the one to find at a glance, so it is not the quiet grey.
 */
export const ATTENDANCE_TONE: Record<AttendanceStatus, MeetingTone> = {
  PRESENT: "success",
  LATE: "warning",
  EXCUSED: "info",
  ABSENT: "destructive",
};

export const ATTENDANCE_DOT: Record<AttendanceStatus, string> = {
  PRESENT: "bg-success",
  LATE: "bg-warning",
  EXCUSED: "bg-info",
  ABSENT: "bg-destructive",
};

/** A server status the client does not know reads as absent, the safe side for a roll. */
export function asAttendanceStatus(s: string): AttendanceStatus {
  return (ATTENDANCE_STATUSES as readonly string[]).includes(s) ? (s as AttendanceStatus) : "ABSENT";
}
