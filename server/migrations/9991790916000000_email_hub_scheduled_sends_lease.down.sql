ALTER TABLE email_hub_scheduled_sends
  DROP COLUMN IF EXISTS lease_expires_at,
  DROP COLUMN IF EXISTS lease_owner;
