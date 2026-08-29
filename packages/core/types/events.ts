import { z } from "zod";

/**
 * Realtime event names the server publishes for a workspace. This is the
 * domain's narrowing of the transport-level `WSEventType` (a bare string in
 * api/ws-types.ts): the client machinery stays ignorant of the domain, and
 * this list is what the realtime sync switches over.
 *
 * Kept in step with server/internal/service (the Publish call sites).
 */
export const WS_EVENT_TYPES = [
  "task.created",
  "task.updated",
  "task.deleted",
  "comment.created",
  "meeting.created",
  "meeting.updated",
  "meeting.deleted",
  "meeting.started",
  "meeting.ended",
  "meeting.canceled",
  "participant.invited",
  "participant.removed",
  "invitation.responded",
  "join_request.created",
  "join_request.approved",
  "join_request.rejected",
  "join_request.canceled",
  "host.transferred",
  "invite_link.revoked",
  "transcript.appended",
  "summary.created",
  "recording.started",
  "recording.stopped",
  "recording.ready",
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
