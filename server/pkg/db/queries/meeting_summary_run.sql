-- Single flight for AI meeting summaries (UNI-1853 M9). One summary run per
-- meeting at a time: the run claims a lease on the meeting in
-- meeting_summary_runs before it gathers the sources and asks the model, and
-- deletes it when it has stored the result or failed. A second run of the same
-- meeting, on any node, finds a live lease and is refused instead of paying
-- the model a second time. Each statement commits on its own, so no
-- connection is held while the model answers; a lease left by a crashed node
-- expires, and the next claim takes it over.

-- name: ClaimMeetingSummaryRun :one
-- No row back means another run holds a lease that has not expired.
INSERT INTO meeting_summary_runs (organization_id, meeting_id, run_id, expires_at)
VALUES (
  sqlc.arg(organization_id), sqlc.arg(meeting_id), sqlc.arg(run_id),
  now() + make_interval(secs => sqlc.arg(lease_seconds)::float8)
)
ON CONFLICT (organization_id, meeting_id) DO UPDATE
SET run_id = EXCLUDED.run_id, started_at = now(), expires_at = EXCLUDED.expires_at,
    failed_at = NULL, failure_code = ''
WHERE meeting_summary_runs.expires_at <= now()
RETURNING run_id;

-- name: ReleaseMeetingSummaryRun :exec
-- Only the run that holds the lease gives it back; a run whose lease expired
-- and was taken over deletes nothing.
DELETE FROM meeting_summary_runs
WHERE organization_id = sqlc.arg(organization_id) AND meeting_id = sqlc.arg(meeting_id) AND run_id = sqlc.arg(run_id);

-- name: FailMeetingSummaryRun :exec
-- A failed run gives its lease back and leaves its refusal code for the
-- panel (GET summary); only the run that holds the lease writes it.
UPDATE meeting_summary_runs
SET expires_at = now(), failed_at = now(), failure_code = sqlc.arg(failure_code)
WHERE organization_id = sqlc.arg(organization_id) AND meeting_id = sqlc.arg(meeting_id) AND run_id = sqlc.arg(run_id);

-- name: GetMeetingSummaryRunState :one
-- What the summary panel shows while no summary is stored yet (UNI-1995
-- benchmark #12): a run holding a live lease (a clerk's or the system's), and
-- the system's queued summary with when it is next due (a retry waits out its
-- backoff there); and the last run's failure while no run holds the lease.
SELECT
  (SELECT r.started_at FROM meeting_summary_runs r
    WHERE r.organization_id = sqlc.arg(organization_id) AND r.meeting_id = sqlc.arg(meeting_id) AND r.expires_at > now())::timestamptz AS running_since,
  (SELECT a.due_at FROM meeting_auto_summaries a
    WHERE a.organization_id = sqlc.arg(organization_id) AND a.meeting_id = sqlc.arg(meeting_id))::timestamptz AS queued_due_at,
  COALESCE((SELECT a.attempts FROM meeting_auto_summaries a
    WHERE a.organization_id = sqlc.arg(organization_id) AND a.meeting_id = sqlc.arg(meeting_id)), 0)::int AS attempts,
  (SELECT r.failed_at FROM meeting_summary_runs r
    WHERE r.organization_id = sqlc.arg(organization_id) AND r.meeting_id = sqlc.arg(meeting_id) AND r.expires_at <= now())::timestamptz AS failed_at,
  COALESCE((SELECT r.failure_code FROM meeting_summary_runs r
    WHERE r.organization_id = sqlc.arg(organization_id) AND r.meeting_id = sqlc.arg(meeting_id) AND r.expires_at <= now() AND r.failed_at IS NOT NULL), '')::text AS failure_code;
