-- Retention sweep and org-level audit listing (C-01 §3.6; UNI-675).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_access_logs_org_time
  ON document_access_logs (organization_id, occurred_at DESC);
