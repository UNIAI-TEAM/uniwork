CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uidx_chat_user_nicknames_owner_target
  ON chat_user_nicknames (organization_id, owner_user_id, target_user_id);
