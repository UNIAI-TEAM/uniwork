ALTER TABLE users
  DROP COLUMN IF EXISTS avatar_file_id;

ALTER TABLE attachments
  DROP CONSTRAINT IF EXISTS attachments_purpose_check,
  DROP COLUMN IF EXISTS purpose,
  DROP COLUMN IF EXISTS file_id;

-- Rows written by the FileService path have no object_key; they cannot exist
-- on the way down, so refuse the downgrade loudly instead of writing junk.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM attachments WHERE object_key IS NULL) THEN
    RAISE EXCEPTION 'attachments rows written by FileService exist; migrate them back before 900 down';
  END IF;
END $$;

ALTER TABLE attachments
  ALTER COLUMN object_key SET NOT NULL;
