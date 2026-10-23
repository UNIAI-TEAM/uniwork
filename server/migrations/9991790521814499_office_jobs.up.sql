-- Office engine jobs (G2-02 / UNI-685). Go persists the row BEFORE it
-- dispatches to the engine service, so a Go or engine crash reconciles from
-- here plus the FileService provider-output intent (output_file_id comes from
-- RegisterProviderOutput). The engine never writes this table.
--
-- State machine (Go side): accepted -> running -> completed | failed |
-- timed_out | cancelled. Every transition is a compare-and-set on the state
-- column. failed, timed_out and cancelled are final. completed means the
-- output object is verified and staged, NOT that a Document version exists:
-- until committed_version_id is set by the G1-03 commit path a cancel may
-- still win, and a cancelled job's output is never committed.
--
-- No FK (ADR 0001): document, version and file relationships are checked in
-- service code.
CREATE TABLE office_jobs (
  id                  TEXT PRIMARY KEY,
  organization_id     TEXT NOT NULL,
  workspace_id        TEXT NOT NULL,
  document_id         TEXT NOT NULL,
  operation           TEXT NOT NULL,
  format              TEXT NOT NULL,
  base_revision       BIGINT NOT NULL,
  base_version_id     TEXT NOT NULL,
  idempotency_key     TEXT NOT NULL,
  payload_fingerprint TEXT NOT NULL,
  input_checksum      TEXT NOT NULL,
  input_length        BIGINT NOT NULL,
  grant_id            TEXT NOT NULL,
  output_file_id      TEXT,
  output_checksum     TEXT,
  output_length       BIGINT,
  state               TEXT NOT NULL DEFAULT 'accepted',
  error_code          TEXT,
  error_reason        TEXT,
  deadline_at         TIMESTAMPTZ NOT NULL,
  dispatched_at       TIMESTAMPTZ,
  finished_at         TIMESTAMPTZ,
  committed_version_id TEXT,
  created_by          TEXT NOT NULL,
  created_by_kind     TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT office_jobs_state_check
    CHECK (state IN ('accepted', 'running', 'completed', 'failed', 'timed_out', 'cancelled')),
  CONSTRAINT office_jobs_operation_check
    CHECK (operation IN ('open', 'edit', 'serialize', 'convert', 'export')),
  CONSTRAINT office_jobs_created_by_kind_check
    CHECK (created_by_kind IN ('human', 'agent', 'system')),
  CONSTRAINT office_jobs_committed_check
    CHECK (committed_version_id IS NULL OR state = 'completed')
);
