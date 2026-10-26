ALTER TABLE ai_conversations DROP COLUMN IF EXISTS title_source;
ALTER TABLE ai_messages
  DROP COLUMN IF EXISTS superseded_at,
  DROP COLUMN IF EXISTS mentions,
  DROP COLUMN IF EXISTS focus,
  DROP COLUMN IF EXISTS followups,
  DROP COLUMN IF EXISTS steps;
