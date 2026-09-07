-- Một dòng mỗi organization; thiếu dòng = mặc định của service (90 ngày).
CREATE TABLE IF NOT EXISTS audit_retention_policies (
  organization_id TEXT PRIMARY KEY,
  retain_days     INTEGER NOT NULL,
  updated_by      TEXT NOT NULL,
  updated_by_kind TEXT NOT NULL DEFAULT 'human',
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
