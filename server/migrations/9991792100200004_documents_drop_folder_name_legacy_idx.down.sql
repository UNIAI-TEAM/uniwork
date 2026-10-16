CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_folder_name_uidx
  ON documents (workspace_id, COALESCE(parent_id, ''), lower(title COLLATE "und-x-icu"))
  WHERE kind = 'folder' AND archived_at IS NULL AND owner_id IS NULL;
