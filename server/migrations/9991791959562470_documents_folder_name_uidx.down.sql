-- Reverses 9991791959562470_documents_folder_name_uidx.up.sql (UNI-1462
-- PR 2): drops the folder-name unique index. One statement - DROP INDEX
-- CONCURRENTLY cannot run inside a transaction, so this rollback is the whole
-- file. The companion dedupe of PR 1 is not reversible on purpose; re-running
-- its up file is the recovery (see the runbook).
DROP INDEX CONCURRENTLY IF EXISTS idx_documents_folder_name_uidx;
