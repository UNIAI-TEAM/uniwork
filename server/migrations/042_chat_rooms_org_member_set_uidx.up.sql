CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uidx_chat_rooms_org_member_set
  ON chat_rooms (organization_id, kind, member_set_key)
  WHERE kind IN ('group', 'dm') AND member_set_key IS NOT NULL AND organization_id IS NOT NULL;
