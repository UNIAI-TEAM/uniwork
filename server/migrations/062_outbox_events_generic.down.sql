ALTER TABLE outbox_events
  DROP COLUMN IF EXISTS dead_at,
  DROP COLUMN IF EXISTS done_at,
  DROP COLUMN IF EXISTS actor_id,
  DROP COLUMN IF EXISTS actor_kind,
  DROP COLUMN IF EXISTS correlation_id,
  DROP COLUMN IF EXISTS event_version,
  DROP COLUMN IF EXISTS organization_id;

UPDATE outbox_events SET workspace_id = '' WHERE workspace_id IS NULL;

ALTER TABLE outbox_events ALTER COLUMN workspace_id SET NOT NULL;
