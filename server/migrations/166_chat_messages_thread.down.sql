ALTER TABLE chat_messages
  DROP COLUMN IF EXISTS last_reply_at,
  DROP COLUMN IF EXISTS reply_count,
  DROP COLUMN IF EXISTS thread_root_id;
