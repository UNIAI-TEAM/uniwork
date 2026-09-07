import { z } from "zod";

/**
 * Every realtime event the server can deliver to this client, in the order the
 * catalogue lists them.
 *
 * This is one of three copies of the same contract: `docs/events/CATALOGUE.md`
 * for people, `server/internal/outbox/catalogue.go` for the server, and this
 * list for the client. `scripts/events-catalogue.test.mjs` fails when they stop
 * agreeing — a client that silently predates an event it should be reacting to
 * is a bug nobody notices until a screen is stale.
 *
 * Events with no realtime audience (`provider.*`, `webhook.deliver`) are in the
 * catalogue but not here: nothing on the client listens for them.
 */
export const WS_EVENT_TYPES = [
  "ai.usage.updated",
  "audit.exported",
  "chat.message",
  "chat.message.created",
  "chat.message.updated",
  "chat.room.activity",
  "chat.room.created",
  "chat.room.member_added",
  "chat.room.member_removed",
  "chat.room.updated",
  "chat.typing",
  "chat.voice.accept",
  "chat.voice.hangup",
  "chat.voice.invite",
  "conference.session_ready",
  "host.transferred",
  "invitation.responded",
  "invite_link.revoked",
  "join_request.approved",
  "join_request.canceled",
  "join_request.created",
  "join_request.rejected",
  "meeting.canceled",
  "meeting.created",
  "meeting.deleted",
  "meeting.ended",
  "meeting.started",
  "meeting.updated",
  "member.deactivated",
  "member.invited",
  "member.joined",
  "member.left",
  "member.reactivated",
  "member.removed",
  "member.role_changed",
  "notification.created",
  "organization.created",
  "organization.ownership_transferred",
  "organization.suspended",
  "organization.unsuspended",
  "organization.updated",
  "participant.invited",
  "participant.removed",
  "quota.threshold",
  "recording.ready",
  "recording.started",
  "recording.stopped",
  "subscription.changed",
  "summary.created",
  "task.comment_added",
  "task.created",
  "task.deleted",
  "task.updated",
  "transcript.appended",
  "workspace.created",
  "workspace.updated",
  "workspace_agent.added",
] as const;
export type WSEventType = (typeof WS_EVENT_TYPES)[number];

/**
 * Frame shape. `type` stays `z.string()` so an event this client predates is
 * ignored rather than rejected; `payload` carries ids only — the cache is
 * refreshed from the API, never patched from the socket.
 */
export const WorkspaceEventSchema = z.object({
  type: z.string(),
  payload: z.record(z.string(), z.string()).optional(),
});
export type WorkspaceEvent = z.infer<typeof WorkspaceEventSchema>;
