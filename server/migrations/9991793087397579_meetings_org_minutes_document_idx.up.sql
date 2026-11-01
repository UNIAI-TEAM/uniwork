-- UNI-2288 (RB1-4): partial index for the batched reverse lookup from
-- document IDs to their meetings (ListMinutesMeetingsByDocumentIDs).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meetings_org_minutes_document
  ON meetings (organization_id, minutes_document_id)
  WHERE minutes_document_id IS NOT NULL;
