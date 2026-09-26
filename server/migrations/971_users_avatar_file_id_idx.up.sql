CREATE INDEX CONCURRENTLY IF NOT EXISTS users_avatar_file_id_idx
  ON users (avatar_file_id) WHERE avatar_file_id IS NOT NULL;
