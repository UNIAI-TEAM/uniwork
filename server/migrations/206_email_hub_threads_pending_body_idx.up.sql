CREATE INDEX CONCURRENTLY idx_email_hub_threads_pending_body
  ON email_hub_threads (account_id, organization_id, folder, sent_at DESC)
  WHERE NOT body_cached;
