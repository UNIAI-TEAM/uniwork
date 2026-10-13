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

-- Runs (G6-03b, G6-D1 A3/A12; design §3, §4). One run counts what a single
-- question may spend across every pod; the store implementation is RunStorePG
-- in server/internal/ai/run_store_pg.go.

-- name: AiUniworkStartRun :one
-- Opening a run is the question turn that reached the Gateway: the row is
-- born with model_calls = 1 (design §2.2) and is bound to the conversation it
-- was resumed for - the INSERT ... SELECT also takes the conversation's
-- created_at for the absolute horizon, so the entity that scopes a run is the
-- conversation, filtered by its organization (design §3.3). No rows means the
-- conversation is gone; the store answers run_expired.
INSERT INTO ai_uniwork_runs (
  id, organization_id, conversation_id, model_calls, tool_rounds, credits,
  created_by, created_by_kind, created_at, last_used_at, expires_at
)
SELECT
  sqlc.arg('id')::text,
  c.organization_id,
  c.id,
  1,
  0,
  0,
  sqlc.arg('created_by')::text,
  'human',
  sqlc.arg('now')::timestamptz,
  sqlc.arg('now')::timestamptz,
  LEAST(
    sqlc.arg('now')::timestamptz + make_interval(secs => sqlc.arg('idle_secs')::int),
    c.created_at + make_interval(secs => sqlc.arg('absolute_secs')::int))
FROM ai_uniwork_conversations c
WHERE c.id = sqlc.arg('conversation_id') AND c.organization_id = sqlc.arg('organization_id')
RETURNING *;

-- name: AiUniworkTakeRunTurn :one
-- The whole cap in one conditional UPDATE (design §4.2): the conditions are
-- the live window and both caps, so two pods cannot overspend one run and no
-- service-level read-then-write is needed. The window is refreshed here too -
-- expires_at never passes the conversation's absolute horizon, and the join
-- on the conversation makes an orphaned run unfindable (the store answers
-- run_expired). Zero rows reserved nothing: the store reads AiUniworkGetRun
-- to say which refusal it is.
UPDATE ai_uniwork_runs AS r SET
  model_calls = r.model_calls + 1,
  tool_rounds = r.tool_rounds + (CASE WHEN sqlc.arg('tool_round')::boolean THEN 1 ELSE 0 END),
  last_used_at = sqlc.arg('now')::timestamptz,
  expires_at = LEAST(
    sqlc.arg('now')::timestamptz + make_interval(secs => sqlc.arg('idle_secs')::int),
    c.created_at + make_interval(secs => sqlc.arg('absolute_secs')::int))
FROM ai_uniwork_conversations c
WHERE r.conversation_id = c.id
  AND r.id = sqlc.arg('run_id')
  AND r.conversation_id = sqlc.arg('conversation_id')
  AND r.organization_id = sqlc.arg('organization_id')
  AND r.expires_at > sqlc.arg('now')::timestamptz
  AND r.model_calls < sqlc.arg('model_call_max')::int
  AND (NOT sqlc.arg('tool_round')::boolean OR r.tool_rounds < sqlc.arg('tool_round_max')::int)
RETURNING r.*;

-- name: AiUniworkGetRun :one
-- Distinguishes run_expired from run_limit_reached after a turn reserved
-- nothing, and filters all three columns (id, conversation, organization), so
-- a run of another tenant or conversation is not found rather than refused
-- with a reason (design §3.5).
SELECT r.* FROM ai_uniwork_runs r
WHERE r.id = sqlc.arg('id')
  AND r.conversation_id = sqlc.arg('conversation_id')
  AND r.organization_id = sqlc.arg('organization_id');

-- name: AiUniworkAddRunCredits :exec
-- tenant: by-id
-- What one answered model call cost is added to the run after the call
-- settled; the run was authorized by the turn that reserved the call, and a
-- row already swept is a no-op (the usage row and the meter still carry it).
UPDATE ai_uniwork_runs SET credits = credits + sqlc.arg('tokens')::bigint
WHERE id = sqlc.arg('run_id') AND conversation_id = sqlc.arg('conversation_id');

-- name: AiUniworkExpiredRunIDs :many
-- tenant: system
-- The TTL sweep's batch, oldest expiry first: runs whose window has passed
-- (design §3.4). Same clock as the conversation sweep - idle and absolute
-- both land in expires_at.
SELECT id FROM ai_uniwork_runs
WHERE expires_at <= sqlc.arg('now')::timestamptz
ORDER BY expires_at
LIMIT sqlc.arg('batch')::int;

-- name: AiUniworkOrphanRunIDs :many
-- tenant: system
-- Runs whose conversation is gone: every path that deletes a conversation
-- leaves its runs to this sweep (design §3.4), so a run outlives its owner by
-- one pass at most - and is unreachable in the meantime, because a turn
-- resumes the conversation first.
SELECT r.id FROM ai_uniwork_runs r
WHERE NOT EXISTS (SELECT 1 FROM ai_uniwork_conversations c WHERE c.id = r.conversation_id)
ORDER BY r.created_at
LIMIT sqlc.arg('batch')::int;

-- name: AiUniworkDeleteRunsByIDs :execrows
-- tenant: system
-- The ids come from AiUniworkExpiredRunIDs / AiUniworkOrphanRunIDs in the same
-- pass; deleting an already-deleted id is a no-op, so two pods sweeping at
-- once is harmless and each reports what its own delete removed.
DELETE FROM ai_uniwork_runs WHERE id = ANY(sqlc.arg('ids')::text[]);
