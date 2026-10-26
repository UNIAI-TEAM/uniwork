ALTER TABLE push_subscriptions
  DROP COLUMN apns_bundle_id,
  DROP COLUMN apns_environment,
  DROP COLUMN transport;
