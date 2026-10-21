-- "Recent" reads what the caller opened (UNI-2045 SV-1): one aggregate over the
-- caller's own access-log rows in a workspace, grouped by document. This index
-- serves it as an index-only scan of just those rows; without it the
-- aggregate filters the organization's whole log (idx_document_access_logs_org_time).
-- Anonymous link rows have no actor and stay out (partial). One statement, its
-- own file: a concurrent build cannot run inside a transaction (CLAUDE.md).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_access_logs_actor ON document_access_logs (organization_id, actor_id, workspace_id, document_id, occurred_at DESC) WHERE actor_id IS NOT NULL;
