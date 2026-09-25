CREATE INDEX CONCURRENTLY IF NOT EXISTS email_hub_threads_account_conversation_sent_idx
  ON email_hub_threads (account_id, organization_id, conversation_key, sent_at);
