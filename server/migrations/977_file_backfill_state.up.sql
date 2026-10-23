-- FileService backfill state (T9b, UNI-747; placeholder number — the Advisor
-- renumbers at merge). Bookkeeping for the files-backfill command: one run
-- row per apply invocation, one item row per source record it classified,
-- and one checkpoint row per (run, cohort) so a crashed run resumes by
-- keyset cursor. These are infrastructure tables: the tenant an item affects
-- is data inside the row, not a scope the table enforces, so they carry no
-- business organization_id and are exempted in lint_test.go. No FKs
-- (post-004 rule): the command cleans its own rows.

CREATE TABLE IF NOT EXISTS file_backfill_runs (
  id          TEXT PRIMARY KEY,
  command     TEXT NOT NULL,
  config      JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(config) = 'object'),
  status      TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'rolled_back')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

COMMENT ON TABLE file_backfill_runs IS
  'files-backfill invocations: the run id is the resume token; config records cohorts/batch size/destination fingerprint.';

CREATE TABLE IF NOT EXISTS file_backfill_checkpoints (
  run_id     TEXT NOT NULL,
  cohort     TEXT NOT NULL,
  cursor     TEXT NOT NULL DEFAULT '',
  seen       BIGINT NOT NULL DEFAULT 0,
  applied    BIGINT NOT NULL DEFAULT 0,
  skipped    BIGINT NOT NULL DEFAULT 0,
  held       BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, cohort)
);

COMMENT ON TABLE file_backfill_checkpoints IS
  'Per-cohort keyset cursor + counters; committed in the same transaction as the batch it describes, so a crash never advances past unwritten work.';

CREATE TABLE IF NOT EXISTS file_backfill_items (
  run_id           TEXT NOT NULL,
  cohort           TEXT NOT NULL,
  source_table     TEXT NOT NULL,
  source_id        TEXT NOT NULL,
  file_id          TEXT,
  storage          TEXT,
  bucket           TEXT,
  object_key       TEXT,
  object_version   TEXT,
  organization_id  TEXT,
  status           TEXT NOT NULL,
  reason           TEXT NOT NULL DEFAULT '',
  previous_locator TEXT,
  details          JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, cohort, source_table, source_id)
);

COMMENT ON TABLE file_backfill_items IS
  'Per-source-row outcome: status is verified/applied/already_applied/unresolved/held/foreign/skipped; previous_locator preserves the as-was locator for rollback. The mapping report is derivable from this table.';
COMMENT ON COLUMN file_backfill_items.organization_id IS
  'Tenant the mapping resolved for this item (NULL for the avatar identity scope and for rows that never resolved). It records a fact about the source row; the table itself is not tenant-scoped.';
