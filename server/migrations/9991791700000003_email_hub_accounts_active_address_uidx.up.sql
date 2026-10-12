CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_email_hub_accounts_active_address
  ON email_hub_accounts (organization_id, user_id, lower(email_address))
  WHERE disconnected_at IS NULL;
