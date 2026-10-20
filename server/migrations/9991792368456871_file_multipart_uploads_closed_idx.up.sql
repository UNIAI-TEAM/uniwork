-- RETENTION-02 (UNI-1921): the closed-session sweep deletes rows by closed_at.
-- idx_file_multipart_uploads_expires is partial on open/validating, so it does
-- not cover a closed row. CONCURRENTLY, alone in this file (Database and
-- Migration Rules: an index never shares a migration).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_file_multipart_uploads_closed
    ON file_multipart_uploads (closed_at)
    WHERE closed_at IS NOT NULL;
