CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meeting_chat_meeting ON meeting_chat_messages (meeting_id, sent_at);
