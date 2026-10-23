-- The provider's id for one connection (LiveKit participant SID). A reconnect
-- keeps the identity but gets a new SID, so join/leave webhooks are matched to
-- the room session they belong to. NULL on rows written before this column.
ALTER TABLE meeting_attendance_sessions ADD COLUMN IF NOT EXISTS provider_participant_sid TEXT;
