ALTER TABLE email_hub_scheduled_sends
  ADD COLUMN lease_owner TEXT,
  ADD COLUMN lease_expires_at TIMESTAMPTZ;
