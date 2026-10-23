CREATE INDEX CONCURRENTLY idx_email_hub_threads_page
  ON email_hub_threads (account_id, organization_id, sent_at DESC, id DESC);
