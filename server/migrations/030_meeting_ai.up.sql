-- D08b: transcript, AI summary, recordings. No FKs (post-004 rule).
-- Indexes live in later single-statement CONCURRENTLY files.

CREATE TABLE IF NOT EXISTS meeting_transcript_segments (
  id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL,
  participant_id TEXT,
  speaker_name TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL,
  spoken_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS meeting_summaries (
  id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  decisions TEXT NOT NULL DEFAULT '[]',
  action_items TEXT NOT NULL DEFAULT '[]',
  model TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS meeting_recordings (
  id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL,
  egress_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  file_url TEXT,
  started_by TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ
);
