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

interface SpeakerAssignment {
  labelId: string;
  user_id?: string;
  name?: string;
}

/**
 * Saves each assignment in turn and resolves with the refusals by label id
 * (the others are saved). Assigning renames transcript lines, so both
 * refetch, once for the whole batch.
 */
export function useAssignSpeakerLabels(meetingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (rows: SpeakerAssignment[]) => {
      const failed: Record<string, unknown> = {};
      for (const v of rows) {
        try {
          await api.assignSpeakerLabel(meetingId, v.labelId, { user_id: v.user_id, name: v.name });
        } catch (err) {
          failed[v.labelId] = err;
        }
      }
      return failed;
    },
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
