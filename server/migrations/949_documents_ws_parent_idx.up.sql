-- Tree/sidebar listing (C-01 §3.1; UNI-675). §13.3: owned documents never
-- stand in the workspace tree, so the index excludes them (and archived
-- rows) up front.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_ws_parent
  ON documents (workspace_id, parent_id, position)
  WHERE archived_at IS NULL AND owner_id IS NULL;
