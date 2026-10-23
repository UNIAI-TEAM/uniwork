-- MYFOLDER-01 (UNI-1850; addendum §1): at most one My Folder row per
-- (workspace, acl_owner_id). No archived_at predicate because My Folder is
-- never archived (§3).
CREATE UNIQUE INDEX CONCURRENTLY idx_documents_my_folder_uidx
  ON documents (workspace_id, acl_owner_id)
  WHERE system_kind = 'my_folder';
