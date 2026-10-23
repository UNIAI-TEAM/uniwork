"use client";
import { skipToken, useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../api/http";
import * as api from "../api/endpoints/meeting-summary";
import { getMeetingEvidence } from "../api/endpoints/meeting-evidence";
import type { MeetingCatchUp } from "../api/endpoints/meeting-summary";
import type { MeetingEvidenceRef } from "../types/meeting";
import { meetingKeys } from "./hooks";

export type { MeetingCatchUp, MeetingSummaryState } from "../api/endpoints/meeting-summary";
export type { MeetingSummaryRun, MeetingSummaryTopic } from "../types/meeting";

/**
 * A 4xx answer (no access, an old server's 404 for "no summary yet") comes
 * back the same on a retry; a 5xx or a dropped connection gets the default
 * retries before the panel shows its retry control.
 */
export function summaryQueryRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 3;
}

/** The meeting's latest summary; null when it has none. */
export function useMeetingSummary(meetingId: string) {
  return useQuery({
    queryKey: meetingKeys.summary(meetingId),
    queryFn: () => api.getMeetingSummary(meetingId),
    enabled: !!meetingId,
    retry: summaryQueryRetry,
    select: (s: api.MeetingSummaryState) => s.summary,
  });
}

/** How often the summary is read again while one is being made. */
export const SUMMARY_RUN_POLL_MS = 10_000;

/**
 * Whether a summary is being made (UNI-1995 #12), from the same answer as
 * useMeetingSummary. While it runs or is queued the answer is read again every
 * SUMMARY_RUN_POLL_MS: a failure that settles sends no event, a new summary
 * does (summary.created) and refetches at once.
 */
export function useMeetingSummaryRun(meetingId: string) {
  return useQuery({
    queryKey: meetingKeys.summary(meetingId),
    queryFn: () => api.getMeetingSummary(meetingId),
    enabled: !!meetingId,
    retry: summaryQueryRetry,
    select: (s: api.MeetingSummaryState) => s.run,
    refetchInterval: (q) => (q.state.data && q.state.data.run.status !== "idle" ? SUMMARY_RUN_POLL_MS : false),
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

/** Where the viewer's last catch-up brief for a meeting is kept; only a click writes it. */
export const meetingCatchUpKey = (meetingId: string) => ["meeting-catch-up", meetingId] as const;

/**
 * Asks for the late joiner's brief on click (never on mount: each one is a
 * model call). The last brief is kept per meeting for the session, so a tab
 * switch or a closed panel brings it back instead of asking again.
 */
export function useMeetingCatchUp(meetingId: string) {
  const qc = useQueryClient();
  const kept = useQuery<MeetingCatchUp>({
    queryKey: meetingCatchUpKey(meetingId),
    queryFn: skipToken,
    staleTime: Infinity,
    gcTime: Infinity,
  });
  const ask = useMutation({
    mutationFn: (locale: string) => api.createMeetingCatchUp(meetingId, locale),
    onSuccess: (brief) => {
      if (brief) qc.setQueryData(meetingCatchUpKey(meetingId), brief);
    },
  });
  return { ...ask, data: ask.data ?? kept.data };
}


const refsKey = (refs: readonly MeetingEvidenceRef[]) => refs.map((r) => `${r.kind}:${r.id}`).join(",");

/** The lines a decision or an action item cites, read when the reader opens them. */
export function useMeetingEvidence(meetingId: string, refs: readonly MeetingEvidenceRef[], enabled: boolean) {
  return useQuery({
    queryKey: meetingKeys.evidence(meetingId, refsKey(refs)),
    queryFn: () => getMeetingEvidence(meetingId, refs),
    enabled: enabled && !!meetingId && refs.length > 0,
    retry: summaryQueryRetry,
  });
}

// The evidence endpoint answers at most 20 refs per call.
const MAX_EVIDENCE_REFS = 20;

/**
 * The lines each of these items cites, read together (and shared with the
 * evidence chip's cache), with `settled` once every read answered: a failed
 * or empty one reads as no lines, never as a wait that does not end.
 */
export function useMeetingEvidenceOf(
  meetingId: string,
  items: readonly { evidence: readonly MeetingEvidenceRef[] }[],
  enabled: boolean,
) {
  const results = useQueries({
    queries: items.map((item) => {
      const refs = item.evidence.slice(0, MAX_EVIDENCE_REFS);
      return {
        queryKey: meetingKeys.evidence(meetingId, refsKey(refs)),
        queryFn: () => getMeetingEvidence(meetingId, refs),
        enabled: enabled && !!meetingId && refs.length > 0,
        retry: summaryQueryRetry,
      };
    }),
  });
  return {
    lines: results.map((r) => r.data ?? []),
    settled: results.every((r, i) => items[i]!.evidence.length === 0 || r.status !== "pending"),
  };
}
