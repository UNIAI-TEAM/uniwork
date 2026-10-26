package service

import (
	"context"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// An organization's floor under the phone's own privacy choices (audit
// "Security & privacy", privacy-defaults-off). Consumer chat apps leave the
// UniChat app lock and screen-capture blocking to each person; an
// organization that handles sensitive work can require them on every
// member's phone, as MDM/AppConfig does for enterprise chat. The phone treats
// each requirement as a minimum the person cannot lower (apps/chat-mobile ›
// lib/app-lock.ts › withFloor); the server only records and serves it, since
// it cannot see a phone's screen.

// MobileSecurityPolicy is the organization's requirements as a member sees them.
type MobileSecurityPolicy struct {
	// RequireAppLock: UniChat opens only after Face ID, a fingerprint or the passcode.
	RequireAppLock bool
	// BlockScreenCapture: no screenshot or recording of UniChat, and the app switcher shows no content.
	BlockScreenCapture bool
	// CanManage: the caller is an owner or admin, who may change it.
	CanManage bool
}

func mobileSecurityPolicyOf(appLock, capture pgtype.Timestamptz, role string) MobileSecurityPolicy {
	return MobileSecurityPolicy{
		RequireAppLock:     appLock.Valid,
		BlockScreenCapture: capture.Valid,
		CanManage:          role == OrgRoleOwner || role == OrgRoleAdmin,
	}
}

// MobileSecurityPolicy answers any active member: every phone of the
// organization reads it to know its floor.
func (s *OrganizationService) MobileSecurityPolicy(ctx context.Context, actorID, orgID string) (MobileSecurityPolicy, error) {
	m, err := s.RequireMember(ctx, orgID, actorID)
	if err != nil {
		return MobileSecurityPolicy{}, err
	}
	row, err := s.q.GetOrganizationMobileSecurityPolicy(ctx, orgID)
	if err != nil {
		return MobileSecurityPolicy{}, err
	}
	return mobileSecurityPolicyOf(row.MobileAppLockRequiredAt, row.MobileScreenCaptureBlockedAt, m.Role), nil
}

// MobileSecurityPolicyChange names what to change; a nil field keeps its value.
type MobileSecurityPolicyChange struct {
	RequireAppLock     *bool
	BlockScreenCapture *bool
}

// SetMobileSecurityPolicy changes the organization's requirements. Owners and
// admins only; a change that changes nothing writes no audit row.
func (s *OrganizationService) SetMobileSecurityPolicy(ctx context.Context, actorID, orgID string, change MobileSecurityPolicyChange) (MobileSecurityPolicy, error) {
	m, err := s.RequireMember(ctx, orgID, actorID)
	if err != nil {
		return MobileSecurityPolicy{}, err
	}
	if m.Role != OrgRoleOwner && m.Role != OrgRoleAdmin {
		return MobileSecurityPolicy{}, ErrForbidden
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return MobileSecurityPolicy{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.q.WithTx(tx)
	before, err := q.GetOrganizationMobileSecurityPolicyForUpdate(ctx, orgID)
	if err != nil {
		return MobileSecurityPolicy{}, err
	}
	appLock, capture := before.MobileAppLockRequiredAt.Valid, before.MobileScreenCaptureBlockedAt.Valid
	if change.RequireAppLock != nil {
		appLock = *change.RequireAppLock
	}
	if change.BlockScreenCapture != nil {
		capture = *change.BlockScreenCapture
	}
	if appLock == before.MobileAppLockRequiredAt.Valid && capture == before.MobileScreenCaptureBlockedAt.Valid {
		if err := tx.Commit(ctx); err != nil {
			return MobileSecurityPolicy{}, err
		}
		return mobileSecurityPolicyOf(before.MobileAppLockRequiredAt, before.MobileScreenCaptureBlockedAt, m.Role), nil
	}
	row, err := q.SetOrganizationMobileSecurityPolicy(ctx, db.SetOrganizationMobileSecurityPolicyParams{
		ID: orgID, RequireAppLock: appLock, BlockScreenCapture: capture, ActorID: actorID,
	})
	if err != nil {
		return MobileSecurityPolicy{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: orgID, Actor: audit.User(actorID), Action: audit.ActionOrganizationMobileSecurityPolicyChanged,
		ResourceType: "organization", ResourceID: orgID,
		Changes: audit.Diff(
			map[string]any{"require_app_lock": before.MobileAppLockRequiredAt.Valid, "block_screen_capture": before.MobileScreenCaptureBlockedAt.Valid},
			map[string]any{"require_app_lock": appLock, "block_screen_capture": capture},
		),
	}); err != nil {
		return MobileSecurityPolicy{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return MobileSecurityPolicy{}, err
	}
	return mobileSecurityPolicyOf(row.MobileAppLockRequiredAt, row.MobileScreenCaptureBlockedAt, m.Role), nil
}
