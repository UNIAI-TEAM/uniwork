import { activityLabelKey } from "@uniwork/core/meetings";
import type { MeetingActivityItem } from "@uniwork/core/types/meeting";

/**
 * Bookkeeping the server writes for itself: the provider room drifting idle and
 * the conference session opening/closing alongside start/end. None of it is
 * something a person did or needs to read.
 */
const HIDDEN_EVENTS = new Set(["PROVIDER_ROOM_IDLE_DESYNC", "CONFERENCE_SESSION_CREATED", "CONFERENCE_SESSION_ENDED"]);

export function visibleActivity(items: MeetingActivityItem[]): MeetingActivityItem[] {
  return items.filter((item) => !HIDDEN_EVENTS.has(item.event_type));
}

const MEETING_STATES = new Set(["SCHEDULED", "IN_PROGRESS", "ENDED", "CANCELED"]);
const RSVP_STATES = new Set(["PENDING", "ACCEPTED", "DECLINED", "TENTATIVE"]);

/**
 * The before → after pair worth printing, as i18n keys. Only meeting states
 * (on MEETING_* events) and RSVP answers qualify; ids, provider states and
 * no-op changes return null.
 */
export function activityStateChange(item: MeetingActivityItem): { fromKey: string; toKey: string } | null {
  const from = item.from_state;
  const to = item.to_state;
  if (!from || !to || from === to) return null;
  if (item.event_type.startsWith("MEETING_") && MEETING_STATES.has(from) && MEETING_STATES.has(to)) {
    return { fromKey: `meetings.status_${from}`, toKey: `meetings.status_${to}` };
  }
  if (item.event_type === "INVITATION_RESPONDED" && RSVP_STATES.has(from) && RSVP_STATES.has(to)) {
    return { fromKey: `meetings.rsvp_${from}`, toKey: `meetings.rsvp_${to}` };
  }
  return null;
}

export type ActivityKind =
  | "created"
  | "started"
  | "ended"
  | "canceled"
  | "updated"
  | "host"
  | "invited"
  | "removed"
  | "rsvp"
  | "join"
  | "link"
  | "ai"
  | "recording"
  | "other";

const KIND: Record<string, ActivityKind> = {
  MEETING_CREATED: "created",
  MEETING_STARTED: "started",
  MEETING_ENDED: "ended",
  MEETING_CANCELED: "canceled",
  MEETING_UPDATED: "updated",
  HOST_TRANSFERRED: "host",
  PARTICIPANT_INVITED: "invited",
  PARTICIPANT_REMOVED: "removed",
  INVITATION_RESPONDED: "rsvp",
  JOIN_REQUESTED: "join",
  JOIN_REQUEST_APPROVED: "join",
  JOIN_REQUEST_REJECTED: "join",
  JOIN_REQUEST_CANCELED: "join",
  INVITE_LINK_CREATED: "link",
  INVITE_LINK_REVOKED: "link",
  INVITE_LINK_USED: "link",
  SUMMARY_CREATED: "ai",
  TASKS_CREATED_FROM_SUMMARY: "ai",
  RECORDING_STARTED: "recording",
  RECORDING_STOPPED: "recording",
};

/** Which mark the event gets on the timeline rail. */
export function activityKind(eventType: string): ActivityKind {
  return KIND[eventType] ?? "other";
}

/** Events the shared label table in core does not name yet. */
const EXTRA_LABELS: Record<string, string> = {
  SUMMARY_CREATED: "meetings.activity_summary_created",
  TASKS_CREATED_FROM_SUMMARY: "meetings.activity_tasks_created",
  RECORDING_STARTED: "meetings.activity_recording_started",
  RECORDING_STOPPED: "meetings.activity_recording_stopped",
};

/** i18n key of the sentence that follows the actor's name. */
export function activityLabel(eventType: string): string {
  return EXTRA_LABELS[eventType] ?? activityLabelKey(eventType);
}
