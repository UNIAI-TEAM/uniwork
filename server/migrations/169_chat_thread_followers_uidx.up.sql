CREATE UNIQUE INDEX CONCURRENTLY uidx_chat_thread_followers
  ON chat_thread_followers (thread_root_id, user_id);
