-- Task and project trash (UNI-2171). A deleted task or project keeps its row
-- for 30 days: trashed_at / trashed_by / purge_after mark it, trash_batch_id
-- groups one task subtree so a restore brings back exactly one batch, and
-- trashed_project_id remembers the project a task was unlinked from while that
-- project sits in the trash. Readers skip trashed rows (Task 2); the queries
-- here are the only ones that see them. Every row write bumps revision, so a
-- client holding the pre-trash revision conflicts instead of overwriting.

-- One batch stamp for every live id of a task subtree. Rows already in the
-- trash keep their own batch.
-- name: TrashTasks :many
UPDATE tasks
SET trashed_at = now(),
    trashed_by = sqlc.arg(trashed_by),
    purge_after = sqlc.arg(purge_after),
    trash_batch_id = sqlc.arg(trash_batch_id),
    revision = revision + 1,
    updated_at = now()
WHERE organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND id = ANY(sqlc.arg(ids)::text[])
  AND trashed_at IS NULL
RETURNING id;

-- One trash batch's rows (restore reads this for the events and the audit).
-- name: ListTaskTrashBatch :many
SELECT *
FROM tasks
WHERE organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND trash_batch_id = sqlc.arg(trash_batch_id)
ORDER BY id;

-- Run BEFORE RestoreTaskBatch, while the rows still carry the batch. A member
-- whose parent is not coming back with it (parent still trashed in another
-- batch, or already purged) becomes a root, so it never points at a row the
-- reader cannot see.
-- name: UnparentRestoredOrphans :many
UPDATE tasks c
SET parent_task_id = NULL,
    revision = c.revision + 1,
    updated_at = now()
WHERE c.organization_id = sqlc.arg(organization_id)
  AND c.workspace_id = sqlc.arg(workspace_id)
  AND c.trash_batch_id = sqlc.arg(trash_batch_id)
  AND c.parent_task_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM tasks p
    WHERE p.id = c.parent_task_id
      AND p.organization_id = c.organization_id
      AND p.workspace_id = c.workspace_id
      AND (p.trashed_at IS NULL OR p.trash_batch_id = c.trash_batch_id)
  )
RETURNING c.id;

-- name: RestoreTaskBatch :many
UPDATE tasks
SET trashed_at = NULL,
    trashed_by = NULL,
    purge_after = NULL,
    trash_batch_id = NULL,
    revision = revision + 1,
    updated_at = now()
WHERE organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND trash_batch_id = sqlc.arg(trash_batch_id)
  AND trashed_at IS NOT NULL
RETURNING id;

-- Restore and purge read the row even when it is in the trash; every other
-- reader goes through GetTask / GetTaskInWorkspace.
-- name: GetTaskIncludingTrashed :one
SELECT * FROM tasks
WHERE id = sqlc.arg(id)
  AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id);

-- The trash page: one row per batch root (no parent, or a parent outside the
-- batch), newest first. batch_size counts the root's own subtree inside the
-- batch, so a purge of that row removes exactly that many.
-- name: ListTaskTrashPage :many
WITH RECURSIVE page AS (
  SELECT t.*
  FROM tasks t
  WHERE t.organization_id = sqlc.arg(organization_id)
    AND t.workspace_id = sqlc.arg(workspace_id)
    AND t.trashed_at IS NOT NULL
    AND (
      t.parent_task_id IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM tasks p
        WHERE p.id = t.parent_task_id
          AND p.organization_id = t.organization_id
          AND p.workspace_id = t.workspace_id
          AND p.trash_batch_id = t.trash_batch_id
      )
    )
    AND (sqlc.narg(before_trashed_at)::timestamptz IS NULL
         OR (t.trashed_at, t.id) < (sqlc.narg(before_trashed_at), sqlc.narg(before_id)::text))
  ORDER BY t.trashed_at DESC, t.id DESC
  LIMIT sqlc.arg(max_rows)
),
sub AS (
  SELECT pg.id AS root_id, pg.id AS id, pg.trash_batch_id AS trash_batch_id
  FROM page pg
  UNION ALL
  SELECT s.root_id, c.id, s.trash_batch_id
  FROM tasks c
  INNER JOIN sub s ON c.parent_task_id = s.id AND c.trash_batch_id = s.trash_batch_id
  WHERE c.organization_id = sqlc.arg(organization_id)
    AND c.workspace_id = sqlc.arg(workspace_id)
),
sizes AS (
  SELECT root_id, count(*)::bigint AS batch_size FROM sub GROUP BY root_id
)
SELECT pg.*, z.batch_size
FROM page pg
INNER JOIN sizes z ON z.root_id = pg.id
ORDER BY pg.trashed_at DESC, pg.id DESC;

-- Retention sweep input: rows whose 30 days ran out. after_* keysets past the
-- previous batch so a row that keeps failing never pins the sweep.
-- name: ListTasksForPurge :many
-- tenant: system
SELECT id, organization_id, workspace_id, purge_after
FROM tasks
WHERE trashed_at IS NOT NULL
  AND purge_after IS NOT NULL
  AND purge_after < sqlc.arg(now)
  AND (sqlc.narg(after_purge_after)::timestamptz IS NULL
       OR (purge_after, id) > (sqlc.narg(after_purge_after), sqlc.narg(after_id)::text))
