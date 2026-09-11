CREATE UNIQUE INDEX CONCURRENTLY uidx_chat_thread_task_links_thread
  ON chat_thread_task_links (thread_root_id);
