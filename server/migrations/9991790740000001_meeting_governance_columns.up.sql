-- Formal-meeting attendance (spec 2026-09-30 §3.1–3.2). No FKs (post-004 rule).
ALTER TABLE meeting_participants
  ADD COLUMN IF NOT EXISTS standing TEXT NOT NULL DEFAULT 'MEMBER',
  ADD COLUMN IF NOT EXISTS is_secretary BOOLEAN NOT NULL DEFAULT false;

-- Guests who got in through a link or an approval are observers by default.
UPDATE meeting_participants SET standing = 'OBSERVER' WHERE principal_type = 'GUEST';

ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS quorum_percent SMALLINT,
  ADD COLUMN IF NOT EXISTS attendance_finalized_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attendance_finalized_by TEXT;
