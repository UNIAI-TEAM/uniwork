-- G13 (UNI-936): GetMeetingRecordingByEgressID and FinishRecordingByEgress
-- (recording_ended webhook) look a recording up by its egress id.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meeting_recordings_egress ON meeting_recordings (egress_id);
