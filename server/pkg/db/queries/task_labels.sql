-- name: ListTaskLabels :many
SELECT l.*,
  (SELECT COUNT(*) FROM task_label_links x
   WHERE x.organization_id = l.organization_id
     AND x.workspace_id = l.workspace_id
     AND x.label_id = l.id)::bigint AS usage_count
FROM task_labels l
WHERE l.organization_id = $1 AND l.workspace_id = $2
  AND (sqlc.arg('include_archived')::bool OR l.archived_at IS NULL)
ORDER BY LOWER(l.name) ASC, l.id;

-- name: TaskLabelLinkExists :one
SELECT EXISTS(
  SELECT 1 FROM task_label_links
  WHERE organization_id = $1 AND workspace_id = $2 AND task_id = $3 AND label_id = $4
)::bool;

-- name: GetTaskLabelByID :one
SELECT * FROM task_labels
WHERE organization_id = $1 AND workspace_id = $2 AND id = $3;

-- name: CreateTaskLabel :one
INSERT INTO task_labels (
  id, organization_id, workspace_id, name, color, description,
  created_by, created_by_kind
) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
RETURNING *;

-- name: UpdateTaskLabel :one
UPDATE task_labels SET
  name = COALESCE(sqlc.narg('name'), name),
  description = COALESCE(sqlc.narg('description'), description),
  color = COALESCE(sqlc.narg('color'), color),
  updated_at = now()
WHERE organization_id = sqlc.arg('organization_id')
  AND workspace_id = sqlc.arg('workspace_id')
  AND id = sqlc.arg('id')
  AND archived_at IS NULL
RETURNING *;

-- name: DeleteTaskLabel :one
DELETE FROM task_labels
WHERE organization_id = $1 AND workspace_id = $2 AND id = $3
RETURNING id;

-- name: DeleteTaskLabelLinksByLabel :exec
DELETE FROM task_label_links
WHERE organization_id = $1 AND workspace_id = $2 AND label_id = $3;

-- name: ListTaskLabelLinks :many
SELECT l.* FROM task_labels l
INNER JOIN task_label_links x
  ON x.label_id = l.id
 AND x.organization_id = l.organization_id
 AND x.workspace_id = l.workspace_id
WHERE x.organization_id = $1 AND x.workspace_id = $2 AND x.task_id = $3
  AND l.archived_at IS NULL
ORDER BY LOWER(l.name) ASC, l.id;

-- name: AttachTaskLabel :one
WITH inserted AS (
  INSERT INTO task_label_links (organization_id, workspace_id, task_id, label_id)
  SELECT $1, $2, $3, $4
  WHERE EXISTS (
    SELECT 1 FROM tasks t
    WHERE t.id = $3
      AND t.organization_id = $1
      AND t.workspace_id = $2
  )
  AND EXISTS (
    SELECT 1 FROM task_labels l
    WHERE l.id = $4
      AND l.organization_id = $1
      AND l.workspace_id = $2
      AND l.archived_at IS NULL
  )
  ON CONFLICT DO NOTHING
  RETURNING task_id, label_id
), bumped AS (
  UPDATE tasks
  SET revision = revision + 1,
      last_activity_at = GREATEST(COALESCE(last_activity_at, updated_at), now()),
      updated_at = now()
  WHERE id IN (SELECT task_id FROM inserted)
  RETURNING id
)
SELECT inserted.label_id FROM inserted;

-- name: DetachTaskLabel :one
WITH deleted AS (
  DELETE FROM task_label_links AS x
  WHERE x.organization_id = $1
    AND x.workspace_id = $2
    AND x.task_id = $3
    AND x.label_id = $4
  RETURNING x.task_id, x.label_id
), bumped AS (
  UPDATE tasks
  SET revision = revision + 1,
      last_activity_at = GREATEST(COALESCE(last_activity_at, updated_at), now()),
      updated_at = now()
  WHERE id IN (SELECT task_id FROM deleted)
  RETURNING id
)
SELECT deleted.label_id FROM deleted;
