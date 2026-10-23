-- Ask UNI panel: tool steps, follow-ups and question context per message, a superseded marker for regenerated answers, and who set a conversation title.
ALTER TABLE ai_messages
  ADD COLUMN IF NOT EXISTS steps TEXT NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS followups TEXT NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS focus TEXT,
  ADD COLUMN IF NOT EXISTS mentions TEXT NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ;
ALTER TABLE ai_conversations
  ADD COLUMN IF NOT EXISTS title_source TEXT NOT NULL DEFAULT 'question' CHECK (title_source IN ('question', 'generated', 'user'));
