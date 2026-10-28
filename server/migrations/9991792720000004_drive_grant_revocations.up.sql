-- Global revocation queue keyed by Google account sub across all organizations
-- (UNI-2172, spec §5.3b, §6.8). Google OAuth grants belong to (OAuth client,
-- google_sub) rather than a single organization, so revocations coordinate
-- globally under a transaction advisory lock on drive_grant:<google_sub>.
-- Evidence timestamps (last_attempt_started_at, last_resolved_at) are never
-- cleared on upsert so an in-flight OAuth callback can detect an overlapping
-- revocation attempt across generations.
CREATE TABLE drive_grant_revocations (
  google_sub              TEXT PRIMARY KEY,
  generation              BIGINT NOT NULL DEFAULT 1,
  requested_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  refresh_token_enc       TEXT,
  attempt_id              TEXT,
  attempt_started_at      TIMESTAMPTZ,
  resolved_at             TIMESTAMPTZ,
  last_attempt_started_at TIMESTAMPTZ,
  last_resolved_at        TIMESTAMPTZ,
  attempts                INTEGER NOT NULL DEFAULT 0,
  last_error              TEXT NOT NULL DEFAULT '',

  CONSTRAINT drive_grant_revocations_sub_nonempty
    CHECK (google_sub <> ''),
  CONSTRAINT drive_grant_revocations_generation_positive
    CHECK (generation >= 1)
);
