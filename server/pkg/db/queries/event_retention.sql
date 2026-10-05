-- Event retention (G12, UNI-936): bounded deletes of queue rows nobody reads
-- again. Each statement deletes at most limit_n rows, oldest first, picked
-- through an index; SKIP LOCKED lets two replicas sweep side by side without
-- waiting on each other, and the outer WHERE re-checks the status so a dead
-- letter replayed between pick and delete survives. Only EventRetention
-- (internal/service/event_retention.go) calls these. audit_events is never
-- touched: it is append-only (ADR 0012).

-- name: DeleteDoneOutboxEvents :execrows
-- tenant: system
-- Delivered rows whose last attempt and last write are both older than
-- before. idx_outbox_events_pending (status, available_at) is the range.
DELETE FROM outbox_events
WHERE id = ANY(ARRAY(
  SELECT o.id FROM outbox_events o
  WHERE o.status = 'DONE'
    AND o.available_at < sqlc.arg('before')::timestamptz
    AND o.updated_at < sqlc.arg('before')::timestamptz
  ORDER BY o.available_at
  LIMIT sqlc.arg('limit_n')
  FOR UPDATE SKIP LOCKED
))
  AND status = 'DONE';

-- name: DeleteDeadOutboxEvents :execrows
-- tenant: system
-- Dead letters parked (and not replayed) for longer than the dead-letter
-- window. Same index as DeleteDoneOutboxEvents.
DELETE FROM outbox_events
WHERE id = ANY(ARRAY(
  SELECT o.id FROM outbox_events o
  WHERE o.status = 'DEAD_LETTER'
    AND o.available_at < sqlc.arg('before')::timestamptz
    AND COALESCE(o.dead_at, o.updated_at) < sqlc.arg('before')::timestamptz
  ORDER BY o.available_at
  LIMIT sqlc.arg('limit_n')
  FOR UPDATE SKIP LOCKED
))
  AND status = 'DEAD_LETTER';

-- name: DeleteExpiredWebhookInbox :execrows
-- Processed (DONE) and abandoned (DEAD_LETTER) callbacks, each past its own
-- window. Ids are ULIDs minted at receipt, so id < before_id (the smallest
-- ULID of the later cutoff) walks the primary key from the oldest row; the
-- received_at bounds decide.
DELETE FROM webhook_inbox
WHERE id = ANY(ARRAY(
  SELECT w.id FROM webhook_inbox w
  WHERE w.id < sqlc.arg('before_id')::text
    AND ((w.status = 'DONE' AND w.received_at < sqlc.arg('done_before')::timestamptz)
      OR (w.status = 'DEAD_LETTER' AND w.received_at < sqlc.arg('dead_before')::timestamptz))
  ORDER BY w.id
  LIMIT sqlc.arg('limit_n')
  FOR UPDATE SKIP LOCKED
))
  AND status IN ('DONE', 'DEAD_LETTER');

-- name: DeleteExpiredProviderEvents :execrows
-- The provider-event dedupe ledger older than before. Provider retries land
-- within minutes; a row this old dedupes nothing. A recording_ended that did
-- arrive again would finish the recording idempotently either way.
DELETE FROM meeting_provider_events
WHERE id = ANY(ARRAY(
  SELECT e.id FROM meeting_provider_events e
  WHERE e.id < sqlc.arg('before_id')::text
    AND e.received_at < sqlc.arg('before')::timestamptz
  ORDER BY e.id
  LIMIT sqlc.arg('limit_n')
  FOR UPDATE SKIP LOCKED
));
