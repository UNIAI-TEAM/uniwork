-- name: CreateMeetingParticipant :one
-- A guest starts as an observer on every path that creates one (invite link,
-- join approval); a user starts as a member.
INSERT INTO meeting_participants (
  id, meeting_id, principal_type, user_id, guest_id, display_name_snapshot, email_snapshot,
  role, status, source_type, source_id, added_by, standing, organization_id
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, 'ACTIVE', $9, $10, $11,
  CASE WHEN $3 = 'GUEST' THEN 'OBSERVER' ELSE 'MEMBER' END, $12
)
RETURNING *;

-- name: GetMeetingParticipant :one
SELECT * FROM meeting_participants WHERE id = $1;

-- name: ListMeetingParticipants :many
SELECT * FROM meeting_participants WHERE meeting_id = $1 ORDER BY added_at;

-- name: GetActiveUserParticipant :one
SELECT * FROM meeting_participants
WHERE meeting_id = $1 AND principal_type = 'USER' AND user_id = $2 AND status = 'ACTIVE';

-- name: GetActiveGuestParticipant :one
SELECT * FROM meeting_participants
WHERE meeting_id = $1 AND principal_type = 'GUEST' AND guest_id = $2 AND status = 'ACTIVE';

-- name: GetUserParticipantAnyStatus :one
SELECT * FROM meeting_participants
WHERE meeting_id = $1 AND principal_type = 'USER' AND user_id = $2
ORDER BY added_at DESC
LIMIT 1;

-- name: GetGuestParticipantAnyStatus :one
SELECT * FROM meeting_participants
WHERE meeting_id = $1 AND principal_type = 'GUEST' AND guest_id = $2
ORDER BY added_at DESC
LIMIT 1;

-- name: RemoveMeetingParticipant :one
UPDATE meeting_participants SET
  status = 'REMOVED',
  removed_by = $2,
  removed_at = now(),
  remove_reason = $3
WHERE id = $1 AND status = 'ACTIVE'
RETURNING *;

-- name: CreateMeetingInvitation :one
INSERT INTO meeting_invitations (
  id, meeting_id, participant_id, response_status, invited_by, organization_id
) VALUES ($1, $2, $3, 'PENDING', $4, $5)
RETURNING *;

-- name: GetMeetingInvitation :one
SELECT * FROM meeting_invitations WHERE id = $1;

-- name: GetInvitationByParticipant :one
SELECT * FROM meeting_invitations WHERE participant_id = $1;

-- name: ListMeetingInvitations :many
SELECT * FROM meeting_invitations WHERE meeting_id = $1 ORDER BY invited_at;

-- name: UpdateInvitationResponse :one
UPDATE meeting_invitations SET
  response_status = $2,
  responded_at = now()
WHERE id = $1
RETURNING *;

-- name: CreateAccessGrant :one
INSERT INTO meeting_access_grants (
  id, meeting_id, participant_id, source_type, source_id, status, valid_from, expires_at, granted_by, organization_id
) VALUES ($1, $2, $3, $4, $5, 'ACTIVE', now(), $6, $7, $8)
RETURNING *;

-- name: ListActiveGrantsForParticipant :many
SELECT * FROM meeting_access_grants
WHERE participant_id = $1 AND status = 'ACTIVE'
  AND (expires_at IS NULL OR expires_at > now());

-- name: RevokeGrantsForParticipant :exec
UPDATE meeting_access_grants SET
  status = 'REVOKED',
  revoked_by = $2,
  revoked_at = now(),
  revoke_reason = $3
WHERE participant_id = $1 AND status = 'ACTIVE';

-- name: RevokeGrantsForMeeting :exec
UPDATE meeting_access_grants SET
  status = 'REVOKED',
  revoked_by = $2,
  revoked_at = now(),
  revoke_reason = $3
WHERE meeting_id = $1 AND status = 'ACTIVE';