ORDER BY purge_after, id
LIMIT sqlc.arg(max_rows);

-- Row lock for restore-versus-purge: whoever locks second re-reads the row
-- and skips when it is no longer valid.
-- name: LockTaskForPurge :one
SELECT * FROM tasks
WHERE id = sqlc.arg(id)
  AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
FOR UPDATE;

-- Restore and purge arrive with a task id only: this finds the row (trashed
-- or not) so the caller can run the workspace membership gate on it.
-- name: GetTaskByIDIncludingTrashed :one
-- tenant: by-id
SELECT * FROM tasks WHERE id = sqlc.arg(id);

-- A purge's scope: the row and its descendants that left in the same trash
-- batch, never batch siblings that are roots of their own. Locked so a
-- concurrent purge or restore of one of them waits; a row the other side
-- already deleted is not returned, one it restored is (the caller re-checks).
-- name: LockTaskTrashSubtree :many
WITH RECURSIVE sub AS (
  SELECT r.id, r.trash_batch_id
  FROM tasks r
  WHERE r.id = sqlc.arg(root_id)
    AND r.organization_id = sqlc.arg(organization_id)
    AND r.workspace_id = sqlc.arg(workspace_id)
    AND r.trashed_at IS NOT NULL
  UNION ALL
  SELECT c.id, c.trash_batch_id
  FROM tasks c
  INNER JOIN sub s ON c.parent_task_id = s.id AND c.trash_batch_id = s.trash_batch_id
  WHERE c.organization_id = sqlc.arg(organization_id)
    AND c.workspace_id = sqlc.arg(workspace_id)
    AND c.trashed_at IS NOT NULL
)
SELECT t.*
FROM tasks t
WHERE t.organization_id = sqlc.arg(organization_id)
  AND t.workspace_id = sqlc.arg(workspace_id)
  AND t.id IN (SELECT sub.id FROM sub)
ORDER BY t.id
FOR UPDATE;

-- name: LockProjectForPurge :one
SELECT * FROM projects
WHERE id = sqlc.arg(id)
  AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
FOR UPDATE;

-- name: TrashProject :one
UPDATE projects
SET trashed_at = now(),
    trashed_by = sqlc.arg(trashed_by),
    purge_after = sqlc.arg(purge_after),
    revision = revision + 1,
    updated_at = now()
WHERE id = sqlc.arg(id)
  AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND trashed_at IS NULL
RETURNING *;

-- name: RestoreProject :one
UPDATE projects
SET trashed_at = NULL,
    trashed_by = NULL,
    purge_after = NULL,
    revision = revision + 1,
    updated_at = now()
WHERE id = sqlc.arg(id)
  AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND trashed_at IS NOT NULL
RETURNING *;

-- name: GetProjectIncludingTrashed :one
SELECT * FROM projects
WHERE id = sqlc.arg(id)
  AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id);

-- name: ListProjectTrashPage :many
SELECT *
FROM projects
WHERE organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
  AND trashed_at IS NOT NULL
  AND (sqlc.narg(before_trashed_at)::timestamptz IS NULL
       OR (trashed_at, id) < (sqlc.narg(before_trashed_at), sqlc.narg(before_id)::text))
ORDER BY trashed_at DESC, id DESC
LIMIT sqlc.arg(max_rows);

-- name: ListProjectsForPurge :many
-- tenant: system
SELECT id, organization_id, workspace_id, purge_after
FROM projects
WHERE trashed_at IS NOT NULL
  AND purge_after IS NOT NULL
  AND purge_after < sqlc.arg(now)
  AND (sqlc.narg(after_purge_after)::timestamptz IS NULL
       OR (purge_after, id) > (sqlc.narg(after_purge_after), sqlc.narg(after_id)::text))
ORDER BY purge_after, id
LIMIT sqlc.arg(max_rows);

-- A project entering the trash really unlinks its tasks and remembers the
-- project, so no reader has to mask project_id.
-- name: UnlinkTasksForProjectTrash :many
UPDATE tasks
SET trashed_project_id = project_id,
    project_id = NULL,
    revision = revision + 1,
    updated_at = now()
WHERE project_id = sqlc.arg(project_id)
  AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
RETURNING id;

-- Only tasks still unlinked come back; one moved to another project while the
-- project was trashed keeps its new project.
-- name: RelinkTasksForProjectRestore :many
UPDATE tasks
SET project_id = trashed_project_id,
    trashed_project_id = NULL,
    revision = revision + 1,
    updated_at = now()
WHERE trashed_project_id = sqlc.arg(project_id)
  AND project_id IS NULL
  AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id)
RETURNING id;

-- Run after the relink (restore) or before the project row goes (purge): drops
-- the remembered project from every task still pointing at it.
-- name: ClearTrashedProjectLinks :exec
UPDATE tasks
SET trashed_project_id = NULL
WHERE trashed_project_id = sqlc.arg(project_id)
  AND organization_id = sqlc.arg(organization_id)
  AND workspace_id = sqlc.arg(workspace_id);
