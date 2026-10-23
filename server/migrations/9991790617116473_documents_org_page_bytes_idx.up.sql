-- Storage quota read (CountStorageBytesInOrganization sums page content_bytes
-- per organization): index-only scan instead of a seq scan of documents.
-- G1-09 k6 evidence: 81-128 ms at 100k rows -> 25-49 ms warm with this index.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_org_page_bytes
  ON documents (organization_id, kind) INCLUDE (content_bytes);
