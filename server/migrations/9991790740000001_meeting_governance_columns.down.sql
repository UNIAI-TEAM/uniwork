ALTER TABLE meetings
  DROP COLUMN IF EXISTS attendance_finalized_by,
  DROP COLUMN IF EXISTS attendance_finalized_at,
  DROP COLUMN IF EXISTS quorum_percent;
ALTER TABLE meeting_participants
  DROP COLUMN IF EXISTS is_secretary,
  DROP COLUMN IF EXISTS standing;
