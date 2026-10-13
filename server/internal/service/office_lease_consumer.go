package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/outbox"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// OfficeLeaseRevoker is the outbox consumer that revokes offline leases when
// access is taken away by something other than a session revoke (G5-D1 row
// 8, threat model T3, T4, T5): a deactivation, a removal from a workspace or
// the organization, a share revoke, a move, a delete and a suspension. Each
// revoke writes its audit row and office_lease.revoked event in the same
// transaction (recordOfficeLeaseRevokes).
//
// It runs on the notify lane (main.go): it reads and updates the database
// only - no third party, nothing measured in seconds - but it fans out over
// a person's or a document's leases and re-reads the ACL of each, which is
// more than the realtime lane's one indexed read or keyed upsert allows.
//
// Targeted events re-check the live ACL of every candidate lease and revoke
// only those that lost read access, so a person who still reads a document
// through another path (a share, another workspace) keeps it. A removal
// enumerates the person's leases by organization, not by the workspace they
// were removed from: a document of another workspace reads through a
// workspace-principal share whose workspace the person just left, and the
// lease is stored under the document's workspace (G508S-BE-2). A
// deactivation or a departure revokes the person's leases in that
// organization outright, even when they still belong to another organization
// and their sessions stay live (F9). Archive is not a revoke (G5-D1 row 14):
// an archived document keeps its leases to expiry, the renewal answers
// document_archived. Every path is idempotent: a re-delivered event finds the
// rows revoked.
type OfficeLeaseRevoker struct {
	docs *DocumentService
}

// NewOfficeLeaseRevoker reads the ACL through the same DocumentService the
// document routes use.
func NewOfficeLeaseRevoker(docs *DocumentService) *OfficeLeaseRevoker {
	return &OfficeLeaseRevoker{docs: docs}
}

func (*OfficeLeaseRevoker) Name() string { return "office_lease_revoker" }

func (*OfficeLeaseRevoker) Topics() []string {
	return []string{
		"member.deactivated", "member.left", "member.removed",
		"document.share_revoked", "document.moved", "document.deleted",
		"organization.suspended",
	}
}

func (c *OfficeLeaseRevoker) Handle(ctx context.Context, ev outbox.Row) error {
	payload := map[string]string{}
	if ev.Payload != "" {
		if err := json.Unmarshal([]byte(ev.Payload), &payload); err != nil {
			return fmt.Errorf("office_lease_revoker: payload of %s: %w", ev.ID, err)
		}
	}
	orgID := strings.TrimSpace(payload["organization_id"])
	if orgID == "" {
		orgID = ev.OrganizationID.String
	}
	if orgID == "" {
		return nil
	}
	userID := strings.TrimSpace(payload["user_id"])
	documentID := strings.TrimSpace(payload["document_id"])
	switch ev.Topic {
	case "member.deactivated":
		return c.revokeUserInOrganization(ctx, orgID, userID, OfficeLeaseRevokeMemberDeactivated)
	case "member.left":
		return c.revokeUserInOrganization(ctx, orgID, userID, OfficeLeaseRevokeMemberRemoved)
	case "member.removed":
		// The workspace the person was removed from is deliberately not the
		// enumeration: see recheckUserInOrganization.
		return c.recheckUserInOrganization(ctx, orgID, userID)
	case "document.share_revoked":
		return c.recheckDocument(ctx, orgID, documentID, OfficeLeaseRevokeShareRevoked)
	case "document.moved":
		return c.recheckDocument(ctx, orgID, documentID, OfficeLeaseRevokeDocumentMoved)
	case "document.deleted":
		return c.revokeDocument(ctx, orgID, documentID)
	case "organization.suspended":
		return c.revokeOrganization(ctx, orgID)
	default:
		return nil
	}
}

func (c *OfficeLeaseRevoker) revokeUserInOrganization(ctx context.Context, orgID, userID, reason string) error {
	if userID == "" {
		return nil
	}
	n, err := c.inTx(ctx, func(q *db.Queries) (int, error) {
		rows, err := q.RevokeOfficeOfflineLeasesForUserInOrganization(ctx, db.RevokeOfficeOfflineLeasesForUserInOrganizationParams{
			OrganizationID: orgID, UserID: userID, Reason: reason,
		})
		if err != nil {
			return 0, err
		}
		refs := make([]officeLeaseRef, len(rows))
		for i, r := range rows {
			refs[i] = officeLeaseRef(r)
		}
		return recordOfficeLeaseRevokes(ctx, q, officeLeaseRevokeActor, reason, refs)
	})
	if err != nil {
		return err
	}
	observeOfficeLeaseRevokes(reason, n)
	return nil
}

