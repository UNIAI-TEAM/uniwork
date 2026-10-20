"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "../api/endpoints/meeting-speaker-labels";
import { meetingKeys } from "./hooks";

/** The meeting's speaker labels; pass enabled=false where nobody can assign them. */
export function useSpeakerLabels(meetingId: string, enabled = true) {
  return useQuery({
    queryKey: meetingKeys.speakerLabels(meetingId),
    queryFn: () => api.getSpeakerLabels(meetingId),
    enabled: enabled && Boolean(meetingId),
  });
}

/** Assigning renames transcript lines, so both refetch. */
export function useAssignSpeakerLabel(meetingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { labelId: string; user_id?: string; name?: string }) =>
      api.assignSpeakerLabel(meetingId, v.labelId, { user_id: v.user_id, name: v.name }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: meetingKeys.speakerLabels(meetingId) });
      void qc.invalidateQueries({ queryKey: meetingKeys.transcript(meetingId) });
    },
  });
}

export function useSetSharedMic(meetingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { participantId: string; enabled: boolean }) =>
      api.setParticipantSharedMic(meetingId, v.participantId, v.enabled),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: meetingKeys.participants(meetingId) });
    },
  });
}
