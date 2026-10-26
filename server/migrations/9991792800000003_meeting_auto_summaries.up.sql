-- The auto summary queue (UNI-2026, spec 2026-10-20-meeting-scribe-agent-design
-- §4.5). A meeting that turns ENDED gets one row in the same transaction, due
-- 10 s later (90 s while a scribe run was still open, sooner once the agent
-- reports /agent/finished). The meeting worker claims a due row with SKIP
-- LOCKED and a lease, runs SummarizeAuto and deletes the row: a server that
-- restarts finds the row again, a node that dies mid-run lets the lease lapse
-- and another node retries, up to a few attempts. Off the outbox because one
-- summary can outlive an outbox delivery. The table only holds meetings in
-- flight, so the primary key is its only index. No FK (post-004 rule).
CREATE TABLE IF NOT EXISTS meeting_auto_summaries (
  meeting_id       TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL,
  due_at           TIMESTAMPTZ NOT NULL,
  attempts         INT NOT NULL DEFAULT 0,
  lease_until      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
