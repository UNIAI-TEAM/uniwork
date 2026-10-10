-- FileService derivatives (H15/UNI-1088). Only internal/service/file_*.go
-- reads and writes these rows.

-- name: GetFileDerivative :one
-- The derived file behind a source the module already authorized; the
-- tenant comes from the caller's scope.
SELECT file_id FROM file_derivatives
WHERE source_file_id = sqlc.arg('source_file_id')
  AND variant = sqlc.arg('variant')
  AND organization_id = sqlc.arg('organization_id');

-- name: InsertFileDerivative :execrows
-- A redelivered request finds the row already there and writes nothing.
INSERT INTO file_derivatives (source_file_id, variant, file_id, processor_version, organization_id)
VALUES (sqlc.arg('source_file_id'), sqlc.arg('variant'), sqlc.arg('file_id'),
        sqlc.arg('processor_version'), sqlc.arg('organization_id'))
ON CONFLICT (source_file_id, variant) DO NOTHING;

-- name: ListHeldFileDerivatives :many
-- tenant: system
-- The collector's question for derived files: which still have a source that
-- is not deleted. A derivative of a deleted (or missing) source is garbage.
SELECT d.file_id FROM file_derivatives d
JOIN files s ON s.id = d.source_file_id
WHERE d.file_id = ANY(sqlc.arg('file_ids')::text[])
  AND s.status <> 'deleted';
