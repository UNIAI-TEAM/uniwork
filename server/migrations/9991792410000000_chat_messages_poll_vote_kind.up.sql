-- Poll vote activity rows (kind poll_vote) appear in the timeline when someone
-- votes; metadata carries poll_message_id and question. Extends the document
-- kinds list from 9991792407200000_chat_messages_document_kinds.

ALTER TABLE chat_messages DROP CONSTRAINT chat_messages_kind_check;

ALTER TABLE chat_messages
  ADD CONSTRAINT chat_messages_kind_check
  CHECK (kind IN ('text', 'system', 'voice_call_log', 'poll', 'poll_vote', 'reminder', 'note', 'voice', 'file', 'post', 'document', 'document_version'));
