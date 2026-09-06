CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_org ON invoices (organization_id, created_at DESC);
