-- Durable coordination jobs for FileService workers (T1b; spec 2026-09-22
-- §4.3/§9.4). Cleanup, reconcile and abort_multipart live here with a lease
-- and a generation so two replicas never run the same work and a crashed
-- lease is retaken. Jobs are internal plumbing: the tenant column exists for
-- cleanup invariants and cross-checks, never as an authorization grant.
CREATE TABLE file_jobs (
  id               TEXT PRIMARY KEY,
  file_id          TEXT NOT NULL,
  organization_id  TEXT,
  operation        TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending',
  attempt          INTEGER NOT NULL DEFAULT 0,
  next_attempt_at  TIMESTAMPTZ NOT NULL,
  lease_owner      TEXT,
  lease_expires_at TIMESTAMPTZ,
  generation       INTEGER NOT NULL DEFAULT 0,
  error_code       TEXT,
  details          JSONB NOT NULL DEFAULT '{}'::jsonb,
  retain_until     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at      TIMESTAMPTZ,

  CONSTRAINT file_jobs_operation_check
    CHECK (operation IN ('cleanup', 'reconcile', 'abort_multipart')),
  CONSTRAINT file_jobs_status_check
    CHECK (status IN ('pending', 'leased', 'succeeded', 'failed', 'canceled')),
  CONSTRAINT file_jobs_file_id_nonempty
    CHECK (file_id <> ''),
  CONSTRAINT file_jobs_organization_id_nonempty
    CHECK (organization_id IS NULL OR organization_id <> ''),
  CONSTRAINT file_jobs_attempt_nonneg
    CHECK (attempt >= 0),
  CONSTRAINT file_jobs_generation_nonneg
    CHECK (generation >= 0),
  -- A lease exists exactly on the leased state: releasing a job back to
  -- pending clears the pair, so a stale lease can never outlive its state.
  CONSTRAINT file_jobs_lease_state
    CHECK ((status = 'leased' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
        OR (status <> 'leased' AND lease_owner IS NULL AND lease_expires_at IS NULL)),
  CONSTRAINT file_jobs_terminal_time
    CHECK ((status IN ('succeeded', 'failed', 'canceled')) = (finished_at IS NOT NULL)),
  CONSTRAINT file_jobs_details_object
    CHECK (jsonb_typeof(details) = 'object')
);

COMMENT ON TABLE file_jobs IS
  'FileService durable coordination jobs (cleanup, reconcile, abort_multipart) with lease ownership and generation fencing. Internal worker state; the organization_id copy aids cleanup invariants and cross-checks but is not an authorization grant.';
COMMENT ON COLUMN file_jobs.id IS
  'Opaque job id (ULID).';
COMMENT ON COLUMN file_jobs.file_id IS
  'File the job operates on.';
COMMENT ON COLUMN file_jobs.organization_id IS
  'Tenant of the file at enqueue time, denormalized for org-scoped cleanup queries. NULL when the target file is on the user_avatar branch (ADR 0023).';
COMMENT ON COLUMN file_jobs.operation IS
  'cleanup = remove unreferenced bytes + row; reconcile = verify object presence, visibility and size and fix drift; abort_multipart = cancel an interrupted multipart upload before it can leak object parts.';
COMMENT ON COLUMN file_jobs.status IS
  'pending -> leased -> succeeded | failed | canceled. A failure never drops the retry intent: the row returns to pending with a later next_attempt_at and the daily scan picks it up again.';
COMMENT ON COLUMN file_jobs.attempt IS
  'Number of completed attempts; incremented on each terminal outcome. Alerting watches count/age, retry never stops on it alone.';
COMMENT ON COLUMN file_jobs.next_attempt_at IS
  'Earliest time the job may be leased again. Retried failures land on the next daily scan.';
COMMENT ON COLUMN file_jobs.lease_owner IS
  'Worker instance holding the job right now; set with lease_expires_at on claim, cleared on release or lease expiry.';
COMMENT ON COLUMN file_jobs.lease_expires_at IS
  'Lease expiry. Another replica may retake the job only after this passes.';
COMMENT ON COLUMN file_jobs.generation IS
  'Bumped on every lease takeover so a stale worker finishing late is refused (fencing, spec 9.4).';
COMMENT ON COLUMN file_jobs.error_code IS
  'Last failure code (storage_unavailable, file_deleting, ...) for operators and reconcile.';
COMMENT ON COLUMN file_jobs.details IS
  'Operation-scoped payload: e.g. multipart upload_id + part keys for abort_multipart, object locator snapshot for reconcile.';
COMMENT ON COLUMN file_jobs.retain_until IS
  'How long a terminal row is kept for audit and reconcile before it may be pruned.';
COMMENT ON COLUMN file_jobs.created_at IS
  'Enqueue time.';
COMMENT ON COLUMN file_jobs.updated_at IS
  'Last write to the job row.';
COMMENT ON COLUMN file_jobs.finished_at IS
  'Terminal mark: set exactly when the job turns succeeded, failed or canceled; NULL while pending or leased.';
