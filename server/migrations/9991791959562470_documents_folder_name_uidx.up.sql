-- Folder-name unique index (E6 FD-02, UNI-1462 PR 2; appendix §3.3). One live
-- folder of one workspace holds one name under one parent; the key is the one
-- expression document_names.sql compares - lower(title COLLATE "und-x-icu")
-- over the NFC title - so "Hợp đồng" and "HỢP ĐỒNG" are one name while "Ma"
-- and "Mã" stay two. Pages and files carry no name rule (FD-D10).
--
-- PR 2 of FD-02: the service pre-check and the tree lock of PR 1 serialize
-- every naming writer, so this index is the safety net behind them, and it
-- merges only after PR 1's binary (normalizer + pre-check + the companion
-- 9991791949247558_documents_folder_name_dedupe) has run on every
-- environment - a database still holding duplicate live siblings fails the
-- build. Recovery is docs/runbooks/documents-folder-name-index.md.
CREATE UNIQUE INDEX CONCURRENTLY idx_documents_folder_name_uidx
  ON documents (workspace_id, COALESCE(parent_id, ''), lower(title COLLATE "und-x-icu"))
  WHERE kind = 'folder' AND archived_at IS NULL AND owner_id IS NULL;
