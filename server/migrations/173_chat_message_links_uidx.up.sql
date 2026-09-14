CREATE UNIQUE INDEX CONCURRENTLY uidx_chat_message_links_pair
  ON chat_message_links (message_id, target_type, target_id);
