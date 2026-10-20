-- Restore the list 181_chat_messages_post_kind left in place. Rows of the two
-- kinds this migration added must be deleted first; the down file is applied
-- only by a developer rolling a local database back.

ALTER TABLE chat_messages DROP CONSTRAINT chat_messages_kind_check;

ALTER TABLE chat_messages
  ADD CONSTRAINT chat_messages_kind_check
  CHECK (kind IN ('text', 'system', 'voice_call_log', 'poll', 'reminder', 'note', 'voice', 'file', 'post'));
