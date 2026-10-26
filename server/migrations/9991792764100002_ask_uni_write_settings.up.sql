-- Ask UNI write settings (ADR 0044): taint tracking per conversation, the
-- person's own mode, the organization's ceiling. NULL mode/ceiling = default.
ALTER TABLE ai_conversations
  ADD COLUMN IF NOT EXISTS tainted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS taint_tracked BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS ask_uni_mode TEXT CHECK (ask_uni_mode IN ('ask', 'plan', 'auto'));
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS ask_uni_write_ceiling TEXT CHECK (ask_uni_write_ceiling IN ('off', 'ask', 'plan', 'auto')),
  ADD COLUMN IF NOT EXISTS ask_uni_write_ceiling_updated_by TEXT,
  ADD COLUMN IF NOT EXISTS ask_uni_write_ceiling_updated_at TIMESTAMPTZ;