// recheckUserInOrganization re-reads the live ACL of every lease the person
// holds in the organization and revokes the ones they no longer read (reason
// member_removed). The enumeration is by organization, not by the workspace
// they were removed from (G508S-BE-2): a document of workspace A reads for a
// member of workspace B through a workspace-principal share naming B
// (shareAppliesTo re-checks B's membership at read time), while its lease is
// stored under the document's workspace A - a workspace-scoped enumeration
// missed it and wrote no revoke at all. stillReads is the grant's own path,
// so a document kept readable through a user share or any other path keeps
// its lease.
func (c *OfficeLeaseRevoker) recheckUserInOrganization(ctx context.Context, orgID, userID string) error {
	if userID == "" {
		return nil
	}
	n, err := c.inTx(ctx, func(q *db.Queries) (int, error) {
		rows, err := q.ListLiveOfficeOfflineLeasesForUserInOrganization(ctx, db.ListLiveOfficeOfflineLeasesForUserInOrganizationParams{
			OrganizationID: orgID, UserID: userID,
		})
		if err != nil {
			return 0, err
		}
		var lost []string
		for _, r := range rows {
			ok, err := c.stillReads(ctx, q, userID, r.DocumentID)
			if err != nil {
				return 0, err
			}
			if !ok {
				lost = append(lost, r.ID)
			}
		}
		return revokeOfficeLeaseIDs(ctx, q, orgID, lost, OfficeLeaseRevokeMemberRemoved)
	})
	if err != nil {
		return err
	}
	observeOfficeLeaseRevokes(OfficeLeaseRevokeMemberRemoved, n)
	return nil
}

// recheckDocument re-reads the live ACL of every holder of a lease on the
// document and revokes the leases of those who no longer read it.
func (c *OfficeLeaseRevoker) recheckDocument(ctx context.Context, orgID, documentID, reason string) error {
	if documentID == "" {
		return nil
	}
	n, err := c.inTx(ctx, func(q *db.Queries) (int, error) {
		rows, err := q.ListLiveOfficeOfflineLeasesForDocument(ctx, db.ListLiveOfficeOfflineLeasesForDocumentParams{
			OrganizationID: orgID, DocumentID: documentID,
		})
		if err != nil {
			return 0, err
		}
		readers := map[string]bool{}
		var lost []string
		for _, r := range rows {
			ok, seen := readers[r.UserID]
			if !seen {
				if ok, err = c.stillReads(ctx, q, r.UserID, documentID); err != nil {
					return 0, err
				}
				readers[r.UserID] = ok
			}
			if !ok {
				lost = append(lost, r.ID)
			}
		}
		return revokeOfficeLeaseIDs(ctx, q, orgID, lost, reason)
	})
	if err != nil {
		return err
	}
	observeOfficeLeaseRevokes(reason, n)
	return nil
}

func (c *OfficeLeaseRevoker) revokeDocument(ctx context.Context, orgID, documentID string) error {
	if documentID == "" {
		return nil
	}
	n, err := c.inTx(ctx, func(q *db.Queries) (int, error) {
		rows, err := q.ListLiveOfficeOfflineLeasesForDocument(ctx, db.ListLiveOfficeOfflineLeasesForDocumentParams{
			OrganizationID: orgID, DocumentID: documentID,
		})
		if err != nil {
			return 0, err
		}
		ids := make([]string, len(rows))
		for i, r := range rows {
			ids[i] = r.ID
		}
		return revokeOfficeLeaseIDs(ctx, q, orgID, ids, OfficeLeaseRevokeDocumentDeleted)
	})
	if err != nil {
		return err
	}
	observeOfficeLeaseRevokes(OfficeLeaseRevokeDocumentDeleted, n)
	return nil
}

// revokeOrganization revokes the live leases of a suspended organization.
// The suspension already bumped the policy epoch in its own transaction, so
// none of them renews even before this runs; this makes the holders' online
// devices lock now instead of at the next renewal.
func (c *OfficeLeaseRevoker) revokeOrganization(ctx context.Context, orgID string) error {
	n, err := c.inTx(ctx, func(q *db.Queries) (int, error) {
		return revokeOfficeLeasesForOrganization(ctx, q, officeLeaseRevokeActor, orgID, OfficeLeaseRevokePolicyEpoch)
	})
	if err != nil {
		return err
	}
	observeOfficeLeaseRevokes(OfficeLeaseRevokePolicyEpoch, n)
	return nil
}

// stillReads reports whether the person reads the document now. The archive
// state is ignored (G5-D1 row 14); a gone document, a closed tenant gate or
// level none is a no.
func (c *OfficeLeaseRevoker) stillReads(ctx context.Context, q *db.Queries, userID, documentID string) (bool, error) {
	doc, err := q.GetDocumentByID(ctx, documentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	access, err := c.docs.effectiveLevel(ctx, q, Human(userID), doc)
	if err != nil {
		if isGateRefusal(err) {
			return false, nil
		}
		return false, err
	}
	return access.Level != DocumentLevelNone, nil
}

// inTx runs one revoke in its own transaction and returns how many leases it
// recorded; the caller observes the counter only after this returns without
// error - that is, only once the transaction has committed (G508S-BE-5).
func (c *OfficeLeaseRevoker) inTx(ctx context.Context, fn func(q *db.Queries) (int, error)) (int, error) {
	tx, err := c.docs.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	n, err := fn(c.docs.q.WithTx(tx))
	if err != nil {
		return 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return n, nil
}

// revokeOfficeLeaseIDs revokes the named live leases of one organization and
// returns how many it recorded in the caller's transaction.
func revokeOfficeLeaseIDs(ctx context.Context, q *db.Queries, orgID string, ids []string, reason string) (int, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	rows, err := q.RevokeOfficeOfflineLeasesByIDs(ctx, db.RevokeOfficeOfflineLeasesByIDsParams{
		OrganizationID: orgID, Ids: ids, Reason: reason,
	})
	if err != nil {
		return 0, err
	}
	refs := make([]officeLeaseRef, len(rows))
	for i, r := range rows {
		refs[i] = officeLeaseRef(r)
	}
	return recordOfficeLeaseRevokes(ctx, q, officeLeaseRevokeActor, reason, refs)
}
