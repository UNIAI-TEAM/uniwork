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
  created_at: z.string().optional(),
  status: z.string().optional(),
  meeting_type: z.string().optional(),
  host_user_id: z.string().optional(),
  timezone: z.string().optional(),
  allow_join_request: z.boolean().optional(),
  project_id: z.string().optional(),
  actual_start_at: z.string().optional(),
  actual_end_at: z.string().optional(),
  version: z.number().optional(),
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
  guest_id: z.string().optional(),
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

export const InvitationSchema = z.object({
  id: z.string(),
  meeting_id: z.string(),
  participant_id: z.string(),
  response_status: z.string(),
});
export type MeetingInvitation = z.infer<typeof InvitationSchema>;

export const InviteLinkSchema = z.object({
  id: z.string(),
  meeting_id: z.string(),
  name: z.string(),
  access_mode: z.string(),
  expires_at: z.string(),
  max_uses: z.number().optional(),
  used_count: z.number(),
  revoked_at: z.string().optional(),
  created_at: z.string().optional(),
  secret: z.string().optional(),
});
export type MeetingInviteLink = z.infer<typeof InviteLinkSchema>;

export const MeetingStatisticsSchema = z.object({
  total: z.number(),
  scheduled: z.number(),
  in_progress: z.number(),
  ended: z.number(),
  canceled: z.number(),
  instant: z.number().optional(),
  invitation_pending: z.number().optional(),
  invitation_accepted: z.number().optional(),
  invitation_declined: z.number().optional(),
  invitation_tentative: z.number().optional(),
  join_request_total: z.number().optional(),
  join_request_approved: z.number().optional(),
  join_request_rejected: z.number().optional(),
  avg_approval_seconds: z.number().optional(),
  invite_links_created: z.number().optional(),
  invite_links_used: z.number().optional(),
  invite_links_revoked: z.number().optional(),
  invite_links_expired: z.number().optional(),
});
export type MeetingStatistics = z.infer<typeof MeetingStatisticsSchema>;

export const ActivityItemSchema = z.object({
  id: z.string(),
  event_type: z.string(),
  actor_id: z.string(),
  from_state: z.string().optional(),
  to_state: z.string().optional(),
  occurred_at: z.string(),
});
export type MeetingActivityItem = z.infer<typeof ActivityItemSchema>;

export const TranscriptSegmentSchema = z.object({
  id: z.string(),
  meeting_id: z.string(),
  participant_id: z.string().optional(),
  speaker_name: z.string().optional(),
  text: z.string(),
  spoken_at: z.string(),
});
export type MeetingTranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;

export const ChatMessageSchema = z.object({
  id: z.string(),
  meeting_id: z.string(),
  participant_id: z.string().optional(),
  sender_identity: z.string().optional(),
  sender_name: z.string().optional(),
  message: z.string(),
  sent_at: z.string(),
});
export type MeetingChatMessage = z.infer<typeof ChatMessageSchema>;

export const SummaryActionItemSchema = z.object({
  title: z.string(),
  owner: z.string().optional(),
  due: z.string().optional(),
});
export type MeetingSummaryActionItem = z.infer<typeof SummaryActionItemSchema>;

export const MeetingSummarySchema = z.object({
  id: z.string(),
  meeting_id: z.string(),
  summary: z.string(),
  decisions: z.array(z.string()).optional(),
  action_items: z.array(SummaryActionItemSchema).optional(),
  model: z.string().optional(),
  created_by: z.string().optional(),
  created_at: z.string().optional(),
});
export type MeetingSummary = z.infer<typeof MeetingSummarySchema>;

export const RecordingSchema = z.object({
  id: z.string(),
  meeting_id: z.string(),
  status: z.string(),
  file_url: z.string().optional(),
  started_by: z.string().optional(),
  started_at: z.string().optional(),
  ended_at: z.string().optional(),
});
export type MeetingRecording = z.infer<typeof RecordingSchema>;

export const MeetingCapabilitiesSchema = z.object({
  ai_summary: z.boolean().optional(),
  recording: z.boolean().optional(),
});
export type MeetingCapabilities = z.infer<typeof MeetingCapabilitiesSchema>;