-- name: RevokeGrantsByInviteLink :exec
UPDATE meeting_access_grants SET
  status = 'REVOKED',
  revoked_by = $2,
  revoked_at = now(),
  revoke_reason = 'invite_link_revoked'
WHERE source_type = 'INVITE_LINK' AND source_id = $1 AND status = 'ACTIVE';

-- name: CreateInviteLink :one
INSERT INTO meeting_invite_links (
  id, meeting_id, name, secret_hash, access_mode, expires_at, max_uses, created_by, organization_id
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
RETURNING *;

-- name: GetInviteLink :one
SELECT * FROM meeting_invite_links WHERE id = $1;

-- name: ListInviteLinks :many
SELECT * FROM meeting_invite_links WHERE meeting_id = $1 ORDER BY created_at DESC;

-- name: RevokeInviteLink :one
UPDATE meeting_invite_links SET
  revoked_by = $2,
  revoked_at = now()
WHERE id = $1 AND revoked_at IS NULL
RETURNING *;

-- name: ConsumeInviteLinkUse :one
UPDATE meeting_invite_links SET used_count = used_count + 1
WHERE id = $1
  AND revoked_at IS NULL
  AND expires_at > now()
  AND (max_uses IS NULL OR used_count < max_uses)
RETURNING *;

-- name: CreateJoinRequest :one
INSERT INTO meeting_join_requests (
  id, meeting_id, requester_user_id, requester_guest_id, display_name_snapshot, invite_link_id, status, expires_at,
  organization_id
) VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', $7, $8)
RETURNING *;

-- name: GetJoinRequest :one
SELECT * FROM meeting_join_requests WHERE id = $1;

-- name: GetPendingJoinRequestForUser :one
SELECT * FROM meeting_join_requests
WHERE meeting_id = $1 AND requester_user_id = $2 AND status = 'PENDING';

-- name: GetPendingJoinRequestForGuest :one
SELECT * FROM meeting_join_requests
WHERE meeting_id = $1 AND requester_guest_id = $2 AND status = 'PENDING';

-- name: GetLatestJoinRequestForUser :one
SELECT * FROM meeting_join_requests
WHERE meeting_id = $1 AND requester_user_id = $2
ORDER BY requested_at DESC, id DESC
LIMIT 1;

-- name: GetLatestJoinRequestForGuest :one
SELECT * FROM meeting_join_requests
WHERE meeting_id = $1 AND requester_guest_id = $2
ORDER BY requested_at DESC, id DESC
LIMIT 1;

-- name: ListJoinRequests :many
SELECT * FROM meeting_join_requests WHERE meeting_id = $1 ORDER BY requested_at DESC;

-- name: ListPendingJoinRequests :many
SELECT * FROM meeting_join_requests WHERE meeting_id = $1 AND status = 'PENDING' ORDER BY requested_at;

-- name: DecideJoinRequest :one
UPDATE meeting_join_requests SET
  status = $2,
  reviewed_by = $3,
  reviewed_at = now(),
  decision_reason = $4
WHERE id = $1 AND status = 'PENDING'
RETURNING *;

-- name: CancelJoinRequest :one
UPDATE meeting_join_requests SET
  status = 'CANCELED',
  reviewed_at = now()
WHERE id = $1 AND status = 'PENDING'
RETURNING *;

-- name: ExpirePendingJoinRequests :exec
UPDATE meeting_join_requests SET status = 'EXPIRED', reviewed_at = now()
WHERE meeting_id = $1 AND status = 'PENDING';

-- name: CreateConferenceSession :one
INSERT INTO meeting_conference_sessions (
  id, meeting_id, provider_key, provider_room_name, status, provider_sync_status, organization_id
) VALUES ($1, $2, $3, $4, 'PENDING', 'PENDING', $5)
RETURNING *;

-- name: GetOpenConferenceSession :one
SELECT * FROM meeting_conference_sessions
WHERE meeting_id = $1 AND status <> 'ENDED' AND status <> 'FAILED'
ORDER BY created_at DESC
LIMIT 1;

-- name: GetConferenceSession :one
SELECT * FROM meeting_conference_sessions WHERE id = $1;

-- name: UpdateConferenceSessionStatus :one
UPDATE meeting_conference_sessions SET
  status = COALESCE(sqlc.narg('status'), status),
  provider_sync_status = COALESCE(sqlc.narg('provider_sync_status'), provider_sync_status),
  provider_room_sid = COALESCE(sqlc.narg('provider_room_sid'), provider_room_sid),
  started_at = COALESCE(sqlc.narg('started_at'), started_at),
  ended_at = COALESCE(sqlc.narg('ended_at'), ended_at),
  updated_at = now()
WHERE id = sqlc.arg('id')
RETURNING *;

-- name: MarkConferenceSessionResyncing :one
-- Claims an IDLE session for one re-ensure. The WHERE clause is the lock that
-- keeps concurrent joins from queueing the same instruction twice.
UPDATE meeting_conference_sessions SET
  provider_sync_status = 'PENDING',
  updated_at = now()
WHERE id = $1 AND status = 'IDLE' AND provider_sync_status = 'SYNCED'
RETURNING *;

-- name: EndConferenceSession :one
UPDATE meeting_conference_sessions SET
  status = 'ENDED',
  ended_at = now(),
  updated_at = now()
WHERE id = $1 AND status <> 'ENDED'
RETURNING *;

-- name: InsertAuditLog :exec
INSERT INTO meeting_audit_logs (
  id, meeting_id, event_type, actor_type, actor_id, target_type, target_id,
  from_state, to_state, payload, request_id, ip_address, user_agent, occurred_at, organization_id
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now(), $14);

-- name: ListMeetingAuditLogs :many
SELECT * FROM meeting_audit_logs WHERE meeting_id = $1 ORDER BY occurred_at DESC LIMIT $2 OFFSET $3;

-- name: ReleaseStaleOutboxClaims :exec
UPDATE outbox_events SET
  status = 'PENDING',
  locked_by = NULL,
  locked_at = NULL,
  locked_until = NULL,
  updated_at = now()
WHERE status = 'PROCESSING'
  AND locked_until IS NOT NULL
  AND locked_until < now();

-- name: ClaimPendingOutbox :many
UPDATE outbox_events SET
  status = 'PROCESSING',
  locked_by = sqlc.arg('locked_by'),
  locked_at = now(),
  locked_until = now() + make_interval(secs => sqlc.arg('lease_seconds')::double precision),
  updated_at = now()
WHERE id IN (
  SELECT id FROM outbox_events
  WHERE status = 'PENDING' AND available_at <= now()
  ORDER BY created_at
  LIMIT sqlc.arg('limit_n')
  FOR UPDATE SKIP LOCKED
)
RETURNING *;

-- name: ListPendingOutbox :many
SELECT * FROM outbox_events
WHERE status = 'PENDING' AND available_at <= now()
ORDER BY created_at
LIMIT $1
FOR UPDATE SKIP LOCKED;

-- name: MarkOutboxDone :exec
UPDATE outbox_events SET
  status = 'DONE',
  completed_at = now(),
  locked_by = NULL,
  locked_at = NULL,
  locked_until = NULL,
  updated_at = now()
WHERE id = $1;

-- name: MarkOutboxFailed :exec
UPDATE outbox_events SET
  attempts = attempts + 1,
  last_error = $2,
  available_at = $3,
  status = $4,
  locked_by = NULL,
  locked_at = NULL,
  locked_until = NULL,
  updated_at = now()
WHERE id = $1;

-- name: CloseOpenAttendanceForConference :many
UPDATE meeting_attendance_sessions SET
  left_at = GREATEST(joined_at, now()),
  leave_reason = $2
WHERE conference_session_id = $1 AND left_at IS NULL
RETURNING *;

-- name: CloseOpenAttendanceForMeeting :many
-- Closes every open room session of a meeting. left_at caps the close time —
-- the meeting's actual_end_at once it has ended — so a late sweep never
-- stretches a session past the end; NULL closes at now(). A session never
-- closes before it opened.
UPDATE meeting_attendance_sessions SET
  left_at = GREATEST(joined_at, LEAST(now(), COALESCE(sqlc.narg('left_at')::timestamptz, now()))),
  leave_reason = sqlc.arg('leave_reason')
WHERE meeting_id = sqlc.arg('meeting_id') AND left_at IS NULL
RETURNING *;

-- name: ListEndedMeetingsWithOpenAttendance :many
SELECT DISTINCT m.id FROM meetings m
JOIN meeting_attendance_sessions a ON a.meeting_id = m.id
WHERE m.status IN ('ENDED', 'CANCELED') AND a.left_at IS NULL
LIMIT $1;

-- name: InsertWebhookInbox :execrows
INSERT INTO webhook_inbox (id, provider, provider_event_id, event_type, payload, status, next_attempt_at)
VALUES ($1, $2, $3, $4, $5, 'PENDING', now())
ON CONFLICT (provider, provider_event_id) DO NOTHING;

-- name: ClaimPendingWebhookInbox :many
UPDATE webhook_inbox SET
  status = 'PROCESSING',
  next_attempt_at = now() + make_interval(secs => sqlc.arg('lease_seconds')::double precision)
WHERE id IN (
  SELECT id FROM webhook_inbox
  WHERE status = 'PENDING' AND next_attempt_at <= now()
  ORDER BY received_at
  LIMIT sqlc.arg('limit_n')
  FOR UPDATE SKIP LOCKED
)
RETURNING *;

-- name: ReleaseStaleWebhookInbox :exec
UPDATE webhook_inbox SET
  status = 'PENDING',
  next_attempt_at = now()
WHERE status = 'PROCESSING' AND next_attempt_at < now();

-- name: MarkWebhookInboxDone :exec
UPDATE webhook_inbox SET
  status = 'DONE',
  processed_at = now(),
  last_error = NULL
WHERE id = $1;

-- name: MarkWebhookInboxFailed :exec
UPDATE webhook_inbox SET
  attempt_count = attempt_count + 1,
  last_error = $2,
  next_attempt_at = $3,
  status = $4
WHERE id = $1;

-- name: CreateMeetingGuest :one
INSERT INTO meeting_guests (id) VALUES ($1) RETURNING *;

-- name: GetMeetingGuest :one
SELECT * FROM meeting_guests WHERE id = $1;

-- name: InsertProviderEvent :execrows
INSERT INTO meeting_provider_events (id, provider_key, provider_event_id)
VALUES ($1, $2, $3)
ON CONFLICT DO NOTHING;

-- name: OpenAttendanceSession :one
-- joined_at is the provider's event time when it sent one, never in the
-- future; NULL means now().
INSERT INTO meeting_attendance_sessions (
  id, meeting_id, conference_session_id, participant_id, provider_participant_identity, joined_at, provider_event_id,
  provider_participant_sid, organization_id
) VALUES (
  sqlc.arg('id'), sqlc.arg('meeting_id'), sqlc.arg('conference_session_id'), sqlc.arg('participant_id'),
  sqlc.arg('provider_participant_identity'),
  LEAST(now(), COALESCE(sqlc.narg('joined_at')::timestamptz, now())),
  sqlc.narg('provider_event_id'), sqlc.narg('provider_participant_sid'), sqlc.arg('organization_id')
)
ON CONFLICT (participant_id) WHERE left_at IS NULL DO UPDATE SET
  provider_event_id = COALESCE(meeting_attendance_sessions.provider_event_id, EXCLUDED.provider_event_id)
RETURNING *;

-- name: OutboxOldestPendingAgeSeconds :one
SELECT COALESCE(EXTRACT(EPOCH FROM (now() - min(created_at))), 0)::float8 AS age_seconds
FROM outbox_events
WHERE status IN ('PENDING', 'PROCESSING');

-- name: WebhookInboxOldestPendingAgeSeconds :one
SELECT COALESCE(EXTRACT(EPOCH FROM (now() - min(received_at))), 0)::float8 AS age_seconds
FROM webhook_inbox
WHERE status IN ('PENDING', 'PROCESSING');

-- name: ListInProgressMeetingsWithIdleSession :many
SELECT m.id FROM meetings m
WHERE m.status = 'IN_PROGRESS'
  AND EXISTS (
    SELECT 1 FROM meeting_conference_sessions s
    WHERE s.meeting_id = m.id AND s.status = 'IDLE' AND s.ended_at IS NOT NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM meeting_conference_sessions s2
    WHERE s2.meeting_id = m.id AND s2.status IN ('PENDING', 'READY', 'ACTIVE')
  )
LIMIT $1;

-- name: LockOpenAttendance :one
-- The participant's open room session, locked so a join that replaces it and
-- a leave that closes it take turns.
SELECT * FROM meeting_attendance_sessions
WHERE participant_id = $1 AND left_at IS NULL
ORDER BY joined_at DESC
LIMIT 1
FOR UPDATE;

-- name: LockRoomSessionsOfParticipant :exec
-- Serializes the join and leave webhooks of one participant (across workers
-- too): with no open session there is no row to lock, and two joins would
-- otherwise both insert.
SELECT pg_advisory_xact_lock(hashtextextended('meeting_attendance_sessions:' || sqlc.arg(participant_id)::text, 0));

-- name: ShareLockMeetingStatus :one
-- The meeting's status, share-locked so End (which updates the row, then
-- closes every open room session) cannot interleave with a join: a join
-- either commits before End's close or sees the meeting ENDED.
SELECT status FROM meetings WHERE id = $1 FOR SHARE;

