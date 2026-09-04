ALTER TABLE outbox_events
  DROP COLUMN IF EXISTS updated_at,
  DROP COLUMN IF EXISTS completed_at,
  DROP COLUMN IF EXISTS locked_until,
  DROP COLUMN IF EXISTS locked_at,
  DROP COLUMN IF EXISTS locked_by;
