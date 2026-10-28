-- Templates (UNI-2225): a partial index that narrows the template list to the
-- marked, live, non-owned files of one workspace. The list orders by recent
-- update, not by this key. CONCURRENTLY, alone in this file (ADR: indexes
-- never share a migration).
CREATE INDEX CONCURRENTLY idx_documents_template
  ON documents (workspace_id, template_marked_at DESC, id DESC)
  WHERE template_marked_at IS NOT NULL AND archived_at IS NULL AND owner_id IS NULL;