-- name: AttendanceConnectionSeen :one
-- Whether one provider connection (SID) of a participant already has a room
-- session, open or closed: its join was handled, or its leave came first.
SELECT EXISTS (
  SELECT 1 FROM meeting_attendance_sessions
  WHERE meeting_id = sqlc.arg('meeting_id') AND participant_id = sqlc.arg('participant_id')
    AND provider_participant_sid = sqlc.arg('provider_participant_sid')
)::bool;

-- name: BackdateConnectionJoin :many
-- A join that arrives after its connection's session was already recorded
-- (its leave came first and wrote a zero-length session at the leave time)
-- moves that session's start back to the join's time, so first-join and
-- minutes present are right. A duplicate join (same time) changes nothing.
UPDATE meeting_attendance_sessions SET joined_at = sqlc.arg('joined_at')::timestamptz
WHERE meeting_id = sqlc.arg('meeting_id') AND participant_id = sqlc.arg('participant_id')
  AND provider_participant_sid = sqlc.arg('provider_participant_sid')
  AND joined_at > sqlc.arg('joined_at')::timestamptz
RETURNING *;

-- name: InsertClosedAttendanceSession :one
-- A session known only after it ended: a leave that arrived before its own
-- join (recorded so the late join opens nothing), or an older connection
-- whose join arrived after the newer one's. Times are clamped like the open
-- and close queries: never in the future, never closing before opening.
INSERT INTO meeting_attendance_sessions (
  id, meeting_id, conference_session_id, participant_id, provider_participant_identity,
  joined_at, left_at, leave_reason, provider_event_id, provider_participant_sid, organization_id
) VALUES (
  sqlc.arg('id'), sqlc.arg('meeting_id'), sqlc.arg('conference_session_id'), sqlc.arg('participant_id'),
  sqlc.arg('provider_participant_identity'),
  LEAST(now(), COALESCE(sqlc.narg('joined_at')::timestamptz, now())),
  GREATEST(
    LEAST(now(), COALESCE(sqlc.narg('joined_at')::timestamptz, now())),
    LEAST(now(), COALESCE(sqlc.narg('left_at')::timestamptz, now()))
  ),
  sqlc.narg('leave_reason'), sqlc.narg('provider_event_id'), sqlc.narg('provider_participant_sid'),
  sqlc.arg('organization_id')
)
RETURNING *;

