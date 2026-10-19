-- UNI-1966 CHAT-DOC-SHARE: a chat message can carry a Document (kind
-- 'document', metadata {"document_id"}) or one version of it (kind
-- 'document_version', metadata {"document_id","version_id"}). Both are
-- message kinds, not file kinds: the bytes live in the Documents tree, the
-- message holds the reference. Same shape as 181_chat_messages_post_kind.

ALTER TABLE chat_messages DROP CONSTRAINT chat_messages_kind_check;

ALTER TABLE chat_messages
  ADD CONSTRAINT chat_messages_kind_check
  CHECK (kind IN ('text', 'system', 'voice_call_log', 'poll', 'reminder', 'note', 'voice', 'file', 'post', 'document', 'document_version'));
