-- name: InsertDomainOutboxEvent :exec
-- Chỉ package internal/audit được gọi câu này (arch_test.go giữ luật);
-- InsertOutboxEvent (meeting_control.sql) là dạng cũ chỉ còn provider.* dùng.
INSERT INTO outbox_events (
  id, workspace_id, organization_id, topic, payload, status,
  event_version, correlation_id, actor_kind, actor_id, available_at
) VALUES ($1, $2, $3, $4, $5, 'PENDING', $6, $7, $8, $9, now());

-- name: MarkOutboxDoneAt :exec
UPDATE outbox_events SET
  status = 'DONE',
  completed_at = now(),
  done_at = now(),
  locked_by = NULL,
  locked_at = NULL,
  locked_until = NULL,
  updated_at = now()
WHERE id = $1;

-- name: MarkOutboxDead :exec
UPDATE outbox_events SET
  status = 'DEAD_LETTER',
  attempts = attempts + 1,
  last_error = $2,
  dead_at = now(),
  locked_by = NULL,
  locked_at = NULL,
  locked_until = NULL,
  updated_at = now()
WHERE id = $1;

-- name: CountDeadOutbox :one
SELECT count(*)::bigint AS dead FROM outbox_events WHERE dead_at IS NOT NULL;

-- name: OutboxStatsByTopic :many
SELECT topic,
  count(*) FILTER (WHERE status = 'PENDING')::bigint AS pending,
  count(*) FILTER (WHERE dead_at IS NOT NULL)::bigint AS dead,
  COALESCE(EXTRACT(EPOCH FROM (now() - min(created_at) FILTER (WHERE status = 'PENDING'))), 0)::float8 AS oldest_pending_age_seconds
FROM outbox_events
GROUP BY topic
ORDER BY topic;
