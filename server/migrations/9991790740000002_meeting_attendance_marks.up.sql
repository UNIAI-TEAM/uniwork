-- One row per participant once a clerk marks them or attendance is finalized.
CREATE TABLE IF NOT EXISTS meeting_attendance_marks (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  meeting_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  status TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL,
  marked_by TEXT,
  marked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
