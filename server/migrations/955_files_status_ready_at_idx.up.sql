-- GC scan shape: ready rows ordered by the file-age anchor.
CREATE INDEX CONCURRENTLY idx_files_status_ready_at ON files (status, ready_at);
