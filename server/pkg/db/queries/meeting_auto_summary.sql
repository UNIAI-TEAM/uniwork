-- The summary the system makes when a meeting ends (UNI-2026, spec
-- 2026-10-20-meeting-scribe-agent-design §4.5) and the organization switch
-- behind it (§6.2).

-- name: GetMeetingSettings :one
SELECT * FROM meeting_settings WHERE organization_id = sqlc.arg(organization_id);

-- name: UpsertMeetingSettings :one
INSERT INTO meeting_settings (organization_id, auto_summary_enabled, updated_by, updated_by_kind)
VALUES (sqlc.arg(organization_id), sqlc.arg(auto_summary_enabled), sqlc.arg(updated_by), sqlc.arg(updated_by_kind))
ON CONFLICT (organization_id) DO UPDATE
SET auto_summary_enabled = EXCLUDED.auto_summary_enabled,
    updated_by = EXCLUDED.updated_by,
    updated_by_kind = EXCLUDED.updated_by_kind,
    updated_at = now()
RETURNING *;

-- name: QueueMeetingAutoSummary :exec
-- A meeting ends once; a second queue of the same meeting changes nothing.
INSERT INTO meeting_auto_summaries (meeting_id, organization_id, due_at)
VALUES (sqlc.arg(meeting_id), sqlc.arg(organization_id), now() + make_interval(secs => sqlc.arg(after_seconds)::int))
ON CONFLICT (meeting_id) DO NOTHING;

-- name: HurryMeetingAutoSummary :exec
-- The agent reported /agent/finished: its last lines are in, so the summary
-- need not wait out the rest of its 90 s.
UPDATE meeting_auto_summaries SET due_at = LEAST(due_at, now())
WHERE organization_id = sqlc.arg(organization_id) AND meeting_id = sqlc.arg(meeting_id);

-- name: ClaimMeetingAutoSummary :one
-- tenant: system
-- The worker's claim: one due row nobody holds, leased for lease_seconds and
-- counted. No row back means nothing is due. The database's clock decides.
UPDATE meeting_auto_summaries
SET lease_until = now() + make_interval(secs => sqlc.arg(lease_seconds)::int), attempts = attempts + 1
WHERE meeting_id = (
  SELECT a.meeting_id FROM meeting_auto_summaries a
  WHERE a.due_at <= now() AND (a.lease_until IS NULL OR a.lease_until < now())
  ORDER BY a.due_at, a.meeting_id
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
RETURNING *;

-- name: DeleteMeetingAutoSummary :execrows
-- Only the holder of the lease settles the row; a run whose lease lapsed and
-- was taken over deletes nothing.
DELETE FROM meeting_auto_summaries
WHERE organization_id = sqlc.arg(organization_id) AND meeting_id = sqlc.arg(meeting_id)
  AND lease_until = sqlc.arg(lease_until);

-- name: MeetingAutoSummaryQueued :one
-- tenant: parent meeting_id
-- The summary nudge stays quiet while the system is still to summarize.
SELECT EXISTS (SELECT 1 FROM meeting_auto_summaries WHERE meeting_id = sqlc.arg(meeting_id))::boolean AS queued;
