-- Document edit lock (UNI-1645, addendum 2026-10-15). One row per tenure of
-- the one editor of a document; the live tenure is the row with ended_at IS
-- NULL. Every command that changes the holder runs under the document row
-- lock (LockDocumentByID) and reads the live row FOR UPDATE; the heartbeat
-- alone is a single conditional UPDATE without the document lock (§1.5).
-- Times come from the database clock only: the commands read
-- DocumentEditLockClock once in their transaction, the heartbeat uses now().

-- name: DocumentEditLockClock :one
-- The transaction's own now(): every timestamp a command writes is computed
-- from it, so the server never reads the client's clock (edge 5).
SELECT now()::timestamptz AS now;

-- name: LockLiveDocumentEditLock :one
-- The live tenure of a document, locked for a command that may end or
-- replace it. Whether it is still live (expires_at, offline_hold_until) is
-- decided by the caller against DocumentEditLockClock.
SELECT * FROM document_edit_locks
WHERE organization_id = sqlc.arg(organization_id)
  AND document_id = sqlc.arg(document_id)
  AND ended_at IS NULL
FOR UPDATE;

-- name: GetLiveDocumentEditLock :one
-- R1 and the 423 body: the unended tenure, read without a lock. An expired
-- row is answered as no lock by the caller and never ended by a read.
SELECT * FROM document_edit_locks
WHERE organization_id = sqlc.arg(organization_id)
  AND document_id = sqlc.arg(document_id)
  AND ended_at IS NULL;

-- name: GetDocumentEditLock :one
-- One tenure of one document, ended or not: R3/R4/R6/R7 find {lockID} only
-- under the document it belongs to, in that document's organization.
SELECT * FROM document_edit_locks
WHERE id = sqlc.arg(id)
  AND organization_id = sqlc.arg(organization_id)
  AND document_id = sqlc.arg(document_id);

-- name: InsertDocumentEditLock :one
INSERT INTO document_edit_locks (
  id, organization_id, document_id, user_id, session_id, editor_id, client,
  base_revision, acquired_at, heartbeat_at, expires_at, granted_via, previous_lock_id
) VALUES (
  sqlc.arg(id), sqlc.arg(organization_id), sqlc.arg(document_id), sqlc.arg(user_id),
  sqlc.arg(session_id), sqlc.arg(editor_id), sqlc.arg(client), sqlc.arg(base_revision),
  sqlc.arg(acquired_at), sqlc.arg(acquired_at), sqlc.arg(expires_at), sqlc.arg(granted_via),
  sqlc.narg(previous_lock_id)
)
RETURNING *;

-- name: EndDocumentEditLock :one
-- Ends a live tenure. Zero rows means another command ended it first.
UPDATE document_edit_locks SET
  ended_at = sqlc.arg(ended_at),
  end_reason = sqlc.arg(end_reason)::text,
  ended_by = sqlc.narg(ended_by),
  updated_at = now()
WHERE id = sqlc.arg(id) AND organization_id = sqlc.arg(organization_id) AND ended_at IS NULL
RETURNING *;

-- name: HeartbeatDocumentEditLock :one
-- R3, and a passing holder write: extends a tenure that is still live and
-- still the caller's. A tenure that was ended (take-over, handover, move
-- here) or that ran out updates nothing, so a late heartbeat never revives
-- a lock (edge 13). A reserved handover tenure is claimed by R2, not here.
UPDATE document_edit_locks SET
  heartbeat_at = now(),
  expires_at = now() + (sqlc.arg(ttl_ms)::bigint * interval '1 millisecond'),
  updated_at = now()
WHERE id = sqlc.arg(id)
  AND organization_id = sqlc.arg(organization_id)
  AND document_id = sqlc.arg(document_id)
  AND user_id = sqlc.arg(user_id)
  AND editor_id <> ''
  AND ended_at IS NULL
  AND (expires_at > now() OR offline_hold_until > now())
RETURNING *;

-- name: ClaimReservedDocumentEditLock :one
-- R2 on a handover tenure: the requester's editor fills the session and
-- editor of the tenure the holder reserved for them.
UPDATE document_edit_locks SET
  session_id = sqlc.arg(session_id),
  editor_id = sqlc.arg(editor_id),
  client = sqlc.arg(client),
  heartbeat_at = sqlc.arg(now),
  expires_at = sqlc.arg(expires_at),
  updated_at = now()
WHERE id = sqlc.arg(id)
  AND organization_id = sqlc.arg(organization_id)
  AND user_id = sqlc.arg(user_id)
  AND editor_id = ''
  AND ended_at IS NULL
