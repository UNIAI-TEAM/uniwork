-- G13 (UNI-936): auto-end's ListOverdueInProgressMeetings (ends_at < now) and
-- ListInProgressMeetingsWithIdleSession scan IN_PROGRESS meetings across
-- tenants every minute.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meetings_in_progress_ends ON meetings (ends_at) WHERE status = 'IN_PROGRESS';
