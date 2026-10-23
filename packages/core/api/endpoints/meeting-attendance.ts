import { z } from "zod";
import {
  type AttendanceStatus,
  type MeetingAttendance,
  MeetingAttendanceSchema,
  type MeetingParticipant,
  ParticipantSchema,
} from "../../types/meeting";
import { request } from "../http";
import { parseWithFallback } from "../schema";

const enc = encodeURIComponent;
const base = (meetingId: string) => `/api/v1/meetings/${enc(meetingId)}`;

export async function getMeetingAttendance(meetingId: string): Promise<MeetingAttendance> {
  const raw = await request(`${base(meetingId)}/attendance`);
  const parsed = parseWithFallback<MeetingAttendance | null>(raw, MeetingAttendanceSchema, null, {
    endpoint: "GET /api/v1/meetings/{id}/attendance",
  });
  // An empty roll would read as "nobody came"; the panel shows its error state instead.
  if (!parsed) throw new Error("meeting_attendance_invalid");
  return parsed;
}

export async function markAttendance(
  meetingId: string,
  participantId: string,
  body: { status: AttendanceStatus; note?: string },
): Promise<void> {
  await request(`${base(meetingId)}/attendance/${enc(participantId)}`, { method: "PUT", body });
}

export async function clearAttendanceMark(meetingId: string, participantId: string): Promise<void> {
  await request(`${base(meetingId)}/attendance/${enc(participantId)}`, { method: "DELETE" });
}

export async function finalizeAttendance(meetingId: string): Promise<void> {
  await request(`${base(meetingId)}/attendance/finalize`, { method: "POST" });
}

export async function reopenAttendance(meetingId: string): Promise<void> {
  await request(`${base(meetingId)}/attendance/reopen`, { method: "POST" });
}

export async function updateMeetingParticipant(
  meetingId: string,
  participantId: string,
  body: { standing?: "MEMBER" | "OBSERVER"; is_secretary?: boolean },
): Promise<MeetingParticipant | null> {
  const raw = await request(`${base(meetingId)}/participants/${enc(participantId)}`, { method: "PATCH", body });
  const parsed = parseWithFallback<{ participant: MeetingParticipant } | null>(
    raw,
    z.object({ participant: ParticipantSchema }),
    null,
    { endpoint: "PATCH /api/v1/meetings/{id}/participants/{pid}" },
  );
  return parsed?.participant ?? null;
}
