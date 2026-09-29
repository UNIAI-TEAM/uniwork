-- Document versions (C-01 §3.2 + §14.2 + §14.3; UNI-675). A version is a
-- named/auto/restore/upload snapshot: a page version carries its sanitized
-- JSON, a file version points at its FileService `file_id` (no FK - the
-- blob, key and lifecycle belong to FileService, ADR 0024). mime_type,
-- size_bytes and checksum_sha256 are the snapshot taken at create time from
-- the ready files row, never from the client. engine_* / contract_version /
-- protocol_version record which build produced the bytes (NULL for pages
-- and straight uploads). Append-only from the service; nothing updates or
-- deletes a version except the document purge job.
CREATE TABLE document_versions (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL,
  workspace_id     TEXT NOT NULL,
  document_id      TEXT NOT NULL,
  version          INTEGER NOT NULL,
  kind             TEXT NOT NULL,
  reason           TEXT NOT NULL,
  label            TEXT,
  content          JSONB,
  file_id          TEXT,
  mime_type        TEXT,
  size_bytes       BIGINT NOT NULL DEFAULT 0,
  checksum_sha256  TEXT,
  restored_from    INTEGER,
  engine_name      TEXT,
  engine_version   TEXT,
  contract_version TEXT,
  protocol_version TEXT,
  created_by       TEXT NOT NULL,
  created_by_kind  TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT document_versions_kind_check
    CHECK (kind IN ('page', 'file')),
  CONSTRAINT document_versions_reason_check
    CHECK (reason IN ('manual', 'auto', 'restore', 'upload', 'agent')),
  CONSTRAINT document_versions_created_by_kind_check
    CHECK (created_by_kind IN ('human', 'agent', 'system')),
  CONSTRAINT document_versions_payload_check
    CHECK ((kind = 'page' AND content IS NOT NULL)
        OR (kind = 'file' AND file_id IS NOT NULL))
);
