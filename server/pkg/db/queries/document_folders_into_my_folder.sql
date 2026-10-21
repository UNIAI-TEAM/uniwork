-- Folders outside My Folder that are still private (UNI-2055 S3, ADR 0037
-- point 8): the candidates of `uniwork-admin folders-into-my-folder`, by id
-- keyset, archived folders included so a restore never brings a private folder
-- back to a public place. A folder that is already the direct child of a My
-- Folder is left out here; deeper ones are decided in the service, which walks
-- the ancestors under the tree lock. An empty organization_id means every
-- organization (the command spans tenants), so the clause is optional.
-- name: ListFolderUnitCandidates :many
-- tenant: system
SELECT d.id, d.organization_id, d.workspace_id
FROM documents d
WHERE d.kind = 'folder'
  AND d.system_kind IS NULL
  AND d.owner_id IS NULL
  AND d.visibility = 'restricted'
  AND (sqlc.arg(organization_id)::text = '' OR d.organization_id = sqlc.arg(organization_id)::text)
  AND (d.parent_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM documents p
        WHERE p.id = d.parent_id AND p.system_kind = 'my_folder'))
  AND d.id > sqlc.arg(after_id)::text
ORDER BY d.id
LIMIT sqlc.arg(max_rows);

-- The move write of the same pass: the one of MoveDocument without its
-- archived_at guard, because a folder in the Trash is moved too. Parent,
-- position, title and the folded search text change; the revision guard is the
-- check the service already made under the row and tree locks.
-- name: MoveDocumentAnyState :one
UPDATE documents
SET parent_id = sqlc.narg(parent_id),
    position = sqlc.arg(position),
    title = sqlc.arg(title),
    search_text = sqlc.arg(search_text),
    revision = revision + 1,
    updated_by = sqlc.arg(updated_by),
    updated_by_kind = sqlc.arg(updated_by_kind),
    updated_at = now()
WHERE id = sqlc.arg(id)
  AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND revision = sqlc.arg(expected_revision)
RETURNING *;
