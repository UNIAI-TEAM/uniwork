"use client";
import { useContext, useMemo } from "react";
import { useNotes } from "@uniwork/core/meetings";
import { useMeetingEvidence } from "@uniwork/core/meetings/summary";
import { useFullTranscript } from "@uniwork/core/meetings/transcript";
import type { MeetingEvidenceRef } from "@uniwork/core/types/meeting";
import { DetailContext } from "../detail-context";

type Stamped = { id: string; at?: string | null };

/**
 * When each cited line happened, keyed "kind:id": transcript segments by
 * `spoken_at`, notes by `created_at` (PLAN D7: the client knows both, so no
 * evidence read is needed for the time chips).
 */
export function evidenceAtIndex(
  segments: readonly { id: string; spoken_at?: string | null }[],
  notes: readonly { id: string; created_at?: string | null }[],
): Map<string, string> {
  const index = new Map<string, string>();
  const put = (kind: string, rows: readonly Stamped[]) => {
    for (const row of rows) if (row.at) index.set(`${kind}:${row.id}`, row.at);
  };
  put("segment", segments.map((s) => ({ id: s.id, at: s.spoken_at })));
  put("note", notes.map((n) => ({ id: n.id, at: n.created_at })));
  return index;
}

/** The time of the first ref (what the chip shows); undefined when the index does not know it. */
export function firstRefAt(refs: readonly MeetingEvidenceRef[], index: ReadonlyMap<string, string>): string | undefined {
  const first = refs[0];
  return first ? index.get(`${first.kind}:${first.id}`) : undefined;
}

/**
 * The wall-clock moment an AI claim rests on: its first ref's time, from the
 * full transcript and the notes the page already reads. A ref of another kind
 * (a chat line) or one the reads miss asks the evidence endpoint for that one
 * ref once both reads have answered.
 * shortcut: one evidence read per unresolved chip, not a batch of 20; refs
 * outside the transcript and notes are rare — batch them if that changes.
 */
export function useEvidenceAt(
  meetingId: string,
  refs: readonly MeetingEvidenceRef[],
): { at: string | undefined; settled: boolean } {
  const detail = useContext(DetailContext);
  // Outsiders read no AI content: the transcript and the evidence would both be refused.
  const enabled = refs.length > 0 && (detail ? detail.aiReadable && detail.viewer !== "outsider" : true);
  const transcript = useFullTranscript(meetingId, enabled);
  const notes = useNotes(meetingId);
  const index = useMemo(() => evidenceAtIndex(transcript.data ?? [], notes.data ?? []), [transcript.data, notes.data]);
  const known = firstRefAt(refs, index);
  const readsDone = !transcript.isPending && !notes.isPending;
  const first = refs.slice(0, 1);
  const fallback = useMeetingEvidence(meetingId, first, enabled && readsDone && known === undefined);
  const fetched = fallback.data?.[0]?.at ?? undefined;
  return {
    at: known ?? fetched,
    settled: !enabled || known !== undefined || (readsDone && !fallback.isPending) || fallback.isError,
  };
}
