package service

import (
	"context"
	"errors"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// AcceptResult is what accepting an invitation produced. Workspace is nil for
// an organization-level invitation: the person is in the company but not yet
// in any team, and the client sends them to the workspace picker.
type AcceptResult struct {
	Organization db.Organization
	Workspace    *WorkspaceView
}

// SwitchResolution is what the person chose to do with one organization that
// stands between them and the invitation (spec §4.4). Action is the conflict's
// required_action; a transfer names the new owner and carries the password, a
// close carries the organization's slug typed back.
type SwitchResolution struct {
	OrganizationID   string
	Action           string
	TransferToUserID string
	Password         string
	ConfirmSlug      string
}

// sameMailbox: addresses are stored lower-cased, so the comparison is exact.
// Unicode case folding (strings.EqualFold) would let "ſam@" redeem "sam@".
func sameMailbox(a, b string) bool {
	norm := func(s string) string { return strings.ToLower(strings.TrimSpace(s)) }
	return norm(a) == norm(b)
}

// orgRoleOrMember keeps an unknown role out of the membership row: the column
// has a CHECK constraint, and "member" is the safe reading of anything else.
func orgRoleOrMember(role string) string {
	if role == OrgRoleAdmin || role == OrgRoleOwner {
		return role
	}
	return OrgRoleMember
}

// invitationFor reads an invitation, in any state, for the account that wants
// it. The token travels by mail and gets forwarded, pasted and screenshotted;
// it names the mailbox it was sent to, and only an account that has proven
// that mailbox may read or redeem it. Otherwise anyone the link reaches - or
// anyone who registers the invitee's address first - joins the organization
// as whoever was invited (ADR 0008 isolation matrix).
func (s *WorkspaceService) invitationFor(ctx context.Context, userID, token string) (db.GetInvitationByTokenAnyStateRow, error) {
	inv, err := s.q.GetInvitationByTokenAnyState(ctx, token)
	if errors.Is(err, pgx.ErrNoRows) {
		return inv, ErrNotFound
	}
	if err != nil {
		return inv, err
	}
	if err := requireVerifiedEmail(ctx, s.q, userID); err != nil {
		return inv, err
	}
	caller, err := s.q.GetUserByID(ctx, userID)
	if err != nil {
		return inv, err
	}
	if !sameMailbox(caller.Email, inv.Email) {
		return inv, errInvitationForAnotherEmail()
	}
	return inv, nil
}

// joinConflicts decides, for an account about to join orgID, whether it is new
// to the organization and what stands in the way. An existing member has no
// conflicts (a workspace invitation inside their own organization); a person
// new to it has every other organization they belong to (ADR 0032). Any other
// answer of the membership gate - a deactivated row, a suspended tenant - is
// returned as the error.
func (s *WorkspaceService) joinConflicts(ctx context.Context, q *db.Queries, orgID, userID string) (bool, []MembershipConflict, error) {
	_, err := s.orgs.RequireMemberQ(ctx, q, orgID, userID)
	switch {
	case err == nil:
		return false, []MembershipConflict{}, nil
	case errors.Is(err, ErrForbidden):
		conflicts, err := membershipConflicts(ctx, q, userID, orgID)
		return true, conflicts, err
	default:
		return false, nil, err
	}
}

// matchResolution checks that resolve covers exactly the conflicts, each with
// exactly its required action (spec §4.4 step 4). A blocked conflict has no
// action that resolves it; a transfer must name somebody other than the caller.
func matchResolution(userID string, conflicts []MembershipConflict, resolve []SwitchResolution) (map[string]SwitchResolution, bool) {
	if len(resolve) != len(conflicts) {
		return nil, false
	}
	byOrg := make(map[string]SwitchResolution, len(resolve))
	for _, r := range resolve {
		if _, twice := byOrg[r.OrganizationID]; twice {
			return nil, false
		}
		byOrg[r.OrganizationID] = r
	}
	for _, c := range conflicts {
		r, ok := byOrg[c.Organization.ID]
		if !ok || c.RequiredAction == SwitchActionBlocked || r.Action != c.RequiredAction {
			return nil, false
		}
		if r.Action == SwitchActionTransfer && (r.TransferToUserID == "" || r.TransferToUserID == userID) {
			return nil, false
		}
	}
	return byOrg, true
}

// errSwitchStale marks a resolution that was right when it was matched but
// that a step refused because the old organization changed under it (the
// chosen heir left, ownership moved in another tab). The switch rolls back
// and AcceptInvite answers the conflicts as they are now.
var errSwitchStale = errors.New("switch_stale")

func staleResolution(err error) error {
	for _, gone := range []error{ErrForbidden, ErrNotFound, ErrMemberDeactivated, ErrLastOwner, ErrOrganizationHasMembers, ErrOrganizationSuspended} {
		if errors.Is(err, gone) {
			return errSwitchStale
		}
	}
	return err
}

// admitsNewMembers is whether an invitation into o can be accepted: the
// organization must be active and not waiting out its deletion. A member of
// an organization being deleted is refused by every gate unless they own it,
// so a switch into one would cost the person the organization they had and
// leave them nowhere (spec §4.4 step 3). The row is read under the accept's
// share lock, so a deletion scheduled meanwhile is seen here.
func admitsNewMembers(o db.Organization) error {
	if o.Status != OrganizationActive {
		return errOrganizationSuspended()
	}
	if o.DeletionScheduledAt.Valid {
		return errOrganizationDeletionScheduled(o.DeletionScheduledAt.Time)
	}
	return nil
}

// acceptOutcome is what the transaction decided, for the work after commit.
type acceptOutcome struct {
	org         db.Organization
	workspaceID string
	// retried is an invitation this account already accepted (EC-12).
	retried   bool
	mailboxes []db.DisconnectEmailHubAccountsForUserRow
}

// AcceptInvite turns one invitation into membership, in a single transaction
// (spec §4.4): every organization the person must give up is left, handed
// over or closed as resolve says; then the organization member (if new),
// profile, workspace member when the invitation named one, the invitation
// marked accepted, and the user marked onboarded. Any refusal rolls all of it
// back, so the person is never out of their old organization without being
// in the new one, and never a member who is not onboarded.
//
// An empty resolve is the plain accept of somebody with nothing to give up.
func (s *WorkspaceService) AcceptInvite(ctx context.Context, userID, token string, resolve []SwitchResolution) (AcceptResult, error) {
	inv, err := s.invitationFor(ctx, userID, token)
	if err != nil {
		return AcceptResult{}, err
	}
	// The password is checked before the transaction, as TransferOwnership
	// does, so no row lock is held across bcrypt. An invitation that no
	// longer admits anybody answers that instead.
	if invitationStatus(inv.AcceptedAt, inv.RevokedAt, inv.ExpiresAt) == InvitationPending {
		for _, r := range resolve {
			if r.Action == SwitchActionTransfer {
				if err := checkOwnerPassword(ctx, s.q, userID, r.Password); err != nil {
					return AcceptResult{}, err
				}
				break
			}
		}
	}
	out, err := s.acceptInvite(ctx, userID, token, inv.OrganizationID, resolve)
	if errors.Is(err, errSwitchStale) {
		_, conflicts, cerr := s.joinConflicts(ctx, s.q, inv.OrganizationID, userID)
		if cerr != nil {
			return AcceptResult{}, cerr
		}
		return AcceptResult{}, errOrganizationSwitchRequired(conflicts)
	}
	if err != nil {
		return AcceptResult{}, lockRaceAsBusy(err)
	}
	cleanUpEmailHubAccountsAfterCommit(ctx, s.q, s.members.emailHub, out.mailboxes)
	result := AcceptResult{Organization: out.org}
	if out.workspaceID != "" {
		view, err := s.viewWithIcon(ctx, userID, out.workspaceID)
		switch {
		case err == nil:
			result.Workspace = &view
		case out.retried && (errors.Is(err, ErrForbidden) || errors.Is(err, ErrNotFound)):
			// A retry after the person left that workspace: they are still
			// in the organization, which is what the first answer named.
		default:
			return AcceptResult{}, err
		}
	}
	return result, nil
}

// lockRaceAsBusy turns a deadlock or serialization failure into a retryable
// 409. The organization rows are locked in id order, so two switches should
// only ever queue; this is the answer if Postgres still has to break a cycle.
func lockRaceAsBusy(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && (pgErr.Code == "40P01" || pgErr.Code == "40001") {
		return errMembershipBusy()
	}
	return err
}

// lockOrganizations takes the organization rows a switch touches, in id
// order: the one being joined shared (Close takes it for update, so a close
// and this join cannot both commit, ADR 0032 D5), every one being given up
// for update. Two owners moving into each other's organizations at the same
// moment then queue on the first row instead of each holding one the other
// needs. Somebody already in the organization they join gives nothing up, so
// only that row is taken.
func lockOrganizations(ctx context.Context, q *db.Queries, userID, joiningOrgID string) (db.Organization, map[string]bool, error) {
	active, err := activeOrganizations(ctx, q, userID)
	if err != nil {
		return db.Organization{}, nil, err
	}
	ids := []string{joiningOrgID}
	for _, a := range active {
		if a.ID == joiningOrgID {
			ids = []string{joiningOrgID}
			break
		}
		ids = append(ids, a.ID)
	}
	sort.Strings(ids)
	locked := make(map[string]bool, len(ids))
	var joining db.Organization
	for _, id := range ids {
		if id == joiningOrgID {
			joining, err = q.LockOrganizationForShare(ctx, id)
		} else {
			_, err = q.LockOrganizationForUpdate(ctx, id)
		}
		if errors.Is(err, pgx.ErrNoRows) {
			return db.Organization{}, nil, ErrNotFound
		}
		if err != nil {
			return db.Organization{}, nil, err
		}
		locked[id] = true
	}
	return joining, locked, nil
}

func (s *WorkspaceService) acceptInvite(ctx context.Context, userID, token, orgID string, resolve []SwitchResolution) (acceptOutcome, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return acceptOutcome{}, err
	}
	defer tx.Rollback(ctx)
	qtx := s.q.WithTx(tx)
	// The account's membership lock first, then the organization rows, then
	// the invitation row: a second accept, a revoke, a close or an
	// organization create running at the same moment queues here and decides
	// on what this one committed (ADR 0032). The invitation's organization
	// never changes, so the unlocked read names the right row.
	if err := lockMembership(ctx, qtx, userID); err != nil {
		return acceptOutcome{}, err
	}
	org, locked, err := lockOrganizations(ctx, qtx, userID, orgID)
	if err != nil {
		return acceptOutcome{}, err
	}
	inv, err := qtx.LockInvitationByToken(ctx, token)
	if errors.Is(err, pgx.ErrNoRows) {
		return acceptOutcome{}, ErrNotFound
	}
	if err != nil {
		return acceptOutcome{}, err
	}
	switch invitationStatus(inv.AcceptedAt, inv.RevokedAt, inv.ExpiresAt) {
	case InvitationAccepted:
		// A retry after a lost response (EC-12) answers what the first call
		// did; anybody else holding a spent link learns only that it is.
		if _, err := s.orgs.RequireMemberQ(ctx, qtx, org.ID, userID); err != nil {
			return acceptOutcome{}, errInvitationAccepted()
		}
		return acceptOutcome{org: org, workspaceID: inv.WorkspaceID.String, retried: true}, nil
	case InvitationRevoked:
		return acceptOutcome{}, errInvitationRevoked()
	case InvitationExpired:
		return acceptOutcome{}, errInvitationExpired()
	}
	if err := admitsNewMembers(org); err != nil {
		return acceptOutcome{}, err
	}
	var ws db.Workspace
	if inv.WorkspaceID.Valid {
		ws, err = qtx.GetWorkspaceByID(ctx, inv.WorkspaceID.String)
		if err != nil {
			return acceptOutcome{}, err
		}
	}
	// A membership that was switched off is not reopened by an invitation:
	// only an owner or admin can let that person back in (spec F-03 §4.2).
	isNewMember, conflicts, err := s.joinConflicts(ctx, qtx, org.ID, userID)
	if err != nil {
		return acceptOutcome{}, err
	}
	plan, ok := matchResolution(userID, conflicts, resolve)
	if !ok {
		return acceptOutcome{}, errOrganizationSwitchRequired(conflicts)
	}
	mailboxes, err := s.giveUp(ctx, qtx, userID, inv.ID, org.ID, conflicts, plan, locked)
	if err != nil {
		return acceptOutcome{}, err
	}
	// members.max counts organization members, so only a person new to the
	// organization consumes a seat; an existing member joining another
	// workspace does not (spec F-02 §4.3).
	if isNewMember {
		if err := s.ent.Consume(ctx, qtx, ConsumeInput{OrganizationID: org.ID, Meter: FeatureMembersMax, Delta: 1, Actor: Human(userID)}); err != nil {
			return acceptOutcome{}, err
		}
	}
	if err := qtx.AddOrganizationMember(ctx, db.AddOrganizationMemberParams{
		OrganizationID: org.ID, UserID: userID, Role: orgRoleOrMember(inv.OrgRole),
	}); err != nil {
		return acceptOutcome{}, err
	}
	joiner, err := qtx.GetUserByID(ctx, userID)
	if err != nil {
		return acceptOutcome{}, err
	}
	if err := ensureMemberProfile(ctx, qtx, org.ID, userID, joiner.DisplayName, joiner.Email); err != nil {
		return acceptOutcome{}, err
	}
	if inv.WorkspaceID.Valid {
		if err := qtx.AddWorkspaceMember(ctx, db.AddWorkspaceMemberParams{WorkspaceID: ws.ID, OrganizationID: ws.OrganizationID, UserID: userID, Role: inv.Role}); err != nil {
			return acceptOutcome{}, err
		}
		if err := syncDefaultChatRoomMembers(ctx, qtx, ws.ID); err != nil {
			return acceptOutcome{}, err
		}
	}
	// The row is locked, so this only finds nothing if the invitation ran
	// out between the check above and here; the whole switch rolls back.
	marked, err := qtx.MarkInvitationAccepted(ctx, inv.ID)
	if err != nil {
		return acceptOutcome{}, err
	}
	if marked == 0 {
		return acceptOutcome{}, errInvitationExpired()
	}
	if _, err := qtx.MarkUserOnboarded(ctx, userID); err != nil {
		return acceptOutcome{}, err
	}
	entry := audit.Entry{
		OrganizationID: org.ID,
		Actor:          audit.User(userID),
		Action:         audit.ActionMemberJoined,
		ResourceType:   "organization_member", ResourceID: userID,
		Changes:  audit.Diff(nil, map[string]any{"role": orgRoleOrMember(inv.OrgRole)}),
		Metadata: map[string]any{"invitation_id": inv.ID},
	}
	payload := map[string]string{"organization_id": org.ID, "user_id": userID}
	if inv.WorkspaceID.Valid {
		entry.WorkspaceID = ws.ID
		entry.ResourceType = "workspace_member"
		entry.Changes = audit.Diff(nil, map[string]any{"role": inv.Role})
		payload["workspace_id"] = ws.ID
	}
	if err := auditRecorder.Record(ctx, qtx, entry, audit.Event{Topic: "member.joined", Payload: payload}); err != nil {
		return acceptOutcome{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return acceptOutcome{}, err
	}
	return acceptOutcome{org: org, workspaceID: inv.WorkspaceID.String, mailboxes: mailboxes}, nil
}

// giveUp runs the resolution of every conflict in organization id order, the
// order their rows were locked: leave, transfer then leave, or close (spec
// §4.4 step 5). Each step decides again under its own row locks; one that
// finds the organization changed since the conflicts were read makes the
// whole switch stale. The audit rows name the invitation and the organization
// being joined, so the trail shows a switch rather than a plain exit.
func (s *WorkspaceService) giveUp(ctx context.Context, q *db.Queries, userID, invitationID, joiningOrgID string,
	conflicts []MembershipConflict, plan map[string]SwitchResolution, locked map[string]bool,
) ([]db.DisconnectEmailHubAccountsForUserRow, error) {
	ordered := append([]MembershipConflict(nil), conflicts...)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i].Organization.ID < ordered[j].Organization.ID })
	meta := map[string]any{"invitation_id": invitationID, "switched_to_organization_id": joiningOrgID}
	var mailboxes []db.DisconnectEmailHubAccountsForUserRow
	for _, c := range ordered {
		orgID := c.Organization.ID
		if !locked[orgID] {
			// The account's lock keeps its memberships from growing, so
			// every conflict was among the rows taken; this is the guard.
			return nil, errSwitchStale
		}
		r := plan[orgID]
		var (
			rows []db.DisconnectEmailHubAccountsForUserRow
			err  error
		)
		switch r.Action {
		case SwitchActionLeave:
			rows, err = s.members.leaveQ(ctx, q, userID, orgID, meta)
		case SwitchActionTransfer:
			// EC-03: the heir must be an active member; transferOwnershipQ
			// checks it under the row locks.
			if _, err = transferOwnershipQ(ctx, q, userID, orgID, r.TransferToUserID); err == nil {
				rows, err = s.members.leaveQ(ctx, q, userID, orgID, meta)
			}
		case SwitchActionClose:
			rows, err = s.members.closeQ(ctx, q, userID, orgID, r.ConfirmSlug, meta)
		default:
			err = errSwitchStale
		}
		if err != nil {
			return nil, staleResolution(err)
		}
		mailboxes = append(mailboxes, rows...)
	}
	return mailboxes, nil
}

// Invitation states, as the invitation page shows them (spec §4.3).
const (
	InvitationPending  = "pending"
	InvitationExpired  = "expired"
	InvitationRevoked  = "revoked"
	InvitationAccepted = "accepted"
)

// invitationStatus reads the state off the row: accepted and revoked are
// final, and anything else past its expiry has expired.
func invitationStatus(accepted, revoked, expires pgtype.Timestamptz) string {
	switch {
	case accepted.Valid:
		return InvitationAccepted
	case revoked.Valid:
		return InvitationRevoked
	case !expires.Time.After(time.Now()):
		return InvitationExpired
	}
	return InvitationPending
}
