DROP TABLE IF EXISTS meeting_provider_events;
DROP TABLE IF EXISTS meeting_guests;
DROP TABLE IF EXISTS outbox_events;
DROP TABLE IF EXISTS meeting_audit_logs;
DROP TABLE IF EXISTS meeting_attendance_sessions;
DROP TABLE IF EXISTS meeting_conference_sessions;
DROP TABLE IF EXISTS meeting_join_requests;
DROP TABLE IF EXISTS meeting_invite_links;
DROP TABLE IF EXISTS meeting_access_grants;
DROP TABLE IF EXISTS meeting_invitations;
DROP TABLE IF EXISTS meeting_participants;

ALTER TABLE meetings
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS meeting_type,
  DROP COLUMN IF EXISTS host_user_id,
  DROP COLUMN IF EXISTS actual_start_at,
  DROP COLUMN IF EXISTS actual_end_at,
  DROP COLUMN IF EXISTS timezone,
  DROP COLUMN IF EXISTS allow_join_request,
  DROP COLUMN IF EXISTS preferred_provider_key,
  DROP COLUMN IF EXISTS version,
  DROP COLUMN IF EXISTS updated_by,
  DROP COLUMN IF EXISTS canceled_by,
  DROP COLUMN IF EXISTS canceled_at,
  DROP COLUMN IF EXISTS cancel_reason,
  DROP COLUMN IF EXISTS project_id;
