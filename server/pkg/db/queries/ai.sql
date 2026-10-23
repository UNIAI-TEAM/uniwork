-- AI Gateway (F-09). Every query here is named Ai*: server/internal/arch_test.go
-- lets internal/ai call only these, which is how "the LLM never touches
-- business tables" (ADR 0010) is held.

-- name: AiInsertUsageEvent :one
INSERT INTO ai_usage_events (
  id, organization_id, workspace_id, actor_id, actor_kind, capability, prompt_id,
  provider, model, status, reason_code, source_count, truncated, correlation_id, run_id
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
RETURNING *;

-- name: AiFinishUsageEvent :one
-- tenant: by-id
UPDATE ai_usage_events SET
  status = $2, reason_code = $3, rate_id = $4, input_tokens = $5, output_tokens = $6,
  cost_micros = $7, latency_ms = $8, tool_calls = $9, completed_at = now(),
  cache_read_tokens = $10, cache_write_tokens = $11
WHERE id = $1
RETURNING *;

-- name: AiSumRunUsage :one
-- What one Ask UNI run spent, across every call that carried its run id.
SELECT COUNT(*)::bigint AS calls,
  COALESCE(SUM(input_tokens), 0)::bigint AS input_tokens,
  COALESCE(SUM(output_tokens), 0)::bigint AS output_tokens,
  COALESCE(SUM(cache_read_tokens), 0)::bigint AS cache_read_tokens,
  COALESCE(SUM(cache_write_tokens), 0)::bigint AS cache_write_tokens,
  COALESCE(SUM(cost_micros), 0)::bigint AS cost_micros
FROM ai_usage_events
WHERE organization_id = $1 AND run_id = sqlc.arg(run_id)::text;

-- name: AiGetUsageEvent :one
-- tenant: by-id
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
-- tenant: by-id
SELECT * FROM ai_conversations WHERE id = $1;

-- name: AiListConversations :many
SELECT * FROM ai_conversations
WHERE workspace_id = $1 AND user_id = $2
ORDER BY updated_at DESC
LIMIT 20;

-- name: AiSearchConversations :many
-- search_pattern is a folded ILIKE pattern the service escapes.
SELECT * FROM ai_conversations
WHERE workspace_id = sqlc.arg(workspace_id) AND user_id = sqlc.arg(user_id)
  AND uw_fold_search(title) ILIKE sqlc.arg(search_pattern)::text ESCAPE '\'
ORDER BY updated_at DESC
LIMIT 50;

-- name: AiSetGeneratedTitle :execrows
-- tenant: by-id
-- Only a title still taken from the question may be replaced; a user's rename wins.
UPDATE ai_conversations SET title = $2, title_source = 'generated'
WHERE id = $1 AND title_source = 'question';

-- name: AiSupersedeMessage :execrows
-- tenant: parent conversation_id
-- Only a live message with no later live one: of two regenerates racing for
-- the same answer, one changes a row and the other changes none.
UPDATE ai_messages m SET superseded_at = now()
WHERE m.id = $1 AND m.conversation_id = $2 AND m.superseded_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM ai_messages n
    WHERE n.conversation_id = m.conversation_id AND n.superseded_at IS NULL AND n.id <> m.id
      AND (n.created_at, n.id) > (m.created_at, m.id));

-- name: AiTouchConversation :exec
-- tenant: by-id
UPDATE ai_conversations SET updated_at = now(), title = CASE WHEN title = '' THEN $2 ELSE title END
WHERE id = $1;

-- name: AiDeleteConversation :exec
-- tenant: by-id
DELETE FROM ai_conversations WHERE id = $1;

-- name: AiDeleteMessages :exec
-- tenant: parent conversation_id
DELETE FROM ai_messages WHERE conversation_id = $1;

-- name: AiInsertMessage :one
INSERT INTO ai_messages (id, organization_id, conversation_id, role, content, citations, usage_event_id, notice, steps, followups, focus, mentions, model)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
RETURNING *;

-- name: AiListMessages :many
-- tenant: parent conversation_id
-- The latest 200 messages, oldest first: a long conversation keeps its end.
-- Answers a regenerate replaced (superseded_at) stay stored but are not shown.
SELECT * FROM (
  SELECT * FROM ai_messages WHERE conversation_id = $1 AND superseded_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 200
) m ORDER BY created_at ASC, id ASC;

-- name: AiListConversationCitations :many
-- Every citation set a conversation's live answers stored, oldest first and
-- with no limit: the Ask UNI agent rebuilds its stable [S#] numbers from them
-- (R2). An answer a regenerate replaced is not shown, so its sources are not
-- known to the client and number anew.
SELECT citations FROM ai_messages
WHERE organization_id = $1 AND conversation_id = $2 AND role = 'assistant' AND superseded_at IS NULL
ORDER BY created_at ASC, id ASC;

-- name: AiRenameConversation :one
-- tenant: by-id
UPDATE ai_conversations SET title = $2, title_source = 'user' WHERE id = $1
RETURNING *;

-- name: AiGetMessageInConversation :one
-- tenant: parent conversation_id
SELECT * FROM ai_messages WHERE id = $1 AND conversation_id = $2;

-- name: AiUpsertMessageFeedback :exec
-- tenant: parent conversation_id
INSERT INTO ai_message_feedback (id, organization_id, workspace_id, conversation_id, message_id, rating, reason, note, created_by)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
ON CONFLICT (message_id, created_by)
DO UPDATE SET rating = EXCLUDED.rating, reason = EXCLUDED.reason, note = EXCLUDED.note, updated_at = now()
WHERE ai_message_feedback.organization_id = EXCLUDED.organization_id;

-- name: AiClearMessageFeedback :exec
DELETE FROM ai_message_feedback WHERE organization_id = $1 AND message_id = $2 AND created_by = $3;

-- name: AiDeleteConversationFeedback :exec
-- tenant: parent conversation_id
DELETE FROM ai_message_feedback WHERE conversation_id = $1;