RETURNING *;

-- name: SetDocumentEditHold :one
-- R6: start or renew the D1 offline hold; the caller computed the end from
-- the hold caps and the device session.
UPDATE document_edit_locks SET
  offline_hold_until = sqlc.arg(offline_hold_until),
  hold_device_session_id = sqlc.arg(hold_device_session_id),
  hold_chain_started_at = sqlc.arg(hold_chain_started_at),
  hold_renewals = sqlc.arg(hold_renewals),
  heartbeat_at = sqlc.arg(now),
  expires_at = sqlc.arg(expires_at),
  updated_at = now()
WHERE id = sqlc.arg(id) AND organization_id = sqlc.arg(organization_id) AND ended_at IS NULL
RETURNING *;

-- name: ClearDocumentEditHold :one
-- R7: drop the hold and go back to the heartbeat TTL. The chain start stays,
-- so the 24 h cap holds across clear and restart within one tenure.
UPDATE document_edit_locks SET
  offline_hold_until = NULL,
  hold_device_session_id = NULL,
  heartbeat_at = sqlc.arg(now),
  expires_at = sqlc.arg(expires_at),
  updated_at = now()
WHERE id = sqlc.arg(id) AND organization_id = sqlc.arg(organization_id) AND ended_at IS NULL
RETURNING *;

-- name: ListLiveDocumentEditLocks :many
-- Library rows: the unended tenures of a page of documents, in one read.
SELECT * FROM document_edit_locks
WHERE organization_id = sqlc.arg(organization_id)
  AND document_id = ANY(sqlc.arg(document_ids)::text[])
  AND ended_at IS NULL;

-- name: ListLiveDocumentEditLocksForSession :many
-- tenant: self
-- session.revoked: the person's tenures claimed under one session, or under
-- every session when session_id is empty, in every organization.
SELECT * FROM document_edit_locks
WHERE user_id = sqlc.arg(user_id)
  AND (sqlc.arg(session_id)::text = '' OR session_id = sqlc.arg(session_id)::text)
  AND ended_at IS NULL
ORDER BY id;

-- name: ListLiveDocumentEditLocksForUserInOrg :many
-- Deactivation, departure and removal: the person's tenures in one
-- organization, whatever workspace the document sits in.
SELECT * FROM document_edit_locks
WHERE organization_id = sqlc.arg(organization_id)
  AND user_id = sqlc.arg(user_id)
  AND ended_at IS NULL
ORDER BY id;

-- name: ListLiveDocumentEditLocksForOrganization :many
-- Suspension: one batch of the organization's unended tenures.
SELECT * FROM document_edit_locks
WHERE organization_id = sqlc.arg(organization_id)
  AND ended_at IS NULL
ORDER BY id
LIMIT sqlc.arg(batch_limit);

-- name: ListExpiredDocumentEditLocks :many
-- tenant: system
-- The sweeper: unended tenures whose TTL and hold both ran out and whose
-- document still exists, oldest first. A tenure of a document that is gone
-- belongs to the delete consumer and is skipped by expireDocumentEditLock
-- anyway, so it must not fill a batch and starve the tenures that can end.
SELECT id, organization_id, document_id FROM document_edit_locks
WHERE ended_at IS NULL
  AND expires_at <= now()
  AND (offline_hold_until IS NULL OR offline_hold_until <= now())
  AND EXISTS (SELECT 1 FROM documents d WHERE d.id = document_edit_locks.document_id)
ORDER BY expires_at
LIMIT sqlc.arg(batch_limit);

-- name: DeleteEndedDocumentEditLocks :execrows
-- tenant: system
-- Ended tenures are kept 7 days so a late heartbeat learns why it lost the
-- lock; the history stays in audit_events.
DELETE FROM document_edit_locks
WHERE id IN (
  SELECT l.id FROM document_edit_locks l
  WHERE l.ended_at IS NOT NULL AND l.ended_at < sqlc.arg(cutoff)::timestamptz
  LIMIT sqlc.arg(batch_limit)
);

-- Edit requests (D3).

-- name: InsertDocumentEditRequest :one
INSERT INTO document_edit_requests (
  id, organization_id, document_id, lock_id, requester_id, holder_id, status, created_at, expires_at
) VALUES (
  sqlc.arg(id), sqlc.arg(organization_id), sqlc.arg(document_id), sqlc.arg(lock_id),
  sqlc.arg(requester_id), sqlc.arg(holder_id), 'pending', sqlc.arg(created_at), sqlc.arg(expires_at)
)
RETURNING *;

