"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../api/http";
import * as api from "../api/endpoints/meeting-summary";
import { getMeetingEvidence } from "../api/endpoints/meeting-evidence";
import type { MeetingEvidenceRef } from "../types/meeting";
import { meetingKeys } from "./hooks";

/**
 * A 4xx answer (no access, an old server's 404 for "no summary yet") comes
 * back the same on a retry; a 5xx or a dropped connection gets the default
 * retries before the panel shows its retry control.
 */
export function summaryQueryRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 3;
}

export function useMeetingSummary(meetingId: string) {
  return useQuery({
    queryKey: meetingKeys.summary(meetingId),
    queryFn: () => api.getMeetingSummary(meetingId),
    enabled: !!meetingId,
    retry: summaryQueryRetry,
  });
}

export function useCreateMeetingSummary(meetingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (locale: string) => api.createMeetingSummary(meetingId, locale),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: meetingKeys.summary(meetingId) });
      void qc.invalidateQueries({ queryKey: meetingKeys.actionItems(meetingId) });
      void qc.invalidateQueries({ queryKey: meetingKeys.activity(meetingId) });
    },
  });
}

/** The lines a decision or an action item cites, read when the reader opens them. */
export function useMeetingEvidence(meetingId: string, refs: readonly MeetingEvidenceRef[], enabled: boolean) {
  return useQuery({
    queryKey: meetingKeys.evidence(meetingId, refs.map((r) => `${r.kind}:${r.id}`).join(",")),
    queryFn: () => getMeetingEvidence(meetingId, refs),
    enabled: enabled && !!meetingId && refs.length > 0,
    retry: summaryQueryRetry,
  });
}
