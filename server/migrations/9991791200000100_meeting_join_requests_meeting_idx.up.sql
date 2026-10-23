-- G13 (UNI-936): ListJoinRequests, GetLatestJoinRequestFor{User,Guest} and
-- ExpirePendingJoinRequests (End/Cancel transaction) are keyed by meeting; the
-- pending-only unique indexes 016/017 cannot serve them.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_meeting_join_requests_meeting ON meeting_join_requests (meeting_id, requested_at DESC, id DESC);
