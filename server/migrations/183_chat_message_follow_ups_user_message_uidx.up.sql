CREATE UNIQUE INDEX CONCURRENTLY uidx_chat_message_follow_ups_user_message
  ON chat_message_follow_ups (user_id, message_id);
