ALTER TABLE chat_messages
  ADD COLUMN thread_root_id TEXT,
  ADD COLUMN reply_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN last_reply_at TIMESTAMPTZ;
