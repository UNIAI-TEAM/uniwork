package service

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/audit"
)

// RevokedOfficeLeases is what RevokeOrganizationOfflineLeases reports back
// to the CLI.
type RevokedOfficeLeases struct {
	OrganizationID string
	// Epoch is the organization's offline policy epoch after the bump.
	Epoch int64
	// Revoked counts the live leases this call revoked.
	Revoked int
}

// RevokeOrganizationOfflineLeases is the operator's org-wide offline revoke
// (G5-D1 row 8, uniwork-admin revoke-offline-leases): one transaction bumps
// the organization's offline policy epoch, so no lease granted before it
// renews, revokes every live lease (reason admin, one audit row and one
// office_lease.revoked event each), and records the bump in admin_actions and
// audit_events with the reason. Devices that are online lock now; offline
// ones when they reconnect or their lease expires (at most 24 h). An unknown
// organization is ErrNotFound and nothing is written. actorID is a platform
// admin's user id, or CLIActor from uniwork-admin.
func (s *AdminService) RevokeOrganizationOfflineLeases(ctx context.Context, actorID, orgID, reason string) (RevokedOfficeLeases, error) {
	if err := checkReason(reason); err != nil {
		return RevokedOfficeLeases{}, err
	}
	ctx, traceID := ensureTrace(ctx)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return RevokedOfficeLeases{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	if _, err := q.GetOrganizationByID(ctx, orgID); errors.Is(err, pgx.ErrNoRows) {
		return RevokedOfficeLeases{}, ErrNotFound
	} else if err != nil {
		return RevokedOfficeLeases{}, err
	}
	epoch, err := q.BumpOfficeOfflinePolicyEpoch(ctx, orgID)
	if err != nil {
		return RevokedOfficeLeases{}, err
	}
	actor := audit.User(actorID)
	if actorID == CLIActor {
		actor = audit.System(CLIActor)
	}
	revoked, err := revokeOfficeLeasesForOrganization(ctx, q, actor, orgID, OfficeLeaseRevokeAdmin)
	if err != nil {
		return RevokedOfficeLeases{}, err
	}
	before := map[string]any{"policy_epoch": epoch - 1}
	after := map[string]any{"policy_epoch": epoch, "leases_revoked": revoked}
	if err := s.recordAdmin(ctx, q, traceID, actorID, audit.ActionOfficeOfflinePolicyBumped, "organization", orgID, before, after, reason); err != nil {
		return RevokedOfficeLeases{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: orgID, Actor: actor,
		Action: audit.ActionOfficeOfflinePolicyBumped, ResourceType: "organization", ResourceID: orgID,
		Changes:  audit.Diff(map[string]any{"policy_epoch": epoch - 1}, map[string]any{"policy_epoch": epoch}),
		Metadata: map[string]any{"reason": reason, "platform_admin": true, "leases_revoked": revoked},
	}); err != nil {
		return RevokedOfficeLeases{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return RevokedOfficeLeases{}, err
	}
	observeOfficeLeaseRevokes(OfficeLeaseRevokeAdmin, revoked)
	return RevokedOfficeLeases{OrganizationID: orgID, Epoch: epoch, Revoked: revoked}, nil
}
