-- G13 (UNI-936): ListMeetingNotes (ordered by created_at); also serves the
-- legacy ON DELETE CASCADE from meetings.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meeting_notes_meeting ON meeting_notes (meeting_id, created_at);
