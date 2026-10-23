-- One live conversation per (organization, user, document, module) for the
-- document routes (A9). The predicate is document_id IS NOT NULL because a
-- liveness predicate cannot be an index predicate - now() is not IMMUTABLE -
-- and a NULL document is absent, not a value to compare: the org/session
-- route's single live conversation is enforced by Create, which deletes the
-- previous rows for its key in the same transaction (design §9.4).
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uidx_ai_uniwork_conversations_document_key
  ON ai_uniwork_conversations (organization_id, user_id, document_id, module)
  WHERE document_id IS NOT NULL;
