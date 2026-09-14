CREATE INDEX CONCURRENTLY idx_chat_message_follow_ups_workspace_user
  ON chat_message_follow_ups (workspace_id, user_id, completed_at, due_at);
