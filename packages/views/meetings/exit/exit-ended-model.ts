import type { MeetingActionItem } from "@uniwork/core/api/endpoints/meeting-action-items";
import { buildMeetingFeed, countFeed } from "@uniwork/core/meetings/feed";
import type {
  Meeting,
  MeetingActivityItem,
  MeetingAttendance,
  MeetingRecording,
  MeetingSummary,
} from "@uniwork/core/types";

export type EndedFacts = {
  /** Who ended it: a person, the clock (past ends_at), or not known yet. */
  endedBy: { kind: "person"; userId: string } | { kind: "auto" } | null;
  endedAt: string | null;
  durationMinutes: number | null;
  /** Present and late, as the attendance roll counts them. */
  present: number | null;
  recording: { seconds: number; processing: boolean } | null;
  counts: { decision: number; task: number; question: number };
  mine: { id: string; title: string; due: string | null }[];
};

const minutesBetween = (from?: string | null, to?: string | null): number | null => {
  const a = from ? Date.parse(from) : NaN;
  const b = to ? Date.parse(to) : NaN;
  return Number.isNaN(a) || Number.isNaN(b) ? null : Math.max(0, Math.round((b - a) / 60_000));
};

/** Board D's facts, out of what the meeting already holds (no new API). */
export function endedFacts(input: {
  meeting: Meeting;
  activity: readonly MeetingActivityItem[];
  attendance: MeetingAttendance | undefined;
  recordings: readonly MeetingRecording[];
  actionItems: readonly MeetingActionItem[];
  summary: MeetingSummary | null | undefined;
  viewerId: string;
}): EndedFacts {
  const ends = input.activity
    .filter((a) => a.event_type === "MEETING_ENDED" || a.event_type === "MEETING_AUTO_ENDED")
    .sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at));
  const last = ends[0];
  const endedBy: EndedFacts["endedBy"] = !last
    ? null
    : last.event_type === "MEETING_AUTO_ENDED"
      ? { kind: "auto" }
      : { kind: "person", userId: last.actor_id };
  const endedAt = input.meeting.actual_end_at ?? last?.occurred_at ?? null;

  const rec = input.recordings.find((r) => r.status === "PROCESSING" || r.status === "COMPLETE");
  const recSeconds = rec?.started_at && rec.ended_at ? Math.round((Date.parse(rec.ended_at) - Date.parse(rec.started_at)) / 1000) : null;

  const counts = countFeed(
    buildMeetingFeed({ actionItems: input.actionItems, summary: input.summary, notes: [], transcript: [], recordings: [] }),
  );

  const mine = input.actionItems
    .filter((i) => i.status === "PENDING" || i.status === "CONVERTED")
    .filter((i) => (i.task?.assignee_id ?? i.suggested_assignee_id) === input.viewerId)
    .map((i) => ({ id: i.id, title: i.title, due: i.task?.due_date ?? i.suggested_due_date ?? null }));

  const summary = input.attendance?.summary;
  return {
    endedBy,
    endedAt,
    durationMinutes: minutesBetween(input.meeting.actual_start_at, endedAt),
    present: summary ? summary.present + summary.late : null,
    recording: rec && recSeconds !== null ? { seconds: recSeconds, processing: rec.status === "PROCESSING" } : null,
    counts: { decision: counts.decision, task: counts.task, question: counts.question },
    mine,
  };
}
