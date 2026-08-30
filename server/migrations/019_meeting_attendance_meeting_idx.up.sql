CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meeting_attendance_meeting ON meeting_attendance_sessions (meeting_id, participant_id);
