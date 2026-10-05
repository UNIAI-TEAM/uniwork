"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "../api/endpoints/meeting-attendance";
import { canClerkMeeting } from "../permissions/rules";
import { useCurrentMember } from "../permissions/use-current-member";
import type { AttendanceStatus, Meeting, MeetingAttendance } from "../types/meeting";
import { applyAttendanceMark } from "./attendance-roll";
import { meetingKeys, useParticipants } from "./hooks";

export { attendanceQuorum, motionVoterCount } from "./attendance-roll";

export function useMeetingAttendance(meetingId: string, enabled = true) {
  return useQuery({
    queryKey: meetingKeys.attendance(meetingId),
    queryFn: () => api.getMeetingAttendance(meetingId),
    enabled: enabled && Boolean(meetingId),
  });
}

/**
 * Whether the roll is finalized, for screens that only need the lock (the duty
 * menu). Reads the roll's own cache, so it costs nothing where the roll is
 * already shown; pass enabled=false for viewers who are not clerks, and for a
 * meeting that has not started, which has no roll to lock.
 */
export function useAttendanceFinalized(meetingId: string, enabled: boolean): boolean {
  const { data } = useMeetingAttendance(meetingId, enabled);
  return enabled && Boolean(data?.finalized_at);
}

function useAttendanceMutation<V>(meetingId: string, fn: (vars: V) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: meetingKeys.attendance(meetingId) });
      void qc.invalidateQueries({ queryKey: meetingKeys.activity(meetingId) });
    },
  });
}

type MarkVars = { participantId: string; status: AttendanceStatus; note?: string };

/**
 * Optimistic: a clerk picks a status and the row and counts follow at once
 * (same screen, predictable outcome, rollback is a cache restore).
 */
export function useMarkAttendance(meetingId: string) {
  const qc = useQueryClient();
  const key = meetingKeys.attendance(meetingId);
  return useMutation({
    mutationFn: (v: MarkVars) => api.markAttendance(meetingId, v.participantId, { status: v.status, note: v.note }),
    onMutate: async (v: MarkVars) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<MeetingAttendance>(key);
      if (previous) qc.setQueryData(key, applyAttendanceMark(previous, v.participantId, v.status, v.note));
      return { previous };
    },
    onError: (_err, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: meetingKeys.activity(meetingId) });
    },
  });
}

export function useClearAttendanceMark(meetingId: string) {
  return useAttendanceMutation(meetingId, (participantId: string) => api.clearAttendanceMark(meetingId, participantId));
}

export function useFinalizeAttendance(meetingId: string) {
  return useAttendanceMutation(meetingId, () => api.finalizeAttendance(meetingId));
}

export function useReopenAttendance(meetingId: string) {
  return useAttendanceMutation(meetingId, () => api.reopenAttendance(meetingId));
}

export function useUpdateMeetingParticipant(meetingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { participantId: string; standing?: "MEMBER" | "OBSERVER"; is_secretary?: boolean }) =>
      api.updateMeetingParticipant(meetingId, v.participantId, { standing: v.standing, is_secretary: v.is_secretary }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: meetingKeys.participants(meetingId) });
      void qc.invalidateQueries({ queryKey: meetingKeys.attendance(meetingId) });
    },
  });
}

/** Who may run attendance here, and who may hand out roles (host/admin only). */
export function useMeetingClerk(meeting: Meeting | null, wsId: string): { isClerk: boolean; canAssignDuties: boolean } {
  const { userId, role } = useCurrentMember(wsId);
  const { data: participants } = useParticipants(meeting?.id ?? "");
  if (!meeting) return { isClerk: false, canAssignDuties: false };
  const ctx = { userId, orgRole: null, wsRole: role };
  return {
    isClerk: canClerkMeeting(meeting, participants ?? [], ctx).allowed,
    canAssignDuties: canClerkMeeting(meeting, [], ctx).allowed,
  };
}