-- name: CloseAttendanceSession :one
-- left_at is the provider's event time when it sent one, clamped to
-- [joined_at, now()]; NULL means now().
UPDATE meeting_attendance_sessions SET
  left_at = GREATEST(joined_at, LEAST(now(), COALESCE(sqlc.narg('left_at')::timestamptz, now()))),
  leave_reason = sqlc.arg('leave_reason')
WHERE id = sqlc.arg('id') AND left_at IS NULL
RETURNING *;

-- name: CountUniqueAttendees :one
SELECT count(DISTINCT participant_id)::bigint FROM meeting_attendance_sessions WHERE meeting_id = $1;

-- name: InvitationResponseBreakdown :one
SELECT
  count(*) FILTER (WHERE response_status = 'PENDING')::bigint AS pending,
  count(*) FILTER (WHERE response_status = 'ACCEPTED')::bigint AS accepted,
  count(*) FILTER (WHERE response_status = 'DECLINED')::bigint AS declined,
  count(*) FILTER (WHERE response_status = 'TENTATIVE')::bigint AS tentative
FROM meeting_invitations i
JOIN meetings m ON m.id = i.meeting_id
WHERE m.workspace_id = $1;

-- name: JoinRequestStats :one
SELECT
  count(*)::bigint AS total,
  count(*) FILTER (WHERE jr.status = 'APPROVED')::bigint AS approved,
  count(*) FILTER (WHERE jr.status = 'REJECTED')::bigint AS rejected,
  COALESCE(avg(EXTRACT(EPOCH FROM (jr.reviewed_at - jr.requested_at))) FILTER (WHERE jr.status = 'APPROVED' AND jr.reviewed_at IS NOT NULL), 0)::float8 AS avg_approval_seconds
