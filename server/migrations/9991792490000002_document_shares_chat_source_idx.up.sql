-- UNI-2012 (D2a): fast lookup of live chat-origin shares when a member leaves
-- or is removed from a chat room.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_shares_chat_source
  ON document_shares (organization_id, principal_id, source_room_id)
  WHERE revoked_at IS NULL AND source_kind = 'chat';
