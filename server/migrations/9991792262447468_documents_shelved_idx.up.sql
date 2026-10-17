-- ARCHIVE-01 (UNI-1845; addendum §1): the Archive list's keyset
-- (shelved_at DESC, id DESC) inside one workspace, live non-owned rows only -
-- the same predicates the shelved list query filters on. CONCURRENTLY, alone
-- in this file (ADR: indexes never share a migration).
CREATE INDEX CONCURRENTLY idx_documents_shelved
  ON documents (workspace_id, shelved_at DESC, id DESC)
  WHERE shelved_at IS NOT NULL AND archived_at IS NULL AND owner_id IS NULL;
