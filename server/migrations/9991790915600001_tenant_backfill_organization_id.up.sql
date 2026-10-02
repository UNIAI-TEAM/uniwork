-- ADR 0008: the 18 business tables created before the rule take the tenant
-- of their parent row - workspace_members from its workspace; chat rooms (a
-- room written before 052 has none) from their workspace, then members and
-- messages from their room; meetings from their workspace, then the 14 meeting
-- tables from their meeting - and every one becomes NOT NULL.
--
-- One file on purpose. The runner sends a file as a single simple-protocol
-- Exec, which PostgreSQL runs as one implicit transaction: an orphan anywhere
-- (a row whose parent is gone - corruption, since none of these parents has a
-- hard-delete path) fails SET NOT NULL and leaves NOTHING applied. Split in
-- three, a failure in the last file left the first two committed: the old
-- binary's inserts then broke on NOT NULL while /readyz held the new one back,
-- and both sides were down until the data was fixed.
--
-- lock_timeout bounds the wait for each table's lock: a migration queued
-- behind a long transaction would otherwise hold every lock it already has
-- and stall reads of those tables. A timeout fails the file - nothing applied
-- - and the deploy is simply re-run.
SET LOCAL lock_timeout = '5s';

-- workspace_members
ALTER TABLE workspace_members ADD COLUMN IF NOT EXISTS organization_id TEXT;

UPDATE workspace_members m
SET organization_id = w.organization_id
FROM workspaces w
WHERE w.id = m.workspace_id
  AND m.organization_id IS NULL;

ALTER TABLE workspace_members ALTER COLUMN organization_id SET NOT NULL;

-- chat rooms, members, messages
ALTER TABLE chat_room_members ADD COLUMN IF NOT EXISTS organization_id TEXT;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS organization_id TEXT;

UPDATE chat_rooms r
SET organization_id = w.organization_id
FROM workspaces w
WHERE w.id = r.workspace_id
  AND r.organization_id IS NULL;

UPDATE chat_room_members c
SET organization_id = r.organization_id
FROM chat_rooms r
WHERE r.id = c.room_id
  AND c.organization_id IS NULL;

UPDATE chat_messages c
SET organization_id = r.organization_id
FROM chat_rooms r
WHERE r.id = c.room_id
  AND c.organization_id IS NULL;

ALTER TABLE chat_rooms ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE chat_room_members ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE chat_messages ALTER COLUMN organization_id SET NOT NULL;

-- meetings and the meeting tables
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS organization_id TEXT;
ALTER TABLE meeting_attendees ADD COLUMN IF NOT EXISTS organization_id TEXT;
ALTER TABLE meeting_notes ADD COLUMN IF NOT EXISTS organization_id TEXT;
ALTER TABLE meeting_participants ADD COLUMN IF NOT EXISTS organization_id TEXT;
ALTER TABLE meeting_invitations ADD COLUMN IF NOT EXISTS organization_id TEXT;
ALTER TABLE meeting_access_grants ADD COLUMN IF NOT EXISTS organization_id TEXT;
ALTER TABLE meeting_invite_links ADD COLUMN IF NOT EXISTS organization_id TEXT;
ALTER TABLE meeting_join_requests ADD COLUMN IF NOT EXISTS organization_id TEXT;
ALTER TABLE meeting_conference_sessions ADD COLUMN IF NOT EXISTS organization_id TEXT;
ALTER TABLE meeting_attendance_sessions ADD COLUMN IF NOT EXISTS organization_id TEXT;
ALTER TABLE meeting_audit_logs ADD COLUMN IF NOT EXISTS organization_id TEXT;
ALTER TABLE meeting_chat_messages ADD COLUMN IF NOT EXISTS organization_id TEXT;
ALTER TABLE meeting_transcript_segments ADD COLUMN IF NOT EXISTS organization_id TEXT;
ALTER TABLE meeting_summaries ADD COLUMN IF NOT EXISTS organization_id TEXT;
ALTER TABLE meeting_recordings ADD COLUMN IF NOT EXISTS organization_id TEXT;

UPDATE meetings m
SET organization_id = w.organization_id
FROM workspaces w
WHERE w.id = m.workspace_id
  AND m.organization_id IS NULL;

UPDATE meeting_attendees c
SET organization_id = m.organization_id
FROM meetings m
WHERE m.id = c.meeting_id
  AND c.organization_id IS NULL;

UPDATE meeting_notes c
SET organization_id = m.organization_id
FROM meetings m
WHERE m.id = c.meeting_id
  AND c.organization_id IS NULL;

UPDATE meeting_participants c
SET organization_id = m.organization_id
FROM meetings m
WHERE m.id = c.meeting_id
  AND c.organization_id IS NULL;

UPDATE meeting_invitations c
SET organization_id = m.organization_id
FROM meetings m
WHERE m.id = c.meeting_id
  AND c.organization_id IS NULL;

UPDATE meeting_access_grants c
SET organization_id = m.organization_id
FROM meetings m
WHERE m.id = c.meeting_id
  AND c.organization_id IS NULL;

UPDATE meeting_invite_links c
SET organization_id = m.organization_id
FROM meetings m
WHERE m.id = c.meeting_id
  AND c.organization_id IS NULL;

UPDATE meeting_join_requests c
SET organization_id = m.organization_id
FROM meetings m
WHERE m.id = c.meeting_id
  AND c.organization_id IS NULL;

UPDATE meeting_conference_sessions c
SET organization_id = m.organization_id
FROM meetings m
WHERE m.id = c.meeting_id
  AND c.organization_id IS NULL;

UPDATE meeting_attendance_sessions c
SET organization_id = m.organization_id
FROM meetings m
WHERE m.id = c.meeting_id
  AND c.organization_id IS NULL;

UPDATE meeting_audit_logs c
SET organization_id = m.organization_id
FROM meetings m
WHERE m.id = c.meeting_id
  AND c.organization_id IS NULL;

UPDATE meeting_chat_messages c
SET organization_id = m.organization_id
FROM meetings m
WHERE m.id = c.meeting_id
  AND c.organization_id IS NULL;

UPDATE meeting_transcript_segments c
SET organization_id = m.organization_id
FROM meetings m
WHERE m.id = c.meeting_id
  AND c.organization_id IS NULL;

UPDATE meeting_summaries c
SET organization_id = m.organization_id
FROM meetings m
WHERE m.id = c.meeting_id
  AND c.organization_id IS NULL;

UPDATE meeting_recordings c
SET organization_id = m.organization_id
FROM meetings m
WHERE m.id = c.meeting_id
  AND c.organization_id IS NULL;

ALTER TABLE meetings ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE meeting_attendees ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE meeting_notes ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE meeting_participants ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE meeting_invitations ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE meeting_access_grants ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE meeting_invite_links ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE meeting_join_requests ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE meeting_conference_sessions ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE meeting_attendance_sessions ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE meeting_audit_logs ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE meeting_chat_messages ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE meeting_transcript_segments ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE meeting_summaries ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE meeting_recordings ALTER COLUMN organization_id SET NOT NULL;
