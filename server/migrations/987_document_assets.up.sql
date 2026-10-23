-- Page assets (C-01 §3.3 + §14.2; UNI-675): images pasted into a page. The
-- JSON references them as asset://{id}; the bytes live in FileService under
-- purpose document_asset. `orphaned_at` marks the moment content stopped
-- referencing the asset - the reference provider keeps the file for a 7-day
-- hold from that mark, then releases it.
CREATE TABLE document_assets (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL,
  workspace_id     TEXT NOT NULL,
  document_id      TEXT NOT NULL,
  file_id          TEXT NOT NULL,
  mime_type        TEXT NOT NULL,
  size_bytes       BIGINT NOT NULL,
  width            INTEGER,
  height           INTEGER,
  created_by       TEXT NOT NULL,
  created_by_kind  TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  orphaned_at      TIMESTAMPTZ,

  CONSTRAINT document_assets_created_by_kind_check
    CHECK (created_by_kind IN ('human', 'agent', 'system')),
  CONSTRAINT document_assets_size_bytes_nonneg
    CHECK (size_bytes >= 0)
);
