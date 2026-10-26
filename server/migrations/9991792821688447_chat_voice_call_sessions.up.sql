-- Durable voice-call signaling state (UNI-1737): survives process restart without Redis.
CREATE TABLE chat_voice_call_sessions (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  room_id         TEXT NOT NULL,
  call_id         TEXT NOT NULL,
  caller_id       TEXT NOT NULL,
  caller_name     TEXT NOT NULL DEFAULT '',
  call_kind       TEXT NOT NULL,
  room_name       TEXT NOT NULL DEFAULT '',
  video           BOOLEAN NOT NULL DEFAULT false,
  invited_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at     TIMESTAMPTZ,
  participant_ids TEXT[] NOT NULL DEFAULT '{}',
  invitee_ids     TEXT[] NOT NULL DEFAULT '{}',
  declined_ids    TEXT[] NOT NULL DEFAULT '{}'
);
