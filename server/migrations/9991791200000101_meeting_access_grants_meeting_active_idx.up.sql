-- G13 (UNI-936): RevokeGrantsForMeeting runs inside the End/Cancel
-- transaction while the meeting row is locked. Only ACTIVE grants are revoked,
-- so the index holds only those.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meeting_access_grants_meeting_active ON meeting_access_grants (meeting_id) WHERE status = 'ACTIVE';
