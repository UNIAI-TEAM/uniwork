-- name: LockMeetingSummary :one
-- Serializes conversions of one summary: CreateTasksFromSummary takes this
-- row lock inside its transaction before it reads the live links.
SELECT id FROM meeting_summaries
WHERE id = sqlc.arg('id') AND meeting_id = sqlc.arg('meeting_id') AND organization_id = sqlc.arg('organization_id')
FOR UPDATE;

-- name: InsertMeetingSummaryTaskLink :exec
INSERT INTO meeting_summary_task_links (
  id, organization_id, workspace_id, meeting_id, summary_id, item_index, task_id, created_by, created_by_kind
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);

-- name: ListLiveMeetingSummaryTaskLinks :many
-- The links of one summary whose task still exists; tasks are hard-deleted,
-- so a link without its task frees the item again. Oldest first per item.
SELECT l.item_index, l.task_id
FROM meeting_summary_task_links l
JOIN tasks t ON t.id = l.task_id AND t.organization_id = l.organization_id
WHERE l.organization_id = sqlc.arg('organization_id') AND l.summary_id = sqlc.arg('summary_id')
ORDER BY l.item_index, l.created_at, l.id;
