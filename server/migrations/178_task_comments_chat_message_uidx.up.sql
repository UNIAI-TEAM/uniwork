CREATE UNIQUE INDEX CONCURRENTLY uidx_task_comments_chat_message
  ON task_comments (chat_message_id) WHERE chat_message_id IS NOT NULL;
