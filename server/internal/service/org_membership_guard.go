package service

import (
	"context"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// One account belongs to at most one active organization (ADR 0032). There is
// no unique index behind the rule: accounts that already belong to several
// organizations keep them (D2), and the index could not see an organization's
// status. Every command that adds or removes a membership instead takes the
// account's advisory lock first and decides on activeOrganizations read
// inside the same transaction, so two tabs or two API calls queue behind each
// other and the second one sees what the first committed.

// lockMembership serializes every membership change of one account (ADR 0032).
// It is transaction-scoped: q must be bound to the caller's transaction, and
// it is taken before any membership or invitation row lock.
func lockMembership(ctx context.Context, q *db.Queries, userID string) error {
	return q.LockUserMembership(ctx, userID)
}

// activeOrganizations lists the organizations the account counts as belonging
// to (D1): a membership not deactivated, in an organization that is active or
// suspended. Suspended counts, so suspension cannot be used to slip a second
// membership in.
func activeOrganizations(ctx context.Context, q *db.Queries, userID string) ([]db.ListActiveOrganizationsForUserRow, error) {
	return q.ListActiveOrganizationsForUser(ctx, userID)
}

// OrganizationRef names an organization in an error's details.
type OrganizationRef struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Slug string `json:"slug"`
}

// Required actions: what the person must do with an organization they belong
// to before they can join another (spec §4.3).
const (
	SwitchActionLeave    = "leave"
	SwitchActionTransfer = "transfer"
	SwitchActionClose    = "close"
	SwitchActionBlocked  = "blocked"
)

// MembershipConflict is one organization that stands between the account and
// an invitation it wants to accept.
type MembershipConflict struct {
	Organization   OrganizationRef `json:"organization"`
	Role           string          `json:"role"`
	RequiredAction string          `json:"required_action"`
	BlockedReason  string          `json:"blocked_reason,omitempty"`
	// TransferCandidatesCount is how many other active members could take
	// the organization over.
	TransferCandidatesCount int64 `json:"transfer_candidates_count"`
}

// membershipConflicts is every active organization of the account except
// joiningOrgID, each with the action it needs (spec §4.3): a member or admin
// leaves; an owner transfers when somebody could take over and closes when
// they are alone; the owner of a suspended organization needs support.
func membershipConflicts(ctx context.Context, q *db.Queries, userID, joiningOrgID string) ([]MembershipConflict, error) {
	rows, err := activeOrganizations(ctx, q, userID)
	if err != nil {
		return nil, err
	}
	out := []MembershipConflict{}
	for _, r := range rows {
		if r.ID == joiningOrgID {
			continue
		}
		c := MembershipConflict{
			Organization: OrganizationRef{ID: r.ID, Name: r.Name, Slug: r.Slug},
			Role:         r.Role, RequiredAction: SwitchActionLeave,
			TransferCandidatesCount: r.OtherActiveMembers,
		}
		if r.Role == OrgRoleOwner {
			switch {
			case r.Status != OrganizationActive:
				c.RequiredAction = SwitchActionBlocked
				c.BlockedReason = "owner_of_suspended_organization"
			case r.OtherActiveMembers > 0:
				c.RequiredAction = SwitchActionTransfer
			default:
				c.RequiredAction = SwitchActionClose
			}
		}
		out = append(out, c)
	}
	return out, nil
}
