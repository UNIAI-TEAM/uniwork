-- name: LockMeetingSummary :one
-- Serializes conversions of one summary: CreateTasksFromSummary takes this
-- row lock inside its transaction before it reads the live links.
SELECT id FROM meeting_summaries
WHERE id = sqlc.arg('id') AND meeting_id = sqlc.arg('meeting_id') AND organization_id = sqlc.arg('organization_id')
FOR UPDATE;

-- name: LockMeetingSummaryChanges :exec
-- Serializes a conversion with a new summary of the same meeting: both
-- CreateTasksFromSummary and the store of Summarize take this lock in their
-- transaction before they read or write the meeting's summaries, so the
-- conversion's re-read of the latest summary sees every summary committed
-- before it and none commits under it. Released at commit or rollback.
SELECT pg_advisory_xact_lock(hashtextextended('meeting_summary_tx:' || sqlc.arg(meeting_id)::text, 0));

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
