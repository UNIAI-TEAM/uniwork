CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uidx_chat_blocks_org_pair
  ON chat_blocks (organization_id, blocker_id, blocked_id);