-- name: GetDocumentEditRequest :one
-- One request of one document, locked for R9/R10.
SELECT * FROM document_edit_requests
WHERE id = sqlc.arg(id)
  AND organization_id = sqlc.arg(organization_id)
  AND document_id = sqlc.arg(document_id)
FOR UPDATE;

-- name: GetPendingDocumentEditRequestOfRequester :one
-- The caller's pending request on a document (R1 my_request, R8 idempotency).
SELECT * FROM document_edit_requests
WHERE organization_id = sqlc.arg(organization_id)
  AND document_id = sqlc.arg(document_id)
  AND requester_id = sqlc.arg(requester_id)
  AND status = 'pending';

-- name: ListPendingDocumentEditRequestsForLock :many
-- R1 pending_requests: the holder's open requests on its tenure.
SELECT * FROM document_edit_requests
WHERE organization_id = sqlc.arg(organization_id)
  AND lock_id = sqlc.arg(lock_id)
  AND status = 'pending'
  AND expires_at > sqlc.arg(now)::timestamptz
ORDER BY created_at, id;

-- name: CloseDocumentEditRequest :one
-- R9 accept/decline and R10 cancel: a pending request moves to a closed
-- status once.
UPDATE document_edit_requests SET
  status = sqlc.arg(status)::text,
  answered_at = sqlc.narg(answered_at),
  updated_at = now()
WHERE id = sqlc.arg(id) AND organization_id = sqlc.arg(organization_id) AND status = 'pending'
RETURNING *;

-- name: SupersedeDocumentEditRequestsForLock :execrows
-- A tenure that ends takes its open requests with it.
UPDATE document_edit_requests SET status = 'superseded', updated_at = now()
WHERE organization_id = sqlc.arg(organization_id)
  AND lock_id = sqlc.arg(lock_id)
  AND status = 'pending';

-- name: ExpireDocumentEditRequestsOfRequester :execrows
-- R8 closes the caller's own stale pending row before inserting, so the
-- pending unique index never answers 23505 before the sweeper runs (BE-5).
UPDATE document_edit_requests SET status = 'expired', updated_at = now()
WHERE organization_id = sqlc.arg(organization_id)
  AND document_id = sqlc.arg(document_id)
  AND requester_id = sqlc.arg(requester_id)
  AND status = 'pending'
  AND expires_at <= sqlc.arg(now)::timestamptz;

-- name: CountRecentDocumentEditRequests :one
-- The DB hourly cap of R8 (DOCUMENT_EDIT_REQUEST_MAX_PER_HOUR): how many
-- requests the person made on the document since the cutoff, and the oldest
-- of them, from which retry_after_s is computed.
SELECT count(*)::bigint AS n, COALESCE(min(created_at), sqlc.arg(since)::timestamptz)::timestamptz AS oldest
FROM document_edit_requests
WHERE organization_id = sqlc.arg(organization_id)
  AND requester_id = sqlc.arg(requester_id)
  AND document_id = sqlc.arg(document_id)
  AND created_at > sqlc.arg(since)::timestamptz;

-- name: ExpirePendingDocumentEditRequests :execrows
-- tenant: system
-- The sweeper: pending requests past their expiry read as expired anyway;
-- writing it frees the pending unique index.
UPDATE document_edit_requests SET status = 'expired', updated_at = now()
WHERE id IN (
  SELECT r.id FROM document_edit_requests r
  WHERE r.status = 'pending' AND r.expires_at <= now()
  LIMIT sqlc.arg(batch_limit)
);

-- name: DeleteClosedDocumentEditRequests :execrows
-- tenant: system
-- Closed requests are kept 7 days; the history stays in audit_events.
DELETE FROM document_edit_requests
WHERE id IN (
  SELECT r.id FROM document_edit_requests r
  WHERE r.status <> 'pending' AND r.updated_at < sqlc.arg(cutoff)::timestamptz
  LIMIT sqlc.arg(batch_limit)
);

-- name: GetDocumentEditLockSuccessor :one
-- The tenure that replaced an ended one (take-over, handover, move here):
-- edit_lock_lost names its holder in fields.by_id / by_name.
SELECT * FROM document_edit_locks
WHERE organization_id = sqlc.arg(organization_id)
  AND previous_lock_id = sqlc.arg(previous_lock_id)
ORDER BY created_at DESC, id DESC
LIMIT 1;
