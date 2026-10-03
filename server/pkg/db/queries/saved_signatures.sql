-- Saved signatures (UNI-925 B6): one person's reusable signature images.
-- Rows are personal, so every statement filters by organization_id and
-- user_id together; the service gates organization membership before it
-- calls any of these.

-- name: ListSavedSignatures :many
SELECT id, label, content_type, image, created_at
FROM saved_signatures
WHERE organization_id = $1
  AND user_id = $2
ORDER BY created_at DESC, id DESC;

-- Serializes the per-user cap check against a concurrent create: taken in the
-- same transaction as the count + insert below, so two creates for one person
-- cannot both read the same under-cap count. Transaction-scoped, released on
-- commit or rollback.
-- name: LockSavedSignaturesForUser :exec
SELECT pg_advisory_xact_lock(hashtextextended('saved_signatures:' || sqlc.arg(organization_id)::text || ':' || sqlc.arg(user_id)::text, 0));

-- name: CountSavedSignaturesByOwner :one
SELECT COUNT(*) FROM saved_signatures
WHERE organization_id = $1
  AND user_id = $2;

-- name: CreateSavedSignature :one
INSERT INTO saved_signatures (
  id, organization_id, user_id, label, content_type, image, created_by, created_by_kind
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8
)
RETURNING id, label, content_type, image, created_at;

-- name: DeleteSavedSignature :execrows
DELETE FROM saved_signatures
WHERE id = $1
  AND organization_id = $2
  AND user_id = $3;
