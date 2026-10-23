-- G13 (UNI-936): the reminder worker's ListMeetingsDueReminder scans
-- SCHEDULED meetings across tenants every minute by starts_at window.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meetings_scheduled_starts ON meetings (starts_at) WHERE status = 'SCHEDULED';
