ALTER TABLE meetings
  DROP COLUMN IF EXISTS ai_content_shared_by,
  DROP COLUMN IF EXISTS ai_content_shared_at;
