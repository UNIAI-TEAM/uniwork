-- UNI-2012 S1b/S3: every live chat card of one document in an organization.
-- The server refreshes those cards when the document changes and counts them
-- before telling the owner a comment landed; without this the planner walks
-- every message of the organization. Partial on kind and deleted_at so the
-- index holds document cards only.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_messages_org_document_card
  ON chat_messages (organization_id, (metadata->>'document_id'))
  WHERE kind = 'document' AND deleted_at IS NULL;
