-- The voting roll: one row per eligible member, written when the item opens.
-- cast_at marks the vote; choice stays NULL for a secret ballot, so who voted
-- is known but never what they chose.
CREATE TABLE IF NOT EXISTS meeting_motion_ballots (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  meeting_id TEXT NOT NULL,
  motion_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  choice TEXT CHECK (choice IN ('YES', 'NO', 'ABSTAIN')),
  cast_at TIMESTAMPTZ
);
