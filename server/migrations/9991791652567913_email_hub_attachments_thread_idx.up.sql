CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_email_hub_attachments_thread
  ON email_hub_attachments (thread_id);
