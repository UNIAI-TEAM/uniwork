-- GET /motions reads a participant's ballots by meeting, and closed public votes list their voters by meeting.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meeting_motion_ballots_meeting ON meeting_motion_ballots (meeting_id, participant_id);
