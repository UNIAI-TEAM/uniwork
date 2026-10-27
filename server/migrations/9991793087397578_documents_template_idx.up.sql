-- Templates (UNI-2225): the template list's keyset
-- (template_marked_at DESC, id DESC) inside one workspace, live non-owned
-- rows only. CONCURRENTLY, alone in this file (ADR: indexes never share a
-- migration).
CREATE INDEX CONCURRENTLY idx_documents_template
  ON documents (workspace_id, template_marked_at DESC, id DESC)
  WHERE template_marked_at IS NOT NULL AND archived_at IS NULL AND owner_id IS NULL;
