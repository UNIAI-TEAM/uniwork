-- Meeting Control Plane columns and tables. No FKs (post-004 rule).
-- Indexes that need CONCURRENTLY live in later single-statement files.

ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'SCHEDULED',
  ADD COLUMN IF NOT EXISTS meeting_type TEXT NOT NULL DEFAULT 'SCHEDULED',
  ADD COLUMN IF NOT EXISTS host_user_id TEXT,
  ADD COLUMN IF NOT EXISTS actual_start_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS actual_end_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'UTC',
  ADD COLUMN IF NOT EXISTS allow_join_request BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS preferred_provider_key TEXT,
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS updated_by TEXT,
  ADD COLUMN IF NOT EXISTS canceled_by TEXT,
  ADD COLUMN IF NOT EXISTS canceled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT,
  ADD COLUMN IF NOT EXISTS project_id TEXT;

UPDATE meetings SET host_user_id = created_by WHERE host_user_id IS NULL;
UPDATE meetings SET room_name = 'uw_mtg_' || id WHERE room_name LIKE 'uniwork-%';

ALTER TABLE meetings ALTER COLUMN host_user_id SET NOT NULL;

CREATE TABLE IF NOT EXISTS meeting_participants (
  id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL,
  principal_type TEXT NOT NULL,
  user_id TEXT,
  guest_id TEXT,
  display_name_snapshot TEXT NOT NULL DEFAULT '',
  email_snapshot TEXT,
  role TEXT NOT NULL DEFAULT 'ATTENDEE',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  source_type TEXT NOT NULL DEFAULT 'CREATOR',
  source_id TEXT,
  added_by TEXT NOT NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_by TEXT,
  removed_at TIMESTAMPTZ,
  remove_reason TEXT
);

CREATE TABLE IF NOT EXISTS meeting_invitations (
  id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  response_status TEXT NOT NULL DEFAULT 'PENDING',
  invited_by TEXT NOT NULL,
  invited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ,
  delivery_status TEXT,
  last_notified_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS meeting_access_grants (
  id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  granted_by TEXT NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_by TEXT,
  revoked_at TIMESTAMPTZ,
  revoke_reason TEXT
);

CREATE TABLE IF NOT EXISTS meeting_invite_links (
  id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  secret_hash TEXT NOT NULL,
  access_mode TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  max_uses INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0,
  revoked_by TEXT,
  revoked_at TIMESTAMPTZ,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS meeting_join_requests (
  id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL,
  requester_user_id TEXT,
  requester_guest_id TEXT,
  display_name_snapshot TEXT NOT NULL DEFAULT '',
  invite_link_id TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  decision_reason TEXT,
  expires_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS meeting_conference_sessions (
  id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL,
  provider_key TEXT NOT NULL,
  provider_room_name TEXT NOT NULL,
  provider_room_sid TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  provider_sync_status TEXT NOT NULL DEFAULT 'PENDING',
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  provider_metadata TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS meeting_attendance_sessions (
  id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL,
  conference_session_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  provider_participant_identity TEXT NOT NULL,
  joined_at TIMESTAMPTZ NOT NULL,
  left_at TIMESTAMPTZ,
  leave_reason TEXT,
  provider_event_id TEXT
);

CREATE TABLE IF NOT EXISTS meeting_audit_logs (
  id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  from_state TEXT,
  to_state TEXT,
  payload TEXT NOT NULL DEFAULT '{}',
  request_id TEXT,
  ip_address TEXT,
  user_agent TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS outbox_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  topic TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'PENDING',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS meeting_guests (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS meeting_provider_events (
  id TEXT PRIMARY KEY,
  provider_key TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO meeting_participants (
  id, meeting_id, principal_type, user_id, display_name_snapshot, role, status, source_type, added_by, added_at
)
SELECT
  'legacy_' || a.meeting_id || '_' || a.user_id,
  a.meeting_id,
  'USER',
  a.user_id,
  COALESCE(u.display_name, ''),
  'ATTENDEE',
  'ACTIVE',
  'CREATOR',
  a.user_id,
  a.created_at
FROM meeting_attendees a
LEFT JOIN users u ON u.id = a.user_id
WHERE NOT EXISTS (
  SELECT 1 FROM meeting_participants p WHERE p.id = 'legacy_' || a.meeting_id || '_' || a.user_id
);

INSERT INTO meeting_access_grants (
  id, meeting_id, participant_id, source_type, status, granted_by, granted_at
)
SELECT
  'legacygrant_' || p.id,
  p.meeting_id,
  p.id,
  'CREATOR',
  'ACTIVE',
  p.added_by,
  p.added_at
FROM meeting_participants p
WHERE p.id LIKE 'legacy_%'
  AND NOT EXISTS (SELECT 1 FROM meeting_access_grants g WHERE g.id = 'legacygrant_' || p.id);