FROM meeting_join_requests jr
JOIN meetings m ON m.id = jr.meeting_id
WHERE m.workspace_id = $1;

-- name: InviteLinkStats :one
SELECT
  count(*)::bigint AS created,
  COALESCE(sum(used_count), 0)::bigint AS used,
  count(*) FILTER (WHERE revoked_at IS NOT NULL)::bigint AS revoked,
  count(*) FILTER (WHERE revoked_at IS NULL AND expires_at <= now())::bigint AS expired
FROM meeting_invite_links l
JOIN meetings m ON m.id = l.meeting_id
WHERE m.workspace_id = $1;

-- name: MeetingListStats :one
SELECT
  (SELECT count(*) FROM meeting_participants p WHERE p.meeting_id = $1)::bigint AS invited_count,
  (SELECT count(*) FROM meeting_invitations i WHERE i.meeting_id = $1 AND i.response_status = 'ACCEPTED')::bigint AS accepted_count,
  (SELECT count(DISTINCT a.participant_id) FROM meeting_attendance_sessions a WHERE a.meeting_id = $1)::bigint AS attended_count,
  (SELECT count(*) FROM meeting_join_requests j WHERE j.meeting_id = $1)::bigint AS join_request_count,
  (SELECT count(*) FROM meeting_join_requests j WHERE j.meeting_id = $1 AND j.status = 'APPROVED')::bigint AS join_approved_count,
  (SELECT count(*) FROM meeting_join_requests j WHERE j.meeting_id = $1 AND j.status = 'REJECTED')::bigint AS join_rejected_count;
