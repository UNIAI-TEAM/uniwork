-- Restore the list 9991792407200000_chat_messages_document_kinds left in place.

ALTER TABLE chat_messages DROP CONSTRAINT chat_messages_kind_check;

ALTER TABLE chat_messages
  ADD CONSTRAINT chat_messages_kind_check
  CHECK (kind IN ('text', 'system', 'voice_call_log', 'poll', 'reminder', 'note', 'voice', 'file', 'post', 'document', 'document_version'));
