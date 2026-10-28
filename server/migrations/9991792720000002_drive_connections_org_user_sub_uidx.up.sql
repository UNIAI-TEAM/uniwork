CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_drive_connections_org_user_sub_uidx
  ON drive_connections (organization_id, user_id, google_sub);
