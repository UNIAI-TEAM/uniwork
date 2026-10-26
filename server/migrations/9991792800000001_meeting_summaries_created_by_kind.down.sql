ALTER TABLE meeting_summaries DROP CONSTRAINT IF EXISTS meeting_summaries_created_by_kind_check;
ALTER TABLE meeting_summaries DROP COLUMN IF EXISTS created_by_kind;
