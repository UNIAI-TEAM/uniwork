ALTER TABLE chat_messages DROP CONSTRAINT chat_messages_kind_check;

ALTER TABLE chat_messages
  ADD CONSTRAINT chat_messages_kind_check
  CHECK (kind IN ('text', 'system', 'voice_call_log', 'poll', 'reminder', 'note', 'voice'));
