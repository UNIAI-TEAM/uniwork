-- follow-4: a meeting scheduled as the next one of another joins its series.
-- series_id is the first meeting's id (ULID), NULL for a meeting nobody
-- followed up; carry-over chains along it as well as the project.
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS series_id TEXT;
