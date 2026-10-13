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
// outbox row per revoked lease (G5-D1 row 16) in the caller's transaction:
// the revoke, its audit and the event that tells the holder's online devices
// to lock commit together.
func recordOfficeLeaseRevokes(ctx context.Context, q *db.Queries, actor audit.Actor, reason string, refs []officeLeaseRef) error {
	if len(refs) == 0 {
		return nil
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
		return err
	}
	if officeLeaseMetrics != nil {
		officeLeaseMetrics.ObserveOfficeLeasesRevoked(reason, len(refs))
	}
	return nil
}

// revokeOfficeLeasesForDevice revokes every lease of one device in the
// device-scope logout's transaction (G5-D1 row 6).
func revokeOfficeLeasesForDevice(ctx context.Context, q *db.Queries, userID, deviceID string) error {
	rows, err := q.RevokeOfficeOfflineLeasesForDevice(ctx, db.RevokeOfficeOfflineLeasesForDeviceParams{
		UserID: userID, DeviceSessionID: deviceID, Reason: OfficeLeaseRevokeDeviceRevoked,
	})
	if err != nil {
		return err
	}
	refs := make([]officeLeaseRef, len(rows))
	for i, r := range rows {
		refs[i] = officeLeaseRef(r)
	}
	return recordOfficeLeaseRevokes(ctx, q, officeLeaseRevokeActor, OfficeLeaseRevokeDeviceRevoked, refs)
}

// revokeOfficeLeasesForFamily revokes the leases of every device of one
// session family (family logout, refresh reuse, admin device revoke).
func revokeOfficeLeasesForFamily(ctx context.Context, q *db.Queries, userID, familyID string) error {
	rows, err := q.RevokeOfficeOfflineLeasesForFamily(ctx, db.RevokeOfficeOfflineLeasesForFamilyParams{
		UserID: userID, SessionFamilyID: familyID, Reason: OfficeLeaseRevokeDeviceRevoked,
	})
	if err != nil {
		return err
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
func revokeOfficeLeasesForUser(ctx context.Context, q *db.Queries, userID string) error {
	rows, err := q.RevokeOfficeOfflineLeasesForUser(ctx, db.RevokeOfficeOfflineLeasesForUserParams{
		UserID: userID, Reason: OfficeLeaseRevokeSessionRevoked,
	})
	if err != nil {
		return err
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

// revokeOfficeLeasesForOrganization revokes every live lease of one
// organization in batches inside the caller's transaction and returns how
// many it revoked.
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
		if err := recordOfficeLeaseRevokes(ctx, q, actor, reason, refs); err != nil {
			return total, err
		}
		total += len(rows)
		if len(rows) < int(officeLeaseOrgRevokeBatch) {
			return total, nil
		}
	}
}
