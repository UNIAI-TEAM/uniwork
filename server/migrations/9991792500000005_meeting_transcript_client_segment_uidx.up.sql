-- A segment the agent sends twice (a retried batch) is stored once.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uidx_meeting_transcript_client_segment
  ON meeting_transcript_segments (meeting_id, client_segment_id) WHERE client_segment_id IS NOT NULL;
