-- name: FillMeetingDialInPin :one
-- tenant: by-id
-- A meeting that predates the column (or was restored after it) gets its PIN
-- the first time one is needed; an existing PIN is kept.
UPDATE meetings SET dial_in_pin = DEFAULT
WHERE id = $1 AND dial_in_pin IS NULL
RETURNING dial_in_pin;

-- name: RotateMeetingDialInPin :one
-- tenant: by-id
-- Draws a new PIN and drops the rule that routed the old one, returning both
-- the new PIN and the rule id the caller must delete on the provider.
UPDATE meetings m SET dial_in_pin = DEFAULT, sip_dispatch_rule_id = NULL
FROM (SELECT o.id, o.sip_dispatch_rule_id FROM meetings o WHERE o.id = sqlc.arg('id') FOR UPDATE) old
WHERE m.id = old.id
RETURNING m.dial_in_pin, old.sip_dispatch_rule_id AS old_rule_id;

-- name: DialInPinTaken :one
-- tenant: system
-- PINs are unique among the meetings of the deployment that hold a rule
-- (uidx_meetings_dial_in_pin_active): one SIP trunk serves every tenant.
SELECT EXISTS (
  SELECT 1 FROM meetings
  WHERE dial_in_pin = sqlc.arg('pin') AND sip_dispatch_rule_id IS NOT NULL AND id <> sqlc.arg('id')
);

-- name: LockMeetingDialIn :exec
-- Serializes ensures of one meeting's rule across replicas (Start's inline
-- ensure and a sweep): otherwise the second sees no rule, makes one for the
-- same PIN, is refused by the first's rule and rotates the PIN people hold.
SELECT pg_advisory_xact_lock(hashtextextended('meeting_dial_in:' || sqlc.arg(meeting_id)::text, 0));

-- name: SetMeetingDialInRule :execrows
-- tenant: by-id
-- Records the rule only while it still fits: the meeting is in progress, has
-- no rule yet and still holds the PIN the rule was made for. 0 rows means the
-- caller deletes the rule it just made.
UPDATE meetings SET sip_dispatch_rule_id = sqlc.arg('rule_id')
WHERE id = sqlc.arg('id') AND status = 'IN_PROGRESS' AND sip_dispatch_rule_id IS NULL
  AND dial_in_pin = sqlc.arg('pin');

-- name: ClearMeetingDialInRule :execrows
-- tenant: by-id
UPDATE meetings SET sip_dispatch_rule_id = NULL
WHERE id = sqlc.arg('id') AND sip_dispatch_rule_id = sqlc.arg('rule_id');

-- name: ListDialInSweepMeetings :many
-- tenant: system
-- The dial-in sweep: every meeting holding a rule (it may have ended or lost
-- the flag), and with dial-in on (with_ensure) every meeting in progress
-- without one. Oldest start first, like the scribe sweep.
SELECT id FROM meetings
WHERE sip_dispatch_rule_id IS NOT NULL
   OR (sqlc.arg('with_ensure')::bool AND status = 'IN_PROGRESS' AND sip_dispatch_rule_id IS NULL)
ORDER BY actual_start_at ASC NULLS LAST, id
LIMIT sqlc.arg('row_limit');

-- name: DialInCallerAdmitted :one
-- tenant: parent meeting_id
-- One connection of a caller is in the meeting proper (not held) while it
-- has an open room session (in_session): admission opens it for that
-- connection's SID, its hang-up closes it. A redial is another connection
-- and knocks again. approved: the host approved this connection's knock and
-- the caller is not removed, so it counts as admitted even before (or
-- without) its session — the approval commits first, then the provider call.
SELECT
  EXISTS (
    SELECT 1 FROM meeting_attendance_sessions a
    JOIN meeting_participants p ON p.id = a.participant_id
    WHERE a.meeting_id = sqlc.arg('meeting_id') AND p.meeting_id = sqlc.arg('meeting_id')
      AND p.principal_type = 'GUEST' AND p.guest_id = sqlc.arg('guest_id') AND a.left_at IS NULL
      AND a.provider_participant_sid = sqlc.arg('participant_sid')::text
  ) AS in_session,
  EXISTS (
    SELECT 1 FROM meeting_join_requests r
    JOIN meeting_participants p ON p.meeting_id = r.meeting_id AND p.guest_id = r.requester_guest_id
    WHERE r.meeting_id = sqlc.arg('meeting_id') AND r.requester_guest_id = sqlc.arg('guest_id')
      AND r.status = 'APPROVED' AND r.provider_participant_sid = sqlc.arg('participant_sid')::text
      AND p.principal_type = 'GUEST' AND p.status = 'ACTIVE'
  ) AS approved;

-- name: OpenDialInSessionSid :one
-- tenant: parent meeting_id
-- The connection an admitted caller is on, to remove or mute it.
SELECT provider_participant_sid FROM meeting_attendance_sessions
WHERE meeting_id = $1 AND participant_id = $2 AND left_at IS NULL
ORDER BY joined_at DESC
LIMIT 1;

-- name: SetJoinRequestProviderSid :exec
-- tenant: by-id
-- The connection a pending phone knock belongs to; a newer connection of the
-- same caller takes the knock over.
UPDATE meeting_join_requests SET provider_participant_sid = sqlc.arg('participant_sid')::text
WHERE id = sqlc.arg('id') AND status = 'PENDING';

-- name: ListMeetingDialInRuleIDs :many
-- tenant: system
-- Every rule a meeting row points at, so the sweep can tell a stray uniwork
-- rule (made, then lost to a failed write) from a live one.
SELECT sip_dispatch_rule_id::text FROM meetings WHERE sip_dispatch_rule_id IS NOT NULL;
