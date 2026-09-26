-- One provider operation produces at most one file: a retried egress/job
-- completion looks up the same session instead of double-writing.
CREATE UNIQUE INDEX CONCURRENTLY uidx_file_upload_sessions_provider_op
  ON file_upload_sessions (provider_operation_id)
  WHERE provider_operation_id IS NOT NULL;
