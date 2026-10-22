package service

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Whether a push shows its content (audit "Security & privacy",
// push-preview-plaintext). The title and text of a push pass through Expo, FCM
// and APNs and sit on a lock screen, so a person may hide them for themselves
// and an owner or admin for the whole organization; the organization's choice
// wins. Hidden, a push says only what kind of thing happened, naming no one
// and nothing; a ring keeps the caller's name (notification.PushConsumer).

// SetPushPreviews records the person's own choice. Like the AI consent, it is
// theirs, so the audit row sits on the credential sentinel, never on one
// organization; choosing what is already on file writes nothing.
func (s *AuthService) SetPushPreviews(ctx context.Context, userID string, show bool) (db.User, error) {
	u, err := s.Me(ctx, userID)
	if err != nil {
		return db.User{}, err
	}
	if u.PushPreviewsHiddenAt.Valid == !show {
		return u, nil
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.User{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.q.WithTx(tx)
	next, err := q.SetUserPushPreviewsHidden(ctx, db.SetUserPushPreviewsHiddenParams{ID: userID, Hidden: !show})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.User{}, ErrNotFound
	}
	if err != nil {
		return db.User{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: audit.NoOrganization, Actor: audit.User(userID),
		Action: audit.ActionUserPushPreviewsChanged, ResourceType: "user", ResourceID: userID,
		Changes: audit.Diff(map[string]any{"push_previews": !u.PushPreviewsHiddenAt.Valid}, map[string]any{"push_previews": show}),
	}); err != nil {
		return db.User{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.User{}, err
	}
	return s.decorateAvatar(ctx, next), nil
}

// PushPreviewPolicy is the organization's choice as a member sees it.
type PushPreviewPolicy struct {
	// Hidden: no push of the organization names anyone or anything (a ring keeps the caller).
	Hidden   bool
	HiddenAt *time.Time
	// CanManage: the caller is an owner or admin, who may change it.
	CanManage bool
}

func pushPreviewPolicyOf(hiddenAt pgtype.Timestamptz, role string) PushPreviewPolicy {
	p := PushPreviewPolicy{Hidden: hiddenAt.Valid, CanManage: role == OrgRoleOwner || role == OrgRoleAdmin}
	if p.Hidden {
		at := hiddenAt.Time
		p.HiddenAt = &at
	}
	return p
}

// PushPreviewPolicy answers any active member: Settings on the phone says why
// previews are off when the organization turned them off.
func (s *OrganizationService) PushPreviewPolicy(ctx context.Context, actorID, orgID string) (PushPreviewPolicy, error) {
	m, err := s.RequireMember(ctx, orgID, actorID)
	if err != nil {
		return PushPreviewPolicy{}, err
	}
	row, err := s.q.GetOrganizationPushPreviewPolicy(ctx, orgID)
	if err != nil {
		return PushPreviewPolicy{}, err
	}
	return pushPreviewPolicyOf(row.PushPreviewsHiddenAt, m.Role), nil
}

// SetPushPreviewPolicy hides (or shows again) the message's words in every
// chat push of the organization. Owners and admins only; a repeat writes no
// audit row.
func (s *OrganizationService) SetPushPreviewPolicy(ctx context.Context, actorID, orgID string, hidden bool) (PushPreviewPolicy, error) {
	m, err := s.RequireMember(ctx, orgID, actorID)
	if err != nil {
		return PushPreviewPolicy{}, err
	}
	if m.Role != OrgRoleOwner && m.Role != OrgRoleAdmin {
		return PushPreviewPolicy{}, ErrForbidden
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return PushPreviewPolicy{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.q.WithTx(tx)
	before, err := q.GetOrganizationPushPreviewPolicyForUpdate(ctx, orgID)
	if err != nil {
		return PushPreviewPolicy{}, err
	}
	if before.PushPreviewsHiddenAt.Valid == hidden {
		if err := tx.Commit(ctx); err != nil {
			return PushPreviewPolicy{}, err
		}
		return pushPreviewPolicyOf(before.PushPreviewsHiddenAt, m.Role), nil
	}
	row, err := q.SetOrganizationPushPreviewPolicy(ctx, db.SetOrganizationPushPreviewPolicyParams{ID: orgID, Hidden: hidden, ActorID: actorID})
	if err != nil {
		return PushPreviewPolicy{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: orgID, Actor: audit.User(actorID), Action: audit.ActionOrganizationPushPreviewPolicyChanged,
		ResourceType: "organization", ResourceID: orgID,
		Changes: audit.Diff(map[string]any{"push_previews_hidden": before.PushPreviewsHiddenAt.Valid}, map[string]any{"push_previews_hidden": hidden}),
	}); err != nil {
		return PushPreviewPolicy{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return PushPreviewPolicy{}, err
	}
	return pushPreviewPolicyOf(row.PushPreviewsHiddenAt, m.Role), nil
}
