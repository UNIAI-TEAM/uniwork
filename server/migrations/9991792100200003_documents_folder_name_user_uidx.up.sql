-- MYFOLDER-01 (UNI-1850; addendum §1): replaces idx_documents_folder_name_uidx
-- with the same key expression plus `AND system_kind IS NULL`, so each
-- member's root My Folder (title = 'My Folder', system_kind = 'my_folder')
-- does not collide with another member's My Folder or with a user-created root
-- folder named "My Folder". Built CONCURRENTLY before the old index is dropped
-- in the companion migration.
CREATE UNIQUE INDEX CONCURRENTLY idx_documents_folder_name_user_uidx
  ON documents (workspace_id, COALESCE(parent_id, ''), lower(title COLLATE "und-x-icu"))
  WHERE kind = 'folder' AND archived_at IS NULL AND owner_id IS NULL AND system_kind IS NULL;
