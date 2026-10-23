-- FileService reference lookups (files.id = recording.file_id) — one index
-- per table, only where the reference exists. Placeholder number.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meeting_recordings_file_id
  ON meeting_recordings (file_id)
  WHERE file_id IS NOT NULL;
