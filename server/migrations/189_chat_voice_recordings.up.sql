-- Chat voice/video call recordings (LiveKit Egress), scoped like meeting_recordings.
-- Indexes live in later single-statement CONCURRENTLY files.

CREATE TABLE IF NOT EXISTS chat_voice_recordings (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  call_id TEXT NOT NULL,
  egress_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  file_url TEXT,
  call_log_message_id TEXT,
  started_by TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ
);
