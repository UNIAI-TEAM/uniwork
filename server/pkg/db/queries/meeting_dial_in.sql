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
-- A caller is in the meeting proper (not held) while their guest participant
-- has an open room session: admission opens it, hanging up closes it.
SELECT EXISTS (
  SELECT 1 FROM meeting_attendance_sessions a
  JOIN meeting_participants p ON p.id = a.participant_id
  WHERE a.meeting_id = sqlc.arg('meeting_id') AND p.meeting_id = sqlc.arg('meeting_id')
    AND p.principal_type = 'GUEST' AND p.guest_id = sqlc.arg('guest_id') AND a.left_at IS NULL
);
