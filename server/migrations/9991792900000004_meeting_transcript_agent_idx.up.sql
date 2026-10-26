-- TranscriptSources' has_agent: a captions-only meeting otherwise walks every
-- segment of the meeting on each transcript read to find no scribe line.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meeting_transcript_segments_agent
  ON meeting_transcript_segments (meeting_id) WHERE source = 'AGENT';
