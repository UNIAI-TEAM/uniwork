CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uidx_file_multipart_uploads_file_session
    ON file_multipart_uploads (file_upload_session_id);
