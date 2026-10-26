import type { MeetingActionItem } from "../api/endpoints/meeting-action-items";
import type {
  MeetingEvidenceRef,
  MeetingNote,
  MeetingRecording,
  MeetingSummary,
  MeetingTranscriptSegment,
} from "../types/meeting";

export type MeetingFeedKind = "decision" | "task" | "question" | "note" | "recording";

/** One row of the room's UNI feed. */
export interface MeetingFeedEntry {
  id: string;
  kind: MeetingFeedKind;
  /** The decision, question or task wording, or the note's body; empty for a recording. */
  text: string;
  /** RFC 3339; null sorts last. */
  at: string | null;
  /** The transcript line the entry rests on, for a jump; null when none. */
  segmentId: string | null;
  actionItem?: MeetingActionItem;
  note?: MeetingNote;
  recording?: MeetingRecording;
}

/** What a transcript line became: a decision, or a task with its owner phrase. */
export type SegmentLink = { kind: "decision" } | { kind: "task"; owner: string | null };

/** Items the feed shows, and so the only ones a transcript chip may point at: a dismissed or unknown status is neither. */
const isLiveItem = (item: MeetingActionItem): boolean => item.status === "PENDING" || item.status === "CONVERTED";

const segmentIds = (evidence: readonly MeetingEvidenceRef[]): string[] =>
  evidence.filter((ref) => ref.kind === "segment").map((ref) => ref.id);

const instant = (at: string | null): number | null => {
  if (at === null) return null;
  const ms = Date.parse(at);
  return Number.isNaN(ms) ? null : ms;
};

/**
 * Merges what the meeting already holds into one feed, newest first. Entries
 * are built in kind order (decision, task, question, note, recording) so the
 * stable sort keeps that order, then input order, among equal instants.
 */
export function buildMeetingFeed(input: {
  actionItems: readonly MeetingActionItem[];
  summary: MeetingSummary | null | undefined;
  notes: readonly MeetingNote[];
  transcript: readonly MeetingTranscriptSegment[];
  recordings: readonly MeetingRecording[];
}): MeetingFeedEntry[] {
  const spokenAt = new Map(input.transcript.map((s) => [s.id, s.spoken_at]));
  const summaryAt = input.summary?.created_at ?? null;
  const fromSummary = (kind: "decision" | "question", list: MeetingSummary["decisions"]): MeetingFeedEntry[] =>
    (list ?? []).map((d, index) => {
      const segmentId = segmentIds(d.evidence)[0] ?? null;
      const at = (segmentId === null ? undefined : spokenAt.get(segmentId)) ?? summaryAt;
      return { id: `${kind}:${index}`, kind, text: d.text, at, segmentId };
    });

  const entries: MeetingFeedEntry[] = [
    ...fromSummary("decision", input.summary?.decisions),
    ...input.actionItems.filter(isLiveItem).map(
      (item): MeetingFeedEntry => ({
        id: `task:${item.id}`,
        kind: "task",
        text: item.title,
        at: item.created_at ?? null,
        segmentId: segmentIds(item.evidence)[0] ?? null,
        actionItem: item,
      }),
    ),
    ...fromSummary("question", input.summary?.open_questions),
    ...input.notes.map(
      (note): MeetingFeedEntry => ({
        id: `note:${note.id}`,
        kind: "note",
        text: note.body,
        at: note.created_at ?? null,
        segmentId: null,
        note,
      }),
    ),
    ...input.recordings
      .filter((r) => r.status === "COMPLETE")
      .map(
        (recording): MeetingFeedEntry => ({
          id: `recording:${recording.id}`,
          kind: "recording",
          text: "",
          at: recording.ended_at ?? recording.started_at ?? null,
          segmentId: null,
          recording,
        }),
      ),
  ];

  const keyed = entries.map((entry) => ({ entry, ms: instant(entry.at) }));
  keyed.sort((a, b) => {
    if (a.ms === null || b.ms === null) return a.ms === b.ms ? 0 : a.ms === null ? 1 : -1;
    return b.ms - a.ms;
  });
  return keyed.map((k) => k.entry);
}

/** How many entries of each kind, and in all: the feed's filter chips. */
export function countFeed(entries: readonly MeetingFeedEntry[]): Record<MeetingFeedKind | "all", number> {
  const counts = { all: entries.length, decision: 0, task: 0, question: 0, note: 0, recording: 0 };
  for (const entry of entries) counts[entry.kind] += 1;
  return counts;
}

/** Per transcript line, what it became: each decision and each task the feed shows resting on it, once each. */
export function transcriptLinks(input: {
  actionItems: readonly MeetingActionItem[];
  summary: MeetingSummary | null | undefined;
}): Map<string, SegmentLink[]> {
  const links = new Map<string, SegmentLink[]>();
  const add = (segmentId: string, link: SegmentLink) => {
    const list = links.get(segmentId) ?? [];
    const owner = link.kind === "task" ? link.owner : undefined;
    if (list.some((l) => l.kind === link.kind && (l.kind === "task" ? l.owner : undefined) === owner)) return;
    list.push(link);
    links.set(segmentId, list);
  };
  for (const d of input.summary?.decisions ?? []) {
    for (const id of segmentIds(d.evidence)) add(id, { kind: "decision" });
  }
  for (const item of input.actionItems) {
    if (!isLiveItem(item)) continue;
    for (const id of segmentIds(item.evidence)) add(id, { kind: "task", owner: item.owner_text || null });
  }
  return links;
}
