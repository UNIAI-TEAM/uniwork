import type { JoinDecision, MeetingInviteLink } from "../types/meeting";

export function isJoinAdmitted(decision: JoinDecision | null | undefined): boolean {
  return (
    decision?.decision === "ADMIT" &&
    Boolean(decision.participant_token) &&
    Boolean(decision.server_url)
  );
}

export type InviteLinkUiStatus = "active" | "expired" | "revoked" | "limit_reached";

export function inviteLinkStatus(link: MeetingInviteLink, now: Date): InviteLinkUiStatus {
  if (link.revoked_at) return "revoked";
  if (link.max_uses !== undefined && link.used_count >= link.max_uses) return "limit_reached";
  if (link.expires_at && new Date(link.expires_at) <= now) return "expired";
  return "active";
}

const ACTIVITY_KEYS: Record<string, string> = {
  MEETING_CREATED: "meetings.activity_created",
  MEETING_STARTED: "meetings.activity_started",
  MEETING_ENDED: "meetings.activity_ended",
  MEETING_CANCELED: "meetings.activity_canceled",
  MEETING_UPDATED: "meetings.activity_updated",
  HOST_TRANSFERRED: "meetings.activity_host_transferred",
  PARTICIPANT_INVITED: "meetings.activity_invited",
  PARTICIPANT_REMOVED: "meetings.activity_removed",
  INVITATION_RESPONDED: "meetings.activity_rsvp",
  JOIN_REQUESTED: "meetings.activity_join_requested",
  JOIN_REQUEST_APPROVED: "meetings.activity_join_approved",
  JOIN_REQUEST_REJECTED: "meetings.activity_join_rejected",
  JOIN_REQUEST_CANCELED: "meetings.activity_join_canceled",
  INVITE_LINK_CREATED: "meetings.activity_link_created",
  INVITE_LINK_REVOKED: "meetings.activity_link_revoked",
  INVITE_LINK_USED: "meetings.activity_link_used",
  CONFERENCE_SESSION_CREATED: "meetings.activity_session_created",
  CONFERENCE_SESSION_ENDED: "meetings.activity_session_ended",
};

export function activityLabelKey(eventType: string): string {
  return ACTIVITY_KEYS[eventType] ?? "meetings.activity_generic";
}
