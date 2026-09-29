-- Access log (C-01 §3.6 + §13.4; UNI-675): every view, download, export and
-- link view on a document or a specific version, written in a separate
-- transaction like audit_log - the access succeeds even if logging fails.
-- `via` names the access path; 'owner' covers the §13 owner-delegated level
-- that the member/share/link paths cannot express. Kept for 90 days for
-- "Ai đã xem tài liệu này".
CREATE TABLE document_access_logs (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL,
  workspace_id     TEXT NOT NULL,
  document_id      TEXT NOT NULL,
  version          INTEGER,
  action           TEXT NOT NULL,
  actor_kind       TEXT NOT NULL,
  actor_id         TEXT,
  via              TEXT NOT NULL,
  share_link_id    TEXT,
  correlation_id   TEXT NOT NULL,
  occurred_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT document_access_logs_action_check
    CHECK (action IN ('view', 'download', 'export', 'link_view')),
  CONSTRAINT document_access_logs_via_check
    CHECK (via IN ('member', 'share', 'link', 'owner', 'ai_context')),
  CONSTRAINT document_access_logs_actor_kind_check
    CHECK (actor_kind IN ('human', 'agent', 'system', 'anonymous'))
);
