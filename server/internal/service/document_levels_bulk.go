package service

import (
	"context"
	"slices"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// resolveLevelsInTenantWithShares is resolveLevelInTenantWithShares for many
// human users of one document at once (UNI-2012 SF1): the same answer for each
// user, from a handful of set reads plus the share set the caller already
// holds, instead of a workspace-gate read per user. A chat document grant to a
// 10,000-member room and a Documents batch share resolve every recipient
// through it inside one transaction that holds the document row lock, so the
// cost of this call is the lock's hold time.
//
// Like the single resolver, it runs after the caller proved each user's place
// in the document's organization (OrganizationService.AdmittedMemberIDsQ), and
// shares is the live share set read before the first write. Every id has an
// entry; a user the workspace gate refuses simply has none of the workspace
// paths and keeps whatever the shares give them. An owned document (§13.4) is
// resolved user by user, because its level comes from the owner resolver and
// not from the rows read here; no grant path reaches one today.
func (s *DocumentService) resolveLevelsInTenantWithShares(
	ctx context.Context, q *db.Queries, doc db.Document, shares []db.DocumentShare, userIDs []string,
) (map[string]DocumentAccess, error) {
	out := make(map[string]DocumentAccess, len(userIDs))
	if len(userIDs) == 0 {
		return out, nil
	}
	if doc.OwnerKind.Valid {
		for _, id := range userIDs {
			acc, err := s.resolveLevelInTenantWithShares(ctx, q, Human(id), doc, shares)
			if err != nil && !isGateRefusal(err) {
				return nil, err
			}
			out[id] = acc
		}
		return out, nil
	}

	roles, err := q.ListActiveWorkspaceRolesForUsers(ctx, db.ListActiveWorkspaceRolesForUsersParams{
		OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, UserIds: userIDs,
	})
	if err != nil {
		return nil, err
	}
	roleOf := make(map[string]string, len(roles))
	for _, r := range roles {
		roleOf[r.UserID] = r.Role
	}
	// The workspace member path, as resolveLevelInTenantFromShares writes it.
	adminScope := make(map[string]bool)
	below := make([]string, 0, len(userIDs))
	for _, id := range userIDs {
		acc := DocumentAccess{}
		if role, member := roleOf[id]; member {
			isACLOwner := doc.AclOwnerID.Valid && doc.AclOwnerID.String == id
			switch {
			case (role == "owner" || role == "admin") && doc.Visibility == documentVisibilityRestricted && !isACLOwner:
				adminScope[id] = true
			case role == "owner" || role == "admin", isACLOwner:
				acc = DocumentAccess{Level: DocumentLevelManage, Via: DocumentViaMember}
			case doc.Visibility != documentVisibilityRestricted:
				acc = DocumentAccess{Level: DocumentLevel(doc.WorkspaceLevel), Via: DocumentViaMember}
			}
		}
		out[id] = acc
		if acc.Level != DocumentLevelManage {
			below = append(below, id)
		}
	}

	if err := s.raiseLevelsFromShares(ctx, q, doc, shares, below, out); err != nil {
		return nil, err
	}

	// AdminScope with no level yet: a live break-glass grant gives view.
	var needGrant []string
	for _, id := range below {
		if adminScope[id] && out[id].Level == DocumentLevelNone {
			needGrant = append(needGrant, id)
		}
	}
	if len(needGrant) > 0 {
		grants, err := q.ListLiveBreakGlassGrantsForActors(ctx, db.ListLiveBreakGlassGrantsForActorsParams{
			OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID, ActorIds: needGrant,
		})
		if err != nil {
			return nil, err
		}
		granted := make(map[string]bool, len(grants))
		for _, g := range grants {
			if granted[g.ActorID] {
				continue // the newest grant of an actor comes first
			}
			granted[g.ActorID] = true
			out[g.ActorID] = DocumentAccess{
				Level: capDocumentLevel(DocumentLevel(g.Level), DocumentLevelView), Via: DocumentViaBreakGlass,
			}
		}
	}
	for id := range adminScope {
		acc := out[id]
		acc.AdminScope = true
		out[id] = acc
	}
	return out, nil
}

// raiseLevelsFromShares applies the live shares to the users in below: each
// user ends at the highest level among the shares that cover them, when that
// beats the level they already hold (shareAppliesTo's rules: a user principal
// covers that user, the organization principal everyone, and a workspace
// principal of the document's organization the workspace's effective members,
// read through one membership query per workspace share that can still raise
// somebody). out is updated in place.
func (s *DocumentService) raiseLevelsFromShares(
	ctx context.Context, q *db.Queries, doc db.Document, shares []db.DocumentShare, below []string, out map[string]DocumentAccess,
) error {
	if len(below) == 0 || len(shares) == 0 {
		return nil
	}
	isBelow := make(map[string]bool, len(below))
	for _, id := range below {
		isBelow[id] = true
	}
	raise := func(id string, lvl DocumentLevel) {
		if lvl.rank() > out[id].Level.rank() {
			out[id] = DocumentAccess{Level: lvl, Via: DocumentViaShare}
		}
	}
	// Highest level first, so a workspace share that cannot raise anyone any
	// more is skipped without a membership read.
	ordered := slices.Clone(shares)
	slices.SortStableFunc(ordered, func(a, b db.DocumentShare) int {
		return DocumentLevel(b.Level).rank() - DocumentLevel(a.Level).rank()
	})
	for _, sh := range ordered {
		if sh.OrganizationID != doc.OrganizationID {
			continue
		}
		lvl := DocumentLevel(sh.Level)
		switch sh.PrincipalType {
		case DocumentPrincipalUser:
			if isBelow[sh.PrincipalID] {
				raise(sh.PrincipalID, lvl)
			}
		case DocumentPrincipalOrganization:
			if sh.PrincipalID == doc.OrganizationID {
				for _, id := range below {
					raise(id, lvl)
				}
			}
		case DocumentPrincipalWorkspace:
			var candidates []string
			for _, id := range below {
				if lvl.rank() > out[id].Level.rank() {
					candidates = append(candidates, id)
				}
			}
			if len(candidates) == 0 {
				continue
			}
			inOrg, err := workspaceInOrganization(ctx, q, sh.PrincipalID, doc.OrganizationID)
			if err != nil {
				return err
			}
			if !inOrg {
				continue
			}
			members, err := s.ws.AdmittedMemberIDsQ(ctx, q, sh.PrincipalID, candidates)
			if err != nil {
				return err
			}
			for _, id := range candidates {
				if members[id] {
					raise(id, lvl)
				}
			}
		}
	}
	return nil
}

// notifyOnUsersShare is notifyOnUserShare for a whole batch: the recipients
// whose effective level the command strictly raises to level, decided against
// the command-start shares in one resolve (UNI-2012 SF1). The actor's own
// grant never notifies. Every id in userIDs has passed the organization gate.
func (s *DocumentService) notifyOnUsersShare(
	ctx context.Context, q *db.Queries, actor Actor, doc db.Document, sharesBefore []db.DocumentShare, userIDs []string, level DocumentLevel,
) (map[string]string, error) {
	candidates := make([]string, 0, len(userIDs))
	for _, id := range userIDs {
		if actor.Kind == audit.KindHuman && id == actor.ID {
			continue
		}
		candidates = append(candidates, id)
	}
	levels, err := s.resolveLevelsInTenantWithShares(ctx, q, doc, sharesBefore, candidates)
	if err != nil {
		return nil, err
	}
	notify := make(map[string]string, len(candidates))
	for _, id := range candidates {
		if level.rank() > levels[id].Level.rank() {
			notify[id] = id
		}
	}
	return notify, nil
}
