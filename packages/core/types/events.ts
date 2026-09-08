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
  "chat.mention.created",
  "chat.message",
  "chat.message.created",
  "chat.message.deleted",
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
  "department.archived",
  "department.created",
  "department.updated",
  "host.transferred",
  "invitation.responded",
  "invitation.revoked",
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
  "profile.updated",
  "quota.threshold",
  "recording.ready",
  "recording.started",
  "recording.stopped",
  "subscription.changed",
  "summary.created",
  "task.comment_added",
  "task.comment_updated",
  "task.comment_deleted",
  "task.comment_resolved",
  "task.comment_unresolved",
  "comment.reaction_added",
  "comment.reaction_removed",
  "task.reaction_added",
  "task.reaction_removed",
  "task.subscribed",
  "task.unsubscribed",
  "task.created",
  "task.deleted",
  "task.updated",
  "task_label.created",
  "task_label.deleted",
  "task_label.updated",
  "task_pin.created",
  "task_pin.deleted",
  "task_pin.reordered",
  "task_property.created",
  "task_property.updated",
  "task_status.created",
  "task_status.deleted",
  "task_status.updated",
  "task_view.created",
  "task_view.deleted",
  "task_view.updated",
  "task_view_preference.updated",
  "project.created",
  "project.deleted",
  "project.updated",
  "project_resource.created",
  "project_resource.deleted",
  "project_resource.updated",
  "transcript.appended",
  "workspace.created",
  "workspace.updated",
  "workspace_agent.added",
] as const;
export type WSEventType = (typeof WS_EVENT_TYPES)[number];

/**
 * Frame shape. `type` stays `z.string()` so an event this client predates is
 * ignored rather than rejected; `payload` carries ids only — chat message
 * events fetch one row from the API and patch the cache instead of refetching
 * full lists.
 */
export const WorkspaceEventSchema = z.object({
  type: z.string(),
  payload: z.record(z.string(), z.string()).optional(),
});
export type WorkspaceEvent = z.infer<typeof WorkspaceEventSchema>;
