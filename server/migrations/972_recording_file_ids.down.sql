-- Rows written by the FileService path have no file_url locator; they cannot
-- exist on the way down, so refuse the downgrade loudly instead of orphaning
-- their file references.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM meeting_recordings WHERE file_id IS NOT NULL)
     OR EXISTS (SELECT 1 FROM chat_voice_recordings WHERE file_id IS NOT NULL) THEN
    RAISE EXCEPTION 'recording rows written by FileService exist; migrate them back before 910 down';
  END IF;
END $$;

ALTER TABLE meeting_recordings
  DROP COLUMN IF EXISTS file_id;

ALTER TABLE chat_voice_recordings
  DROP COLUMN IF EXISTS file_id;
