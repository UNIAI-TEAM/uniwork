CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uidx_attendance_open_participant ON meeting_attendance_sessions (participant_id) WHERE left_at IS NULL;
