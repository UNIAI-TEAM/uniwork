ALTER TABLE organizations
  DROP COLUMN IF EXISTS ask_uni_write_ceiling,
  DROP COLUMN IF EXISTS ask_uni_write_ceiling_updated_by,
  DROP COLUMN IF EXISTS ask_uni_write_ceiling_updated_at;
ALTER TABLE users DROP COLUMN IF EXISTS ask_uni_mode;
ALTER TABLE ai_conversations
  DROP COLUMN IF EXISTS tainted_at,
  DROP COLUMN IF EXISTS taint_tracked;
