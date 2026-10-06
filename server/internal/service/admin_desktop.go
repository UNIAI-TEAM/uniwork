package service

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// RevokedDesktopDevice is what RevokeDesktopDevice reports back to the CLI.
type RevokedDesktopDevice struct {
	DeviceID        string
	UserID          string
	SessionFamilyID string
	// Revoked counts the device sessions of the family this call closed.
	Revoked int
	// AlreadyRevoked: the whole family was closed before; nothing was written.
	AlreadyRevoked bool
}

// RevokeDesktopDevice is the operator-side twin of the owner's own revoke
// (DesktopAuthService.Revoke): it closes the device's whole session family —
// every sibling device session and the family's refresh tokens — so the next
// refresh answers device_revoked. A device id that does not exist, or that
// belongs to another user than userID, is ErrNotFound and nothing is written.
// A family that is already closed is an idempotent no-op with no new rows.
// actorID is a platform admin's user id, or CLIActor from uniwork-admin.
func (s *AdminService) RevokeDesktopDevice(ctx context.Context, actorID, userID, deviceID, reason string) (RevokedDesktopDevice, error) {
	if err := checkReason(reason); err != nil {
		return RevokedDesktopDevice{}, err
	}
	if userID == "" || deviceID == "" {
		return RevokedDesktopDevice{}, ErrNotFound
	}
	ctx, traceID := ensureTrace(ctx)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return RevokedDesktopDevice{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	device, err := q.GetDeviceSessionForUpdate(ctx, deviceID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && device.UserID != userID) {
		return RevokedDesktopDevice{}, ErrNotFound
	}
	if err != nil {
		return RevokedDesktopDevice{}, err
	}
	rows, err := q.ListDeviceSessions(ctx, userID)
	if err != nil {
		return RevokedDesktopDevice{}, err
	}
	live := 0
	for _, row := range rows {
		if row.SessionFamilyID == device.SessionFamilyID && !row.RevokedAt.Valid {
			live++
		}
	}
	out := RevokedDesktopDevice{DeviceID: device.ID, UserID: userID, SessionFamilyID: device.SessionFamilyID, Revoked: live}
	if live == 0 {
		out.AlreadyRevoked = true
		return out, nil
	}
	if err := q.RevokeDesktopSessionFamily(ctx, db.RevokeDesktopSessionFamilyParams{UserID: userID, SessionFamilyID: device.SessionFamilyID}); err != nil {
		return RevokedDesktopDevice{}, err
	}
	before := map[string]any{"revoked": false, "live_sessions": live}
	after := map[string]any{"revoked": true, "live_sessions": 0}
	if err := s.recordAdmin(ctx, q, traceID, actorID, audit.ActionDesktopDeviceRevoked, "device_session", device.ID, before, after, reason); err != nil {
		return RevokedDesktopDevice{}, err
	}
	actor := audit.User(actorID)
	if actorID == CLIActor {
		actor = audit.System(CLIActor)
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: audit.NoOrganization,
		Actor:          actor,
		Action:         audit.ActionDesktopDeviceRevoked,
		ResourceType:   "device_session", ResourceID: device.ID,
		Changes:  audit.Diff(before, after),
		Metadata: map[string]any{"reason": reason, "user_id": userID, "session_family_id": device.SessionFamilyID, "scope": "family"},
	}); err != nil {
		return RevokedDesktopDevice{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return RevokedDesktopDevice{}, err
	}
	return out, nil
}
