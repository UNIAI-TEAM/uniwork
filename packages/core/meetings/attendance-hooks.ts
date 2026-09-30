"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "../api/endpoints/meeting-attendance";
import { canClerkMeeting } from "../permissions/rules";
import { useCurrentMember } from "../permissions/use-current-member";
import type { AttendanceStatus, Meeting } from "../types/meeting";
import { meetingKeys, useParticipants } from "./hooks";

export function useMeetingAttendance(meetingId: string, enabled = true) {
  return useQuery({
    queryKey: meetingKeys.attendance(meetingId),
    queryFn: () => api.getMeetingAttendance(meetingId),
    enabled: enabled && Boolean(meetingId),
  });
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

export function useMarkAttendance(meetingId: string) {
  return useAttendanceMutation(meetingId, (v: { participantId: string; status: AttendanceStatus; note?: string }) =>
    api.markAttendance(meetingId, v.participantId, { status: v.status, note: v.note }),
  );
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
