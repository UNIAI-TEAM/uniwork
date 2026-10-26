"use client";
import { useOlderTranscript, useTranscript } from "@uniwork/core/meetings";
import { useTranscriptFromStart } from "@uniwork/core/meetings/transcript";
import type { MeetingTranscriptSegment } from "@uniwork/core/types/meeting";

export interface TranscriptReader {
  rows: MeetingTranscriptSegment[];
  isPending: boolean;
  isError: boolean;
  refetch: () => void;
  hasOlder: boolean;
  isLoadingOlder: boolean;
  loadOlder: () => Promise<void>;
  hasNewer: boolean;
  isLoadingNewer: boolean;
  loadNewer: () => Promise<void>;
}

/**
 * Which way the transcript card reads (UNI-1995 #9). A meeting that is over
 * reads from its start, with more at the bottom; `around` (a cited line) opens
 * on the page that holds it. A live one keeps the newest page and follows what
 * arrives, with earlier lines on demand.
 */
export function useTranscriptReader(meetingId: string, forward: boolean, around: string): TranscriptReader {
  const live = useTranscript(meetingId, !forward);
  const older = useOlderTranscript(meetingId, !forward);
  const read = useTranscriptFromStart(meetingId, around, forward);
  if (forward) {
    return {
      rows: read.rows,
      isPending: read.isPending,
      isError: read.isError,
      refetch: () => void read.refetch(),
      hasOlder: read.hasPreviousPage,
      isLoadingOlder: read.isFetchingPreviousPage,
      loadOlder: async () => void (await read.fetchPreviousPage({ throwOnError: true })),
      hasNewer: read.hasNextPage,
      isLoadingNewer: read.isFetchingNextPage,
      loadNewer: async () => void (await read.fetchNextPage({ throwOnError: true })),
    };
  }
  return {
    rows: live.data ?? [],
    isPending: live.isPending,
    isError: live.isError,
    refetch: () => void live.refetch(),
    hasOlder: older.hasOlder,
    isLoadingOlder: older.isLoadingOlder,
    loadOlder: async () => void (await older.loadOlder()),
    hasNewer: false,
    isLoadingNewer: false,
    loadNewer: async () => undefined,
  };
}
