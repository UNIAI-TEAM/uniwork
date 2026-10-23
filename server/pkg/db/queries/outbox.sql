-- name: InsertDomainOutboxEvent :exec
-- Chỉ package internal/audit được gọi câu này (arch_test.go giữ luật);
-- InsertOutboxEvent (meeting_control.sql) là dạng cũ chỉ còn provider.* dùng.
INSERT INTO outbox_events (
  id, workspace_id, organization_id, topic, payload, status,
  event_version, correlation_id, actor_kind, actor_id, available_at
) VALUES ($1, $2, $3, $4, $5, 'PENDING', $6, $7, $8, $9, COALESCE(sqlc.narg('available_at')::timestamptz, now()));

-- name: ClaimPendingOutboxTopics :many
-- tenant: system
-- One dispatcher lane claims only its own topics, so a slow lane's backlog
-- never sits in front of another lane's rows. Same lease as ClaimPendingOutbox.
UPDATE outbox_events SET
  status = 'PROCESSING',
  locked_by = sqlc.arg('locked_by'),
  locked_at = now(),
  locked_until = now() + make_interval(secs => sqlc.arg('lease_seconds')::double precision),
  updated_at = now()
WHERE id IN (
  SELECT id FROM outbox_events
  WHERE status = 'PENDING' AND available_at <= now()
    AND topic = ANY(sqlc.arg('topics')::text[])
  ORDER BY created_at
  LIMIT sqlc.arg('limit_n')
  FOR UPDATE SKIP LOCKED
)
RETURNING *;

-- name: ClaimPendingOutboxExcept :many
-- tenant: system
-- The realtime lane claims every topic no other lane owns, so a topic nobody
-- consumes yet is still completed instead of pending forever.
UPDATE outbox_events SET
  status = 'PROCESSING',
  locked_by = sqlc.arg('locked_by'),
  locked_at = now(),
  locked_until = now() + make_interval(secs => sqlc.arg('lease_seconds')::double precision),
  updated_at = now()
WHERE id IN (
  SELECT id FROM outbox_events
  WHERE status = 'PENDING' AND available_at <= now()
    AND topic <> ALL(sqlc.arg('excluded')::text[])
  ORDER BY created_at
  LIMIT sqlc.arg('limit_n')
  FOR UPDATE SKIP LOCKED
)
RETURNING *;

-- name: MarkOutboxDoneBatch :exec
-- tenant: system
UPDATE outbox_events SET
  status = 'DONE',
  completed_at = now(),
  done_at = now(),
  locked_by = NULL,
  locked_at = NULL,
  locked_until = NULL,
  updated_at = now()
WHERE id = ANY(sqlc.arg('ids')::text[]);

-- name: MarkOutboxDead :exec
-- tenant: system
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
-- tenant: system
SELECT count(*)::bigint AS dead FROM outbox_events WHERE dead_at IS NOT NULL;

-- name: OutboxStatsByTopic :many
-- tenant: system
SELECT topic,
  count(*) FILTER (WHERE status = 'PENDING')::bigint AS pending,
  count(*) FILTER (WHERE dead_at IS NOT NULL)::bigint AS dead,
  COALESCE(EXTRACT(EPOCH FROM (now() - min(created_at) FILTER (WHERE status = 'PENDING'))), 0)::float8 AS oldest_pending_age_seconds
FROM outbox_events
GROUP BY topic
ORDER BY topic;

-- name: InsertDomainOutboxEventsBatch :exec
-- tenant: system
-- Chỉ package internal/audit được gọi câu này (arch_test.go giữ luật): the
-- multi-row form of InsertDomainOutboxEvent. rows is a JSON array with one
-- object per outbox row; an empty workspace/organization/correlation/actor is NULL.
INSERT INTO outbox_events (
  id, workspace_id, organization_id, topic, payload, status,
  event_version, correlation_id, actor_kind, actor_id, available_at
)
SELECT
  t.id, NULLIF(t.workspace_id, ''), NULLIF(t.organization_id, ''), t.topic, t.payload, 'PENDING',
  t.event_version, NULLIF(t.correlation_id, ''), NULLIF(t.actor_kind, ''), NULLIF(t.actor_id, ''), now()
FROM jsonb_to_recordset(sqlc.arg(rows)::jsonb) AS t(
  id text, workspace_id text, organization_id text, topic text, payload text,
  event_version integer, correlation_id text, actor_kind text, actor_id text
);
