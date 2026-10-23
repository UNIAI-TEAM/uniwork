-- G13 (UNI-936): ListMeetingInvitations (ordered by invited_at) and the
-- per-meeting invitation counts.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meeting_invitations_meeting ON meeting_invitations (meeting_id, invited_at);
