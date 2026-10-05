-- Vote items of a formal meeting (spec 2026-09-30 §3.5–3.8). No FKs (post-004 rule).
-- The yes/no/abstain columns are the tally of record: a secret ballot never
-- stores a choice, so the counts here are the only place its result lives.
CREATE TABLE IF NOT EXISTS meeting_motions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  meeting_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL,
  ballot_mode TEXT NOT NULL CHECK (ballot_mode IN ('PUBLIC', 'SECRET')),
  threshold TEXT NOT NULL CHECK (threshold IN ('MAJORITY', 'TWO_THIRDS')),
  base TEXT NOT NULL CHECK (base IN ('PRESENT', 'ALL_MEMBERS')),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'OPEN', 'CLOSED')),
  total_members INTEGER,
  roll_size INTEGER,
  yes_count INTEGER NOT NULL DEFAULT 0,
  no_count INTEGER NOT NULL DEFAULT 0,
  abstain_count INTEGER NOT NULL DEFAULT 0,
  outcome TEXT CHECK (outcome IN ('PASSED', 'FAILED')),
  opened_at TIMESTAMPTZ,
  opened_by TEXT,
  closed_at TIMESTAMPTZ,
  closed_by TEXT,
  created_by TEXT NOT NULL,
  created_by_kind TEXT NOT NULL DEFAULT 'human' CHECK (created_by_kind IN ('human', 'agent', 'system')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INTEGER NOT NULL DEFAULT 1
);
