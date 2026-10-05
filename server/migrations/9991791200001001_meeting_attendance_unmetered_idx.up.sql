-- The metering sweep reads closed, unmetered room sessions oldest first.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meeting_attendance_unmetered ON meeting_attendance_sessions (left_at) WHERE metered_at IS NULL AND left_at IS NOT NULL;
