"use client";
import { useMemo } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import * as edit from "../api/endpoints/meeting-transcript-edit";
import { listTranscriptPage } from "../api/endpoints/meetings-feed";
import type { MeetingTranscriptSegment } from "../types/meeting";
import { meetingKeys } from "./hooks";

/** The page an ended meeting's transcript reads at a time. */
const FORWARD_PAGE = 200;
/** The whole transcript, for the recording's captions: 25 pages of 400 rows. */
const FULL_PAGE = 400;
const FULL_MAX_PAGES = 25;

type PageParam = { from?: string; before?: string; around?: string };

/**
 * An ended meeting's transcript read from its start (UNI-1995 #9), a page at
 * a time with "load more" at the bottom; with `around` (a segment id) it
 * opens on the page that holds that line and can load either way.
 */
export function useTranscriptFromStart(meetingId: string, around: string, enabled = true) {
  const query = useInfiniteQuery({
    queryKey: meetingKeys.transcriptPages(meetingId, around),
    queryFn: ({ pageParam, signal }) =>
      listTranscriptPage(meetingId, {
        ...(pageParam.from ? { from: pageParam.from } : {}),
        ...(pageParam.before ? { before: pageParam.before } : {}),
        ...(pageParam.around ? { around: pageParam.around } : {}),
        ...(!pageParam.from && !pageParam.before && !pageParam.around ? { order: "asc" as const } : {}),
        limit: FORWARD_PAGE,
        signal,
      }),
    initialPageParam: (around ? { around } : {}) as PageParam,
    getNextPageParam: (last): PageParam | undefined => (last.newerCursor ? { from: last.newerCursor } : undefined),
    getPreviousPageParam: (first): PageParam | undefined => (first.olderCursor ? { before: first.olderCursor } : undefined),
    enabled: enabled && !!meetingId,
    refetchOnWindowFocus: false,
  });
  const rows = useMemo<MeetingTranscriptSegment[]>(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  return { ...query, rows };
}

/**
 * Every line of the transcript, oldest first, up to a cap (10,000 lines):
 * a recording's captions are built from the whole meeting window, not from
 * the pages a reader happened to load.
 */
export function useFullTranscript(meetingId: string, enabled = true) {
  return useQuery({
    queryKey: meetingKeys.transcriptFull(meetingId),
    queryFn: async ({ signal }) => {
      const out: MeetingTranscriptSegment[] = [];
      let from = "";
      for (let i = 0; i < FULL_MAX_PAGES; i++) {
        const page = await listTranscriptPage(meetingId, { ...(from ? { from } : { order: "asc" as const }), limit: FULL_PAGE, signal });
        out.push(...page.items);
        if (!page.newerCursor) break;
        from = page.newerCursor;
      }
      return out;
    },
    enabled: enabled && !!meetingId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

/** What a change to the transcript makes stale: every read of it, the uploads, the summary's "changed" mark. */
function invalidateTranscript(qc: QueryClient, meetingId: string): Promise<unknown> {
  return Promise.all([
    qc.invalidateQueries({ queryKey: meetingKeys.transcript(meetingId) }),
    qc.invalidateQueries({ queryKey: meetingKeys.transcriptRead(meetingId) }),
    qc.invalidateQueries({ queryKey: meetingKeys.transcriptions(meetingId) }),
    qc.invalidateQueries({ queryKey: meetingKeys.summary(meetingId) }),
  ]);
}

/** A clerk corrects one line (UNI-1995 #5); an answer that does not parse is a failure. */
export function useEditTranscriptSegment(meetingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { segmentId: string; text: string }) => {
      const seg = await edit.editTranscriptSegment(meetingId, v.segmentId, v.text);
      if (!seg) throw new Error("transcript_segment_invalid");
      return seg;
    },
    onSuccess: () => invalidateTranscript(qc, meetingId),
  });
}

/** One line, a stretch [from, to) or (neither) every line of the transcript. */
export function useDeleteTranscript(meetingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { segmentId: string } | { from: string; to: string } | { all: true }) => {
      if ("segmentId" in v) return edit.deleteTranscriptSegment(meetingId, v.segmentId);
      if ("from" in v) return void (await edit.deleteTranscript(meetingId, { from: v.from, to: v.to }));
      return void (await edit.deleteTranscript(meetingId));
    },
    onSuccess: () => invalidateTranscript(qc, meetingId),
  });
}

/** An uploaded transcription with its lines and its recording. */
export function useDeleteMeetingTranscription(meetingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (transcriptionId: string) => edit.deleteMeetingTranscription(meetingId, transcriptionId),
    onSuccess: () => invalidateTranscript(qc, meetingId),
  });
}
