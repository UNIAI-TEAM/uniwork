-- Reverses the tenant backfill: the columns go, and chat_rooms.organization_id
-- is nullable again as it was after 052.

ALTER TABLE meeting_recordings DROP COLUMN IF EXISTS organization_id;
ALTER TABLE meeting_summaries DROP COLUMN IF EXISTS organization_id;
ALTER TABLE meeting_transcript_segments DROP COLUMN IF EXISTS organization_id;
ALTER TABLE meeting_chat_messages DROP COLUMN IF EXISTS organization_id;
ALTER TABLE meeting_audit_logs DROP COLUMN IF EXISTS organization_id;
ALTER TABLE meeting_attendance_sessions DROP COLUMN IF EXISTS organization_id;
ALTER TABLE meeting_conference_sessions DROP COLUMN IF EXISTS organization_id;
ALTER TABLE meeting_join_requests DROP COLUMN IF EXISTS organization_id;
ALTER TABLE meeting_invite_links DROP COLUMN IF EXISTS organization_id;
ALTER TABLE meeting_access_grants DROP COLUMN IF EXISTS organization_id;
ALTER TABLE meeting_invitations DROP COLUMN IF EXISTS organization_id;
ALTER TABLE meeting_participants DROP COLUMN IF EXISTS organization_id;
ALTER TABLE meeting_notes DROP COLUMN IF EXISTS organization_id;
ALTER TABLE meeting_attendees DROP COLUMN IF EXISTS organization_id;
ALTER TABLE meetings DROP COLUMN IF EXISTS organization_id;

ALTER TABLE chat_messages DROP COLUMN IF EXISTS organization_id;
ALTER TABLE chat_room_members DROP COLUMN IF EXISTS organization_id;
-- chat_rooms.organization_id predates this migration (052); only the NOT NULL
-- is undone.
ALTER TABLE chat_rooms ALTER COLUMN organization_id DROP NOT NULL;

ALTER TABLE workspace_members DROP COLUMN IF EXISTS organization_id;
