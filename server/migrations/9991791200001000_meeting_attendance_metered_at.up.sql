-- When a closed room session's minutes reached meeting.participant_minutes.
-- Closing a session no longer meters it inline; a worker sweep meters closed
-- sessions with metered_at NULL in batches, so the close path (End, a leave
-- webhook) stays O(1) and a dropped request cannot lose minutes. The usage
-- event keeps its idempotency key (attendance:<session id>), so a session the
-- old inline path metered is never counted twice.
ALTER TABLE meeting_attendance_sessions ADD COLUMN IF NOT EXISTS metered_at TIMESTAMPTZ;

-- Sessions closed before this column existed were metered (or deliberately
-- not metered) inline at close; the sweep must not bill their minutes into
-- the current period.
UPDATE meeting_attendance_sessions SET metered_at = left_at
WHERE left_at IS NOT NULL AND metered_at IS NULL;
