package service

import (
	"context"
	"errors"
	"net/http"
	netmail "net/mail"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// SetMail wires the renderer and the outbox the organization invitation needs.
// It is separate from the constructor because main builds the mail stack after
// the organization services (and a test that never invites can skip it).
func (s *OrganizationMemberService) SetMail(r mail.Renderer, out mail.Enqueuer) {
	s.render = r
	s.out = out
}

// InviteToOrg invites people to the organization itself, with no workspace
// behind it: they land in the company and pick a team afterwards.
func (s *OrganizationMemberService) InviteToOrg(ctx context.Context, actorID, orgID string, emails []string, orgRole string) ([]db.Invitation, []string, error) {
	if _, err := s.requireAdmin(ctx, orgID, actorID); err != nil {
		return nil, nil, err
	}
	if err := requireVerifiedEmail(ctx, s.q, actorID); err != nil {
		return nil, nil, err
	}
	if orgRole == "" {
		orgRole = OrgRoleMember
	}
	if orgRole != OrgRoleAdmin && orgRole != OrgRoleMember {
		return nil, nil, Invalid("org_role phải là admin hoặc member")
	}
	if len(emails) == 0 {
		return nil, nil, Invalid("cần ít nhất một email")
	}
	if len(emails) > maxInviteBatch {
		return nil, nil, Invalid("tối đa 50 email mỗi lần")
	}
	if s.render.AppURL == "" || s.out == nil {
		return nil, nil, coded(http.StatusServiceUnavailable, "mail_unavailable", "chưa cấu hình gửi email")
	}
	inviter, err := s.q.GetUserByID(ctx, actorID)
	if err != nil {
		return nil, nil, err
	}
	org, err := s.q.GetOrganizationByID(ctx, orgID)
	if err != nil {
		return nil, nil, err
	}
	// The quota is checked before any invitation is written, so an
	// organization at its seat limit is told now rather than when the last
	// invitee tries to accept. The seat itself is consumed on accept.
	if err := s.ent.CheckQuota(ctx, orgID, FeatureMembersMax, int64(len(emails))); err != nil {
		return nil, nil, err
	}
	members, err := s.q.ListOrganizationMembers(ctx, db.ListOrganizationMembersParams{
		OrganizationID: orgID, Status: MemberStatusAll, RowLimit: maxOrgMemberScan,
	})
	if err != nil {
		return nil, nil, err
	}
	// Deactivated members count as members here: inviting somebody who was
	// switched off is a mistake, and the fix is to reactivate them rather than
	// to send a link that AcceptInvite would refuse.
	isMember := map[string]bool{}
	for _, m := range members {
		isMember[strings.ToLower(m.Email)] = true
	}

	// One transaction for the batch: an invitation whose mail was never
	// queued, or whose audit row is missing, is worse than the batch failing.
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, nil, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	seen := map[string]bool{}
	var invs []db.Invitation
	var skipped []string
	for _, raw := range emails {
		email := strings.ToLower(strings.TrimSpace(raw))
		if email == "" || seen[email] {
			continue
		}
		seen[email] = true
		if _, perr := netmail.ParseAddress(email); perr != nil || isMember[email] {
			skipped = append(skipped, email)
			continue
		}
		// An address already invited keeps its token: sending a second one
		// would quietly invalidate the link in the first email.
		if existing, err := q.GetPendingInvitationForEmail(ctx, db.GetPendingInvitationForEmailParams{
			OrganizationID: orgID, Lower: email,
		}); err == nil {
			invs = append(invs, existing)
			continue
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return nil, nil, err
		}
		inv, err := q.CreateInvitation(ctx, db.CreateInvitationParams{
			ID:             util.NewID(),
			OrganizationID: orgID,
			Email:          email,
			Role:           OrgRoleMember, // the workspace role, unused here
			OrgRole:        orgRole,
			Token:          util.NewID() + util.NewID(),
			ExpiresAt:      pgtype.Timestamptz{Time: time.Now().Add(inviteTTL), Valid: true},
			InvitedBy:      pgtype.Text{String: actorID, Valid: true},
		})
		if err != nil {
			return nil, nil, err
		}
		invs = append(invs, inv)
		msg, err := s.render.OrganizationInvite(email, inviter.Locale, mail.OrganizationInviteData{
			InviterName: inviter.DisplayName, OrganizationName: org.Name,
			AcceptURL: s.render.AppURL + "/invite/" + inv.Token, Expires: inviteTTL,
		})
		if err != nil {
			return nil, nil, err
		}
		if _, err := s.out.Enqueue(ctx, q, msg); err != nil {
			return nil, nil, err
		}
		// The invitee has no user id yet, so the audited resource is the
		// invitation row; the email lives there and stays out of a table that
		// can never be edited.
		if err := auditRecorder.Record(ctx, q, audit.Entry{
			OrganizationID: orgID,
			Actor:          audit.User(actorID),
			Action:         audit.ActionMemberInvited,
			ResourceType:   "invitation", ResourceID: inv.ID,
			Changes: audit.Diff(nil, map[string]any{"org_role": orgRole}),
		}, audit.Event{Topic: "member.invited", Payload: map[string]string{
			"organization_id": orgID, "invitation_id": inv.ID,
		}}); err != nil {
			return nil, nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, nil, err
	}
	if len(invs) > 0 {
		s.out.Kick()
	}
	return invs, skipped, nil
}

// PendingInvitations lists the organization's outstanding invitations.
func (s *OrganizationMemberService) PendingInvitations(ctx context.Context, actorID, orgID string) ([]db.ListPendingOrganizationInvitationsRow, error) {
	if _, err := s.requireAdmin(ctx, orgID, actorID); err != nil {
		return nil, err
	}
	return s.q.ListPendingOrganizationInvitations(ctx, orgID)
}

// RevokeInvitation withdraws an invitation that has not been accepted. The row
// stays with revoked_at set: who invited whom, and who changed their mind, is
// part of the record.
func (s *OrganizationMemberService) RevokeInvitation(ctx context.Context, actorID, orgID, invitationID string) error {
	if _, err := s.requireAdmin(ctx, orgID, actorID); err != nil {
		return err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	inv, err := q.RevokeInvitation(ctx, db.RevokeInvitationParams{ID: invitationID, OrganizationID: orgID})
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: orgID,
		Actor:          audit.User(actorID),
		Action:         audit.ActionInvitationRevoked,
		ResourceType:   "invitation", ResourceID: inv.ID,
		Changes: audit.Diff(map[string]any{"revoked": false}, map[string]any{"revoked": true}),
	}, audit.Event{Topic: "invitation.revoked", Payload: map[string]string{
		"organization_id": orgID, "invitation_id": inv.ID,
	}}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// TransferOwnership hands the organization to another active member. Both rows
// move in one transaction, taken FOR UPDATE in a fixed order, so a concurrent
// transfer cannot leave the organization with two owners or none.
//
// The current owner re-enters their password (OPEN_QUESTIONS P2): this is the
// one action they cannot undo alone afterwards.
func (s *OrganizationMemberService) TransferOwnership(ctx context.Context, actorID, orgID, targetID, password string) (db.OrganizationMember, error) {
	actor, err := s.orgs.RequireMember(ctx, orgID, actorID)
	if err != nil {
		return db.OrganizationMember{}, err
	}
	if actor.Role != OrgRoleOwner {
		return db.OrganizationMember{}, ErrForbidden
	}
	if actorID == targetID {
		return db.OrganizationMember{}, Invalid("bạn đã là chủ sở hữu")
	}
	me, err := s.q.GetUserByID(ctx, actorID)
	if err != nil {
		return db.OrganizationMember{}, err
	}
	if !me.PasswordHash.Valid {
		return db.OrganizationMember{}, coded(http.StatusForbidden, "password_required",
			"tài khoản chưa có mật khẩu; đặt mật khẩu trước khi chuyển quyền chủ sở hữu")
	}
	if !auth.CheckPassword(me.PasswordHash.String, password) {
		return db.OrganizationMember{}, ErrInvalidCredentials
	}
	target, err := s.member(ctx, orgID, targetID)
	if err != nil {
		return db.OrganizationMember{}, err
	}
	if target.DeactivatedAt.Valid {
		return db.OrganizationMember{}, errMemberDeactivated()
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.OrganizationMember{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	// Lock both rows in id order: two transfers running at once then queue
	// behind each other instead of deadlocking.
	first, second := actorID, targetID
	if second < first {
		first, second = second, first
	}
	for _, id := range []string{first, second} {
		if _, err := q.LockOrganizationMemberForUpdate(ctx, db.LockOrganizationMemberForUpdateParams{
			OrganizationID: orgID, UserID: id,
		}); err != nil {
			return db.OrganizationMember{}, err
		}
	}
	// The old owner steps down first: the single-owner unique index would
	// refuse the promotion the other way round.
	if _, err := q.UpdateOrganizationMemberRole(ctx, db.UpdateOrganizationMemberRoleParams{
		OrganizationID: orgID, UserID: actorID, Role: OrgRoleAdmin,
	}); err != nil {
		return db.OrganizationMember{}, err
	}
	updated, err := q.UpdateOrganizationMemberRole(ctx, db.UpdateOrganizationMemberRoleParams{
		OrganizationID: orgID, UserID: targetID, Role: OrgRoleOwner,
	})
	if err != nil {
		return db.OrganizationMember{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: orgID,
		Actor:          audit.User(actorID),
		Action:         audit.ActionOrganizationOwnershipChanged,
		ResourceType:   "organization", ResourceID: orgID,
		Changes: audit.Diff(map[string]any{"owner_user_id": actorID}, map[string]any{"owner_user_id": targetID}),
	}, audit.Event{Topic: "organization.ownership_transferred", Payload: map[string]string{
		"organization_id": orgID, "user_id": targetID,
	}}, audit.Event{Topic: "organization.ownership_transferred", Payload: map[string]string{
		"organization_id": orgID, "user_id": actorID,
	}}); err != nil {
		return db.OrganizationMember{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.OrganizationMember{}, err
	}
	return updated, nil
}

// maxOrgMemberScan bounds the "is this address already a member" scan. An
// organization past this size invites through the directory, not by typing
// fifty addresses at once.
const maxOrgMemberScan = 5000
