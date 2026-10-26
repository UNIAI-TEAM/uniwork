-- Minutes of a meeting (UNI-2003, spec meeting follow-through §5.2, §6.6).

-- name: LockMeetingForMinutes :one
-- Serializes create, finalize and reopen on one meeting, so each decides on
-- the columns as they stand under the lock.
SELECT * FROM meetings
WHERE id = sqlc.arg(id) AND organization_id = sqlc.arg(organization_id)
FOR UPDATE;

-- name: SetMeetingMinutesDocument :exec
-- A new minutes page replaces one deleted or trashed since, and starts as a draft.
UPDATE meetings SET
  minutes_document_id = sqlc.arg(document_id),
  minutes_finalized_at = NULL,
  minutes_finalized_by = NULL,
  minutes_finalized_version_id = NULL
WHERE id = sqlc.arg(id) AND organization_id = sqlc.arg(organization_id);

-- name: FinalizeMeetingMinutes :exec
UPDATE meetings SET
  minutes_finalized_at = now(),
  minutes_finalized_by = sqlc.arg(finalized_by),
  minutes_finalized_version_id = sqlc.arg(version_id)
WHERE id = sqlc.arg(id) AND organization_id = sqlc.arg(organization_id);

-- name: ReopenMeetingMinutes :exec
-- The version stays in the page's history; only the meeting forgets it.
UPDATE meetings SET
  minutes_finalized_at = NULL,
  minutes_finalized_by = NULL,
  minutes_finalized_version_id = NULL
WHERE id = sqlc.arg(id) AND organization_id = sqlc.arg(organization_id);
