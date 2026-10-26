-- AI scribe S4 (UNI-2026, spec 2026-10-20-meeting-scribe-agent-design §6.2):
-- a summary is now made by a person (Summarize) or by the system when a
-- meeting ends (SummarizeAuto). created_by gets its kind beside it (ADR 0007);
-- every existing row was made by a person.
ALTER TABLE meeting_summaries ADD COLUMN IF NOT EXISTS created_by_kind TEXT NOT NULL DEFAULT 'human';
ALTER TABLE meeting_summaries DROP CONSTRAINT IF EXISTS meeting_summaries_created_by_kind_check;
ALTER TABLE meeting_summaries ADD CONSTRAINT meeting_summaries_created_by_kind_check
  CHECK (created_by_kind IN ('human', 'agent', 'system'));
