ALTER TABLE email_hub_threads
  ADD COLUMN IF NOT EXISTS snoozed_until TIMESTAMPTZ;
