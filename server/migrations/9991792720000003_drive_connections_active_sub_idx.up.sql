CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_drive_connections_active_sub_idx
  ON drive_connections (google_sub)
  WHERE disconnected_at IS NULL;
