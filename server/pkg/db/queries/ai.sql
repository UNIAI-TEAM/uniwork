-- AI Gateway (F-09). Every query here is named Ai*: server/internal/arch_test.go
-- lets internal/ai call only these, which is how "the LLM never touches
-- business tables" (ADR 0010) is held.

-- name: AiInsertUsageEvent :one
INSERT INTO ai_usage_events (
  id, organization_id, workspace_id, actor_id, actor_kind, capability, prompt_id,
  provider, model, status, reason_code, source_count, truncated, correlation_id
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
RETURNING *;

-- name: AiFinishUsageEvent :one
UPDATE ai_usage_events SET
  status = $2, reason_code = $3, rate_id = $4, input_tokens = $5, output_tokens = $6,
  cost_micros = $7, latency_ms = $8, tool_calls = $9, completed_at = now()
WHERE id = $1
RETURNING *;

-- name: AiGetUsageEvent :one
SELECT * FROM ai_usage_events WHERE id = $1;

-- name: AiLatestRate :one
SELECT * FROM ai_model_rates
WHERE provider = $1 AND model = $2 AND effective_at <= $3
ORDER BY effective_at DESC, id DESC
LIMIT 1;

-- name: AiInsertRate :one
INSERT INTO ai_model_rates (id, provider, model, input_micros_per_mtok, output_micros_per_mtok, effective_at)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: AiUsageByDay :many
-- One row per (day, capability, actor_kind) for a workspace or, with
-- workspace_id NULL, the whole organization. Rejected/failed rows count as
-- calls but carry no tokens. to_at NULL means "everything so far": created_at
-- is this database's clock and no row can be in the future, so an open end is
-- both correct and immune to a caller whose clock lags this server's.
SELECT
  date_trunc('day', created_at)::timestamptz AS day,
  capability,
  actor_kind,
  COALESCE(workspace_id, '')::text AS workspace_id,
  count(*)::bigint AS calls,
  sum(input_tokens)::bigint AS input_tokens,
  sum(output_tokens)::bigint AS output_tokens,
  sum(cost_micros)::bigint AS cost_micros
FROM ai_usage_events
WHERE organization_id = $1
  AND (sqlc.narg('workspace_id')::text IS NULL OR workspace_id = sqlc.narg('workspace_id')::text)
  AND created_at >= sqlc.arg('from_at')
  AND (sqlc.narg('to_at')::timestamptz IS NULL OR created_at < sqlc.narg('to_at')::timestamptz)
GROUP BY 1, 2, 3, 4
ORDER BY 1, 2, 3, 4;

-- name: AiCreateConversation :one
INSERT INTO ai_conversations (id, organization_id, workspace_id, user_id, title)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: AiGetConversation :one
SELECT * FROM ai_conversations WHERE id = $1;

-- name: AiListConversations :many
SELECT * FROM ai_conversations
WHERE workspace_id = $1 AND user_id = $2
ORDER BY updated_at DESC
LIMIT 20;

-- name: AiTouchConversation :exec
UPDATE ai_conversations SET updated_at = now(), title = CASE WHEN title = '' THEN $2 ELSE title END
WHERE id = $1;

-- name: AiDeleteConversation :exec
DELETE FROM ai_conversations WHERE id = $1;

-- name: AiDeleteMessages :exec
DELETE FROM ai_messages WHERE conversation_id = $1;

-- name: AiInsertMessage :one
INSERT INTO ai_messages (id, organization_id, conversation_id, role, content, citations, usage_event_id)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: AiListMessages :many
SELECT * FROM ai_messages WHERE conversation_id = $1 ORDER BY created_at ASC, id ASC LIMIT 200;
