CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uidx_meeting_motion_ballots_participant ON meeting_motion_ballots (motion_id, participant_id);
