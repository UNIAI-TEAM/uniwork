-- Spec D2 (update 2026-10-01): an account from outside the meeting's workspace
-- that an invite link or an approved join request brings in is an OBSERVER
-- until the host makes it a member. settleAdmittedStanding applies that from
-- now on; 9991790740000001 only backfilled GUEST rows, so accounts admitted
-- earlier still sit on the roll as MEMBER and count toward quorum.
--
-- Membership is GetWorkspaceAccess / RequireMemberQ: a workspace_members row,
-- or organization owner/admin (admin of every workspace), and not deactivated
-- in the organization (deactivation keeps the workspace rows). A suspended
-- organization is deliberately not read as "not a member": suspension is a
-- temporary tenant state, and this one-shot backfill would otherwise demote
-- every real member of that tenant for good.
--
-- Left alone:
--   * a finalized roll — it records what was decided (reopen, then change);
--   * participants a host added directly (CREATOR / INVITE …);
--   * any meeting where someone has already promoted a participant to MEMBER:
--     the audit row does not name the participant, so the meeting's standings
--     are taken as curated rather than risk undoing a deliberate promotion.
UPDATE meeting_participants p
SET standing = 'OBSERVER'
FROM meetings m
WHERE m.id = p.meeting_id
  AND p.principal_type = 'USER'
  AND p.user_id IS NOT NULL
  AND p.source_type IN ('INVITE_LINK', 'JOIN_APPROVAL')
  AND p.standing = 'MEMBER'
  AND m.attendance_finalized_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM workspaces w
    LEFT JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.user_id = p.user_id
    LEFT JOIN organization_members om ON om.organization_id = w.organization_id AND om.user_id = p.user_id
    WHERE w.id = m.workspace_id
      AND (wm.role IS NOT NULL OR om.role IN ('owner', 'admin'))
      AND om.deactivated_at IS NULL
  )
  AND NOT EXISTS (
    SELECT 1
    FROM audit_events a
    WHERE a.resource_type = 'meeting'
      AND a.resource_id = m.id
      AND a.action = 'meeting.participant_updated'
      AND a.changes::jsonb -> 'standing' ->> 'to' = 'MEMBER'
  );
