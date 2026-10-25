-- The transcript retention sweep (UNI-1995 #5) finds an organization's lines
-- older than its window by (organization_id, created_at).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meeting_transcript_org_created
  ON meeting_transcript_segments (organization_id, created_at);
