-- Document access requests (DOC-07, UNI-1631). The table is
-- document_access_requests; the pending unique index
-- (idx_document_access_requests_one_pending) is the second line of the "one
-- pending request per (document, requester)" rule, the upsert below is the
-- first. Every read/decide/write carries organization_id; the expiry checks
-- take the SERVICE clock (sqlc.arg(now)), never now(), so the A03
-- refresh-after-expiry and A09 cooldown tests can drive DocumentService.SetClock.

-- name: UpsertPendingDocumentAccessRequest :one
-- A new pending request, or the caller's own expired pending row refreshed
-- in place as a new request (new level, message, source, created_at,
-- expires_at). A live pending row is never touched: the DO UPDATE's WHERE is
-- false, no row comes back, and the service answers 409
-- access_request_pending. The conflict target names the partial unique index.
INSERT INTO document_access_requests (
  id, organization_id, workspace_id, document_id, created_by, created_by_kind,
  requested_level, message, source_kind, source_id, expires_at, created_at, updated_at
) VALUES (
  sqlc.arg(id), sqlc.arg(organization_id), sqlc.arg(workspace_id), sqlc.arg(document_id),
  sqlc.arg(created_by), sqlc.arg(created_by_kind), sqlc.arg(requested_level), sqlc.arg(message),
  sqlc.narg(source_kind), sqlc.narg(source_id), sqlc.arg(expires_at), sqlc.arg(now), sqlc.arg(now)
)
ON CONFLICT (document_id, created_by) WHERE status = 'pending' DO UPDATE
SET requested_level = EXCLUDED.requested_level,
    message = EXCLUDED.message,
    source_kind = EXCLUDED.source_kind,
    source_id = EXCLUDED.source_id,
    created_at = sqlc.arg(now),
    expires_at = EXCLUDED.expires_at,
    updated_at = sqlc.arg(now)
WHERE document_access_requests.organization_id = sqlc.arg(organization_id)
  AND document_access_requests.expires_at <= sqlc.arg(now)
RETURNING *;

-- name: GetDocumentAccessRequestForUpdate :one
-- One request of one document, locked for a decision (w2's approve/decline).
SELECT * FROM document_access_requests
WHERE organization_id = sqlc.arg(organization_id)
  AND document_id = sqlc.arg(document_id)
  AND id = sqlc.arg(id)
FOR UPDATE;

-- name: ListPendingDocumentAccessRequests :many
-- The pending, unexpired requests of a document, newest first. Expiry is
-- computed against the caller's now, never now().
SELECT * FROM document_access_requests
WHERE organization_id = sqlc.arg(organization_id)
  AND document_id = sqlc.arg(document_id)
  AND status = 'pending'
  AND expires_at > sqlc.arg(now)
ORDER BY created_at DESC, id DESC;

-- name: CountPendingDocumentAccessRequests :one
-- The count the share dialog shows without fetching the list.
SELECT count(*)::bigint FROM document_access_requests
WHERE organization_id = sqlc.arg(organization_id)
  AND document_id = sqlc.arg(document_id)
  AND status = 'pending'
  AND expires_at > sqlc.arg(now);

-- name: DecideDocumentAccessRequest :one
-- Closes a pending request (w2). Zero rows means it was already decided,
-- expired or cancelled by another command.
UPDATE document_access_requests SET
  status = sqlc.arg(status),
  granted_level = sqlc.narg(granted_level),
  share_id = sqlc.narg(share_id),
  decided_by = sqlc.narg(decided_by),
  decided_by_kind = sqlc.narg(decided_by_kind),
  decided_at = sqlc.arg(decided_at),
  updated_at = sqlc.arg(updated_at)
WHERE id = sqlc.arg(id)
  AND organization_id = sqlc.arg(organization_id)
  AND document_id = sqlc.arg(document_id)
  AND status = 'pending'
RETURNING *;

-- name: GetDocumentAccessRequest :one
-- One request of one document, read without a lock: the notification rule
-- needs the decision's status and requester and must not take a row lock
-- outside a transaction (w2).
SELECT * FROM document_access_requests
WHERE organization_id = sqlc.arg(organization_id)
  AND document_id = sqlc.arg(document_id)
  AND id = sqlc.arg(id);

-- name: GetLatestDeclinedDocumentAccessRequest :one
-- The most recent decline of one (document, requester) pair: the 1h
-- re-request cooldown counts from its decided_at. No row means no cooldown.
SELECT * FROM document_access_requests
WHERE organization_id = sqlc.arg(organization_id)
  AND document_id = sqlc.arg(document_id)
  AND created_by = sqlc.arg(created_by)
  AND status = 'declined'
ORDER BY decided_at DESC
LIMIT 1;

-- name: DeleteDocumentAccessRequests :exec
-- Purge deletes a document's request rows with it (no FK, cleanup in
-- service code, inside the purge transaction).
DELETE FROM document_access_requests
WHERE organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND document_id = sqlc.arg(document_id);
