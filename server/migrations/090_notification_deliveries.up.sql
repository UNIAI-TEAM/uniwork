-- Idempotency ledger for the notification consumer: an outbox row retried
-- after a sibling consumer failed must not create a second notification.
-- The reminder job uses event_id = 'reminder:' || meeting_id for the same
-- reason (spec §4.2, §4.5).
CREATE TABLE IF NOT EXISTS notification_deliveries (
  event_id   TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id)
);
