CREATE INDEX CONCURRENTLY idx_email_hub_threads_inbox
  ON email_hub_threads (account_id, folder, sent_at DESC);
