-- Multi-document zip download (UNI-2045 SV-9). One row per request: the
-- caller names up to 100 documents, the slow-lane consumer zips the files the
-- caller may still download at build time and keeps the zip in FileService
-- (purpose document_download) for one hour after it is ready.
--
-- status is queued | running | ready | failed; "expired" is never stored, the
-- read derives it from expires_at (the privacy export reads its window the
-- same way). skipped is the list of {document_id, reason} the build could not
-- put in the zip. file_id is cleared by the expiry release, which is what lets
-- the file collector see the unlink (DocumentDownloadReferenceProvider).
-- No FOREIGN KEY (migration lint): documents and files are joined in service
-- code.
CREATE TABLE document_download_jobs (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL,
  workspace_id     TEXT NOT NULL,
  created_by       TEXT NOT NULL,
  created_by_kind  TEXT NOT NULL DEFAULT 'human',
  status           TEXT NOT NULL DEFAULT 'queued',
  document_ids     TEXT[] NOT NULL,
  skipped          JSONB NOT NULL DEFAULT '[]'::jsonb,
  file_id          TEXT,
  file_count       INTEGER,
  error            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at       TIMESTAMPTZ,
  finished_at      TIMESTAMPTZ,
  expires_at       TIMESTAMPTZ,

  CONSTRAINT document_download_jobs_status_check
    CHECK (status IN ('queued', 'running', 'ready', 'failed')),
  CONSTRAINT document_download_jobs_created_by_kind_check
    CHECK (created_by_kind IN ('human', 'agent', 'system')),
  CONSTRAINT document_download_jobs_ids_nonempty
    CHECK (id <> '' AND organization_id <> '' AND workspace_id <> '' AND created_by <> '')
);
