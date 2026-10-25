"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useOrganizationConfig } from "../feature-flags/use-public-config";
import * as api from "../api/endpoints/meeting-minutes";
import { meetingKeys } from "./hooks";
import { summaryQueryRetry } from "./summary-hooks";

export type { MeetingMinutes } from "../api/endpoints/meeting-minutes";

const MINUTES_FLAG = "meeting_minutes";

/**
 * Whether the minutes are on for an organization (`meeting_minutes`, default
 * off), read from that organization's /config answer, as the server's minutes
 * routes evaluate at the meeting's organization. Only a settled `true` shows them.
 */
export function useMeetingMinutesEnabled(organizationId: string | undefined): boolean {
  return useOrganizationConfig(organizationId).data?.flags[MINUTES_FLAG] === true;
}

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

/** Facts-only refresh of draft minutes: tasks, votes and the roll as they now stand. */
export function useRefreshMeetingMinutes(meetingId: string) {
  return useMinutesMutation(meetingId, () => api.refreshMeetingMinutes(meetingId));
}

export function useReopenMeetingMinutes(meetingId: string) {
  return useMinutesMutation(meetingId, () => api.reopenMeetingMinutes(meetingId));
}
