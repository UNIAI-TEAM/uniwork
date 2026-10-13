package service

import (
	"context"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// officeLeaseRevokeActor is who a derived lease revoke is attributed to: a
// logout, a session revoke or an access change is the command, the lease
// revoke its consequence. The command's own audit row shares the
// correlation id, so the person behind it is one join away.
var officeLeaseRevokeActor = audit.System("office_lease_revoke")

// officeLeaseRef is one revoked lease as the revoke queries return it. Every
// revoke query returns the same five columns, so its row type converts.
type officeLeaseRef db.RevokeOfficeOfflineLeasesByIDsRow

// recordOfficeLeaseRevokes writes one audit row and one office_lease.revoked
// outbox row per revoked lease (G5-D1 row 16) in the caller's transaction -
// the revoke, its audit and the event that tells the holder's online devices
// to lock commit together - and returns how many it recorded. It does not
// move the counter: the caller observes observeOfficeLeaseRevokes once its
// transaction has committed, so a rollback cannot count a revoke nobody got
// (G508S-BE-5).
func recordOfficeLeaseRevokes(ctx context.Context, q *db.Queries, actor audit.Actor, reason string, refs []officeLeaseRef) (int, error) {
	if len(refs) == 0 {
		return 0, nil
	}
	batch := make([]audit.Recorded, 0, len(refs))
	for _, r := range refs {
		batch = append(batch, audit.Recorded{
			Entry: audit.Entry{
				OrganizationID: r.OrganizationID, WorkspaceID: r.WorkspaceID, Actor: actor,
				Action: audit.ActionOfficeOfflineLeaseRevoked, ResourceType: officeLeaseResource, ResourceID: r.ID,
				Metadata: map[string]any{"reason": reason, "document_id": r.DocumentID},
			},
			Events: []audit.Event{officeLeaseEvent(officeLeaseTopicRevoked, r.UserID, r.DocumentID, r.ID)},
		})
	}
	if err := auditRecorder.RecordMany(ctx, q, batch); err != nil {
		return 0, err
	}
	return len(refs), nil
}

// observeOfficeLeaseRevokes moves the revoke counter. Call it only after the
// transaction that revoked the leases has committed (G508S-BE-5).
func observeOfficeLeaseRevokes(reason string, n int) {
	if n > 0 && officeLeaseMetrics != nil {
		officeLeaseMetrics.ObserveOfficeLeasesRevoked(reason, n)
	}
}

// revokeOfficeLeasesForDevice revokes every lease of one device in the
// device-scope logout's transaction (G5-D1 row 6); the caller counts the
// returned leases after its commit with observeOfficeLeaseRevokes.
func revokeOfficeLeasesForDevice(ctx context.Context, q *db.Queries, userID, deviceID string) (int, error) {
	rows, err := q.RevokeOfficeOfflineLeasesForDevice(ctx, db.RevokeOfficeOfflineLeasesForDeviceParams{
		UserID: userID, DeviceSessionID: deviceID, Reason: OfficeLeaseRevokeDeviceRevoked,
	})
	if err != nil {
		return 0, err
	}
	refs := make([]officeLeaseRef, len(rows))
	for i, r := range rows {
		refs[i] = officeLeaseRef(r)
	}
	return recordOfficeLeaseRevokes(ctx, q, officeLeaseRevokeActor, OfficeLeaseRevokeDeviceRevoked, refs)
}

// revokeOfficeLeasesForFamily revokes the leases of every device of one
// session family (family logout, refresh reuse, admin device revoke).
func revokeOfficeLeasesForFamily(ctx context.Context, q *db.Queries, userID, familyID string) (int, error) {
	rows, err := q.RevokeOfficeOfflineLeasesForFamily(ctx, db.RevokeOfficeOfflineLeasesForFamilyParams{
		UserID: userID, SessionFamilyID: familyID, Reason: OfficeLeaseRevokeDeviceRevoked,
	})
	if err != nil {
		return 0, err
	}
	refs := make([]officeLeaseRef, len(rows))
	for i, r := range rows {
		refs[i] = officeLeaseRef(r)
	}
	return recordOfficeLeaseRevokes(ctx, q, officeLeaseRevokeActor, OfficeLeaseRevokeDeviceRevoked, refs)
}

// revokeOfficeLeasesForUser revokes every lease of the user in every
// organization (revokeAllUserSessions: RevokeAll, password reset, account
// deletion, the last-organization deactivation).
func revokeOfficeLeasesForUser(ctx context.Context, q *db.Queries, userID string) (int, error) {
	rows, err := q.RevokeOfficeOfflineLeasesForUser(ctx, db.RevokeOfficeOfflineLeasesForUserParams{
		UserID: userID, Reason: OfficeLeaseRevokeSessionRevoked,
	})
	if err != nil {
		return 0, err
	}
	refs := make([]officeLeaseRef, len(rows))
	for i, r := range rows {
		refs[i] = officeLeaseRef(r)
	}
	return recordOfficeLeaseRevokes(ctx, q, officeLeaseRevokeActor, OfficeLeaseRevokeSessionRevoked, refs)
}

// officeLeaseOrgRevokeBatch bounds one statement of an organization-wide
// revoke; the caller loops until a batch comes back short.
const officeLeaseOrgRevokeBatch = int32(500)

// revokeOfficeLease revokes one lease in its own transaction: Put's
// post-commit membership re-check (FIX-1) found the gate the grant used now
// refuses, so the row it just wrote must not survive the request. Audit and
// office_lease.revoked commit with the revoke (G5-D1 row 16) and the counter
// moves only after the commit (G508S-BE-5). A row another revoke path already
// ended is left to it: the update only matches live rows.
func (s *OfficeLeaseService) revokeOfficeLease(ctx context.Context, orgID, leaseID, reason string) error {
	tx, err := s.docs.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	n, err := revokeOfficeLeaseIDs(ctx, s.docs.q.WithTx(tx), orgID, []string{leaseID}, reason)
	if err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	observeOfficeLeaseRevokes(reason, n)
	return nil
}

// revokeOfficeLeasesForOrganization revokes every live lease of one
// organization in batches inside the caller's transaction and returns how
// many it recorded. The caller observes the counter after its commit.
func revokeOfficeLeasesForOrganization(ctx context.Context, q *db.Queries, actor audit.Actor, orgID, reason string) (int, error) {
	total := 0
	for {
		rows, err := q.RevokeOfficeOfflineLeasesForOrganization(ctx, db.RevokeOfficeOfflineLeasesForOrganizationParams{
			OrganizationID: orgID, Reason: reason, BatchLimit: officeLeaseOrgRevokeBatch,
		})
		if err != nil {
			return total, err
		}
		refs := make([]officeLeaseRef, len(rows))
		for i, r := range rows {
			refs[i] = officeLeaseRef(r)
		}
		n, err := recordOfficeLeaseRevokes(ctx, q, actor, reason, refs)
		if err != nil {
			return total, err
		}
		total += n
		if len(rows) < int(officeLeaseOrgRevokeBatch) {
			return total, nil
		}
	}
}
