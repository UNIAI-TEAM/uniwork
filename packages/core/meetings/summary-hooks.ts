"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../api/http";
import * as api from "../api/endpoints/meeting-summary";
import { invalidateTaskCollections } from "../tasks/invalidate";
import { meetingKeys } from "./hooks";

export type {
  MeetingSummaryTaskInput,
  MeetingSummaryTasksBody,
  MeetingSummaryTasksResult,
} from "../api/endpoints/meeting-summary";

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
      void qc.invalidateQueries({ queryKey: meetingKeys.activity(meetingId) });
    },
  });
}

/**
 * Turns chosen action items into tasks. Pessimistic (a create), and the
 * caches are refreshed on settle, not only on success: a refusal such as
 * summary_item_already_converted means the summary on screen is out of date,
 * so it and every task collection re-read the server either way.
 */
export function useCreateTasksFromSummary(workspaceId: string, meetingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: api.MeetingSummaryTasksBody) => api.createTasksFromSummary(meetingId, body),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: meetingKeys.summary(meetingId) });
      void qc.invalidateQueries({ queryKey: meetingKeys.activity(meetingId) });
      return invalidateTaskCollections(qc, workspaceId);
    },
  });
}
