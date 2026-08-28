import { z } from "zod";

export const MeetingSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  title: z.string(),
  description: z.string(),
  starts_at: z.string(),
  ends_at: z.string(),
  room_name: z.string(),
  created_by: z.string(),
  status: z.string().optional(),
  meeting_type: z.string().optional(),
  host_user_id: z.string().optional(),
  timezone: z.string().optional(),
  allow_join_request: z.boolean().optional(),
  project_id: z.string().optional(),
  actual_start_at: z.string().optional(),
  actual_end_at: z.string().optional(),
});
export type Meeting = z.infer<typeof MeetingSchema>;

export const MeetingNoteSchema = z.object({
  id: z.string(),
  meeting_id: z.string(),
  author_id: z.string(),
  body: z.string(),
  display_name: z.string().optional(),
});
export type MeetingNote = z.infer<typeof MeetingNoteSchema>;

export const JoinDecisionSchema = z.object({
  decision: z.string(),
  reason: z.string().optional(),
  meeting_status: z.string().optional(),
  conference_session_id: z.string().optional(),
  provider: z.string().optional(),
  server_url: z.string().optional(),
  participant_token: z.string().optional(),
  expires_at: z.string().optional(),
  join_request_id: z.string().optional(),
});
export type JoinDecision = z.infer<typeof JoinDecisionSchema>;

export const ParticipantSchema = z.object({
  id: z.string(),
  meeting_id: z.string(),
  principal_type: z.string(),
  user_id: z.string().optional(),
  display_name_snapshot: z.string().optional(),
  role: z.string(),
  status: z.string(),
});
export type MeetingParticipant = z.infer<typeof ParticipantSchema>;

export const JoinRequestSchema = z.object({
  id: z.string(),
  meeting_id: z.string(),
  requester_user_id: z.string().optional(),
  display_name_snapshot: z.string().optional(),
  status: z.string(),
});
export type MeetingJoinRequest = z.infer<typeof JoinRequestSchema>;
