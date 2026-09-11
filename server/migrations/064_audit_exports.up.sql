-- Job export nhật ký. File nằm trên storage; bảng chỉ giữ con trỏ và trạng
-- thái, nên xóa file không làm hỏng hàng. Trạng thái là timestamp (quy ước).
CREATE TABLE IF NOT EXISTS audit_exports (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  requested_by    TEXT NOT NULL,
  requested_by_kind TEXT NOT NULL DEFAULT 'human',
  format          TEXT NOT NULL,
  from_at         TIMESTAMPTZ NOT NULL,
  to_at           TIMESTAMPTZ NOT NULL,
  row_count       INTEGER NOT NULL DEFAULT 0,
  object_key      TEXT,
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  failed_at       TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ
);
