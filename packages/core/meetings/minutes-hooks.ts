"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "../api/endpoints/meeting-minutes";
import { meetingKeys } from "./hooks";
import { summaryQueryRetry } from "./summary-hooks";

export type { MeetingMinutes } from "../api/endpoints/meeting-minutes";

/** The meeting's minutes page and whether it is finalized (spec meeting follow-through §6.6). */
export function useMeetingMinutes(meetingId: string, enabled = true) {
  return useQuery({
    queryKey: meetingKeys.minutes(meetingId),
    queryFn: () => api.getMeetingMinutes(meetingId),
    enabled: enabled && !!meetingId,
    retry: summaryQueryRetry,
  });
}

/**
 * Every minutes command waits for the server (making a page is a create) and
 * writes the answer into the query; a refusal such as minutes_exist means the
 * state on screen is old, so the query refetches on settle either way.
 */
function useMinutesMutation<V>(meetingId: string, fn: (v: V) => Promise<api.MeetingMinutes | null>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (minutes) => qc.setQueryData(meetingKeys.minutes(meetingId), minutes),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: meetingKeys.minutes(meetingId) });
      return qc.invalidateQueries({ queryKey: meetingKeys.activity(meetingId) });
    },
  });
}

export function useCreateMeetingMinutes(meetingId: string) {
  return useMinutesMutation(meetingId, (locale: string) => api.createMeetingMinutes(meetingId, locale));
}

export function useFinalizeMeetingMinutes(meetingId: string) {
  return useMinutesMutation(meetingId, () => api.finalizeMeetingMinutes(meetingId));
}

export function useReopenMeetingMinutes(meetingId: string) {
  return useMinutesMutation(meetingId, () => api.reopenMeetingMinutes(meetingId));
}
