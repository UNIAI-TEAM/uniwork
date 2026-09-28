-- Share links (C-01 §3.5; UNI-675): anonymous view links managed by the
-- "Chia sẻ" panel. The raw token never reaches the database - only its
-- SHA-256 hex hash is stored (compare against session tokens which hash the
-- secret the same way). Every link carries a mandatory expiry; the client
-- warns about the lifetime at create time.
CREATE TABLE document_share_links (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL,
  workspace_id     TEXT NOT NULL,
  document_id      TEXT NOT NULL,
  token_hash       TEXT NOT NULL,
  expires_at       TIMESTAMPTZ NOT NULL,
  view_count       INTEGER NOT NULL DEFAULT 0,
  last_viewed_at   TIMESTAMPTZ,
  created_by       TEXT NOT NULL,
  created_by_kind  TEXT NOT NULL,
  revoked_at       TIMESTAMPTZ,
  revoked_by       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT document_share_links_created_by_kind_check
    CHECK (created_by_kind IN ('human', 'agent', 'system'))
);
