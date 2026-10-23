-- One row per meeting the starting-soon reminder has gone out for. The
-- reminder job inserts it in the same transaction as the meeting's
-- notifications, so a meeting is reminded exactly once even when two pods
-- tick together (the primary key is the claim), and a tick that fails
-- rolls the claim back with the notifications and retries next minute.
-- A table of its own rather than a column on meetings keeps the claim from
-- locking the meeting row and keeps the meetings model unchanged.
CREATE TABLE IF NOT EXISTS meeting_reminders (
  meeting_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  reminded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
