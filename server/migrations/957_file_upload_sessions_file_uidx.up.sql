-- A file belongs to at most one upload session at a time (the session tracks
-- its current attempt file through retries).
CREATE UNIQUE INDEX CONCURRENTLY uidx_file_upload_sessions_file
  ON file_upload_sessions (file_id);
