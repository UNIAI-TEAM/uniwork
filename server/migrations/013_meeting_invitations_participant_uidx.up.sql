CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uidx_meeting_invitations_participant ON meeting_invitations (participant_id);
