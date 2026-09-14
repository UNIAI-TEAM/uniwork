CREATE UNIQUE INDEX CONCURRENTLY uidx_chat_messages_mirrored_from
  ON chat_messages (mirrored_from_comment_id) WHERE mirrored_from_comment_id IS NOT NULL;
