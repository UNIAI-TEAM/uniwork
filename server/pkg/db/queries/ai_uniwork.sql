-- UniWork AI conversation store (G6-03a, G6-D1 A9). Every query is named
-- AiUniwork*: server/internal/ai may call only Ai* queries (ADR 0010,
-- TestAIPackageOnlyCallsAiQueries), which is how the encrypted transcript of
-- the model stays inside the agent runtime instead of reaching a business
-- table. The implementation is ConversationStorePG in
-- server/internal/ai/conversation_store_pg.go.

-- name: AiUniworkCreateConversation :one
INSERT INTO ai_uniwork_conversations (
  id, organization_id, workspace_id, user_id, document_id, module, device_id,
  created_by, created_by_kind, created_at, last_used_at, expires_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
RETURNING *;

-- name: AiUniworkGetConversation :one
SELECT * FROM ai_uniwork_conversations
WHERE id = $1 AND organization_id = $2;

-- name: AiUniworkLatestConversation :one
-- The newest live conversation of one key (an empty conversation id means
-- "whatever this scope had open"); Resume asks for it, Create replaces it.
SELECT * FROM ai_uniwork_conversations
WHERE organization_id = sqlc.arg('organization_id')
  AND user_id = sqlc.arg('user_id')
  AND module = sqlc.arg('module')
  AND document_id IS NOT DISTINCT FROM sqlc.narg('document_id')::text
  AND device_id IS NOT DISTINCT FROM sqlc.narg('device_id')::text
  AND expires_at > sqlc.arg('now')::timestamptz
ORDER BY created_at DESC, id DESC
LIMIT 1;

-- name: AiUniworkConversationIDsByKey :many
-- Everything one key owns, live or not: Create deletes these before it
-- inserts, so a client that starts over never leaves a second transcript -
-- and it deletes exactly the rows Resume would find, device included, so a
-- device-less request never takes a device-bound transcript.
SELECT id FROM ai_uniwork_conversations
WHERE organization_id = sqlc.arg('organization_id')
  AND user_id = sqlc.arg('user_id')
  AND module = sqlc.arg('module')
  AND document_id IS NOT DISTINCT FROM sqlc.narg('document_id')::text
  AND device_id IS NOT DISTINCT FROM sqlc.narg('device_id')::text;

-- name: AiUniworkConversationIDsByDocument :many
SELECT id FROM ai_uniwork_conversations
WHERE organization_id = $1 AND document_id = $2;

-- name: AiUniworkConversationIDsByUserDocument :many
SELECT id FROM ai_uniwork_conversations
WHERE organization_id = $1 AND user_id = $2 AND document_id = $3;

-- name: AiUniworkConversationIDsByUser :many
SELECT id FROM ai_uniwork_conversations
WHERE organization_id = $1 AND user_id = $2;

-- name: AiUniworkConversationIDsByUserAllOrgs :many
-- tenant: system
-- Sign-out (session.revoked) names only the user, and their transcripts can
-- live in every organization they held one in; the cleanup consumer is a
-- maintenance job that spans tenants by design and answers no request.
SELECT id FROM ai_uniwork_conversations WHERE user_id = $1;

-- name: AiUniworkConversationIDsByOrganization :many
SELECT id FROM ai_uniwork_conversations
WHERE organization_id = $1;

-- name: AiUniworkExpiredConversationIDs :many
-- tenant: system
-- The TTL worker's batch, oldest expiry first: idle (30 min) and absolute
-- (24 h) both land in expires_at, so one clock decides.
SELECT id FROM ai_uniwork_conversations
WHERE expires_at <= sqlc.arg('now')::timestamptz
ORDER BY expires_at
LIMIT sqlc.arg('batch')::int;

-- name: AiUniworkDeleteConversationsByIDs :exec
-- tenant: by-id
-- The ids come from a scoped query in the same transaction (Create's key
-- delete, a cleanup trigger, the TTL sweep).
DELETE FROM ai_uniwork_conversations WHERE id = ANY(sqlc.arg('ids')::text[]);

-- name: AiUniworkDeleteConversation :exec
-- tenant: by-id
DELETE FROM ai_uniwork_conversations WHERE id = $1;

-- name: AiUniworkDeleteTurnsByConversations :exec
-- tenant: parent conversation_id
-- No foreign key and no cascade (ADR 0001): the caller deletes the turns of
-- the conversations it is about to remove, in the same transaction.
DELETE FROM ai_uniwork_turns WHERE conversation_id = ANY(sqlc.arg('conversation_ids')::text[]);

-- name: AiUniworkListTurns :many
-- tenant: parent conversation_id
SELECT * FROM ai_uniwork_turns WHERE conversation_id = $1 ORDER BY seq ASC;

-- name: AiUniworkNextTurnSeq :one
-- tenant: parent conversation_id
SELECT (COALESCE(MAX(seq), 0) + 1)::int AS next_seq
FROM ai_uniwork_turns WHERE conversation_id = $1;

-- name: AiUniworkInsertTurn :one
INSERT INTO ai_uniwork_turns (
  id, organization_id, conversation_id, run_id, seq, role, ciphertext, usage_event_id, created_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
RETURNING *;

-- name: AiUniworkTouchConversation :one
-- tenant: by-id
-- Append's first statement: it refreshes the live window and returns the
-- organization the new turns are stamped with.
UPDATE ai_uniwork_conversations SET
  last_used_at = sqlc.arg('now')::timestamptz,
  expires_at = LEAST(
    sqlc.arg('now')::timestamptz + make_interval(secs => sqlc.arg('idle_secs')::int),
    created_at + make_interval(secs => sqlc.arg('absolute_secs')::int))
WHERE id = sqlc.arg('conversation_id')
RETURNING organization_id;

-- name: AiUniworkTrimTurns :execrows
-- tenant: parent conversation_id
-- Keeps at most $2 user turns: everything before the oldest kept user turn
-- goes, so a block (a user turn and the assistant/tool rows answering it) is
-- never cut in half and no tool result is left without its call.
DELETE FROM ai_uniwork_turns AS d
WHERE d.conversation_id = $1
  AND d.seq < COALESCE((
    SELECT u.seq FROM ai_uniwork_turns u
    WHERE u.conversation_id = $1 AND u.role = 'user'
    ORDER BY u.seq DESC
    OFFSET (sqlc.arg('max_user_turns')::int - 1)
    LIMIT 1
  ), 0);

-- name: AiUniworkRenumberTurns :exec
-- tenant: parent conversation_id
-- After a trim, seq is dense again (1..N) so Rollback's "keep = the turn
-- count before the attempt" is exactly "every seq above keep".
WITH numbered AS (
  SELECT u.id, ROW_NUMBER() OVER (ORDER BY u.seq) AS rn
  FROM ai_uniwork_turns u WHERE u.conversation_id = $1
)
UPDATE ai_uniwork_turns t SET seq = n.rn
FROM numbered n
WHERE t.id = n.id AND t.seq <> n.rn;

-- name: AiUniworkRollbackTurns :exec
-- tenant: parent conversation_id
-- Drops the turns of a failed attempt so a later run replays the history the
-- model saw when the attempt started (spike §4.9, rollbackFailedRun).
DELETE FROM ai_uniwork_turns WHERE conversation_id = $1 AND seq > $2;

-- name: AiUniworkCountLiveConversations :one
-- tenant: system
-- The gauge behind uniwork_ai_uniwork_conversations_live.
SELECT count(*) FROM ai_uniwork_conversations WHERE expires_at > $1;

-- name: AiUniworkConversationOrganizations :many
-- tenant: system
-- The organizations that hold at least one transcript: the TTL worker asks
-- each of them whether office_ai_uniwork is still on (design §9.4).
SELECT DISTINCT organization_id FROM ai_uniwork_conversations ORDER BY organization_id;

-- ---- Usage reconciliation (G6-03b, design §6.3) -----------------------------
-- The pass prices the rows whose vendor sent no usage block, from the
-- transcript stored for them. It is a maintenance job that answers no
-- request, like the TTL sweep above.

-- name: AiUniworkUnknownUsageEvents :many
-- tenant: system
-- The reconciliation queue: UniWork AI calls whose vendor reported no usage
-- block, oldest first, so a row entered once is priced before the queue grows
-- behind it (design §6.3).
SELECT * FROM ai_usage_events
WHERE capability = 'office_uniwork_ai' AND reason_code = 'usage_unknown'
ORDER BY created_at, id
LIMIT sqlc.arg('batch')::int;

-- name: AiUniworkTurnByUsageEvent :one
-- The assistant turn a usage row belongs to: it names the conversation and
-- seq the estimate replays from. Scoped by the row's organization so a turn
-- of a foreign tenant can never answer (the usage row carries one).
SELECT * FROM ai_uniwork_turns
WHERE organization_id = $1 AND usage_event_id = $2;

-- name: AiUniworkTurnsToUsageEvent :many
-- tenant: parent conversation_id
-- Every turn up to and including the assistant turn, oldest first: the
-- estimate reads what the model was sent plus what it answered.
SELECT * FROM ai_uniwork_turns WHERE conversation_id = $1 AND seq <= $2 ORDER BY seq;

-- name: AiUniworkClaimUnknownUsage :one
-- tenant: by-id
-- The claim of §6.3: one row flips usage_unknown -> usage_unknown_reconciled
-- with the estimate. No row means another pass or pod priced it first, so the
-- meter is never recorded twice.
UPDATE ai_usage_events SET
  reason_code = 'usage_unknown_reconciled', rate_id = $2, input_tokens = $3, output_tokens = $4,
  cost_micros = $5, completed_at = now()
WHERE id = $1 AND reason_code = 'usage_unknown'
RETURNING *;
