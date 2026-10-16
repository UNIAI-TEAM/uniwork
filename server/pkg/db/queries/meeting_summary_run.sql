-- Single flight for AI meeting summaries (UNI-1853 M9). One summary run per
-- meeting at a time: the run takes a session advisory lock on its own pooled
-- connection before it gathers the sources and asks the model, and gives it
-- back when it has stored the result or failed. A second run of the same
-- meeting, on any node, finds the lock taken and is refused instead of paying
-- the model a second time. The lock lives in Postgres, so it holds across
-- every API node that shares the database; a crashed node's connection closes
-- and takes the lock with it.

-- name: MeetingSummaryTryRunLock :one
SELECT pg_try_advisory_lock(hashtextextended('meeting_summary:' || sqlc.arg(meeting_id)::text, 0)) AS locked;

-- name: MeetingSummaryRunUnlock :one
SELECT pg_advisory_unlock(hashtextextended('meeting_summary:' || sqlc.arg(meeting_id)::text, 0)) AS unlocked;
