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
SET run_id = EXCLUDED.run_id, started_at = now(), expires_at = EXCLUDED.expires_at
WHERE meeting_summary_runs.expires_at <= now()
RETURNING run_id;

-- name: ReleaseMeetingSummaryRun :exec
-- Only the run that holds the lease gives it back; a run whose lease expired
-- and was taken over deletes nothing.
DELETE FROM meeting_summary_runs
WHERE organization_id = sqlc.arg(organization_id) AND meeting_id = sqlc.arg(meeting_id) AND run_id = sqlc.arg(run_id);
