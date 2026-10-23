-- FileService reference lookup (files.id = chat_voice_recordings.file_id).
-- Placeholder number.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_voice_recordings_file_id
  ON chat_voice_recordings (file_id)
  WHERE file_id IS NOT NULL;
