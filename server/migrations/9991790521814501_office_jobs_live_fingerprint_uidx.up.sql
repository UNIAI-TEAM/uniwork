-- At most one live job for the same work on the same base version (G2-02 /
-- UNI-685): a second key for an identical payload while the first job is
-- still accepted or running is refused as in_flight instead of spawning a
-- second job that could commit the same version.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uidx_office_jobs_live_fingerprint
  ON office_jobs (organization_id, workspace_id, document_id, base_version_id, payload_fingerprint)
  WHERE state IN ('accepted', 'running');
