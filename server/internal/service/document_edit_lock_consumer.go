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

// DocumentEditLockReleaser is the outbox consumer that ends edit lock
// tenures when the holder loses the right to edit by something other than
// their own editor (UNI-1645 §3.5): a revoked session (edge 10, holds
// included - revoking a session revokes the device), a deactivation or
// departure, a removal, a share revoke or move that drops them below edit,
// a suspension, a delete. Archive is not here: it releases in its own
// transaction.
//
// It runs on the notify lane (main.go, A2): each release writes an audit row
// and a lock_changed frame and the re-checks read the ACL, more than the
// realtime lane's one indexed read allows. Every tenure is ended in its own
// transaction under its document row lock and only while it is still the
// document's unended tenure, so a re-delivered event finds nothing to do.
// The heartbeat re-checks the level every 30 s anyway; this makes an
// offline holder lose the lock too, and an online one sooner.
type DocumentEditLockReleaser struct {
	docs *DocumentService
}

// NewDocumentEditLockReleaser reads the ACL through the same DocumentService
// the document routes use.
func NewDocumentEditLockReleaser(docs *DocumentService) *DocumentEditLockReleaser {
	return &DocumentEditLockReleaser{docs: docs}
}

func (*DocumentEditLockReleaser) Name() string { return "document_edit_lock_releaser" }

func (*DocumentEditLockReleaser) Topics() []string {
	return []string{
		"session.revoked",
		"member.deactivated", "member.left", "member.removed",
		"document.share_revoked", "document.moved", "document.deleted",
		"organization.suspended",
	}
}

func (c *DocumentEditLockReleaser) Handle(ctx context.Context, ev outbox.Row) error {
	payload := map[string]string{}
	if ev.Payload != "" {
		if err := json.Unmarshal([]byte(ev.Payload), &payload); err != nil {
			return fmt.Errorf("document_edit_lock_releaser: payload of %s: %w", ev.ID, err)
		}
	}
	userID := strings.TrimSpace(payload["user_id"])
	documentID := strings.TrimSpace(payload["document_id"])
	orgID := strings.TrimSpace(payload["organization_id"])
	if orgID == "" {
		orgID = ev.OrganizationID.String
	}
	if ev.Topic == "session.revoked" {
		// A session is the person's, across organizations.
		return c.releaseSession(ctx, userID, strings.TrimSpace(payload["session_id"]))
	}
	if orgID == "" {
		return nil
	}
	switch ev.Topic {
	case "member.deactivated":
		return c.releaseUserInOrganization(ctx, orgID, userID, DocumentEditEndMemberDeactivated, false)
	case "member.left":
		return c.releaseUserInOrganization(ctx, orgID, userID, DocumentEditEndAccessLost, false)
	case "member.removed":
		// By organization, not by the workspace left: a document of another
		// workspace may read through a workspace share (as the lease
		// consumer, G508S-BE-2).
		return c.releaseUserInOrganization(ctx, orgID, userID, DocumentEditEndAccessLost, true)
	case "document.share_revoked", "document.moved":
		return c.recheckDocument(ctx, orgID, documentID)
	case "document.deleted":
		return c.releaseDeleted(ctx, orgID, documentID, strings.TrimSpace(payload["workspace_id"]))
	case "organization.suspended":
		return c.releaseOrganization(ctx, orgID)
	default:
		return nil
	}
}

func (c *DocumentEditLockReleaser) releaseSession(ctx context.Context, userID, sessionID string) error {
	if userID == "" {
		return nil
	}
	rows, err := c.docs.q.ListLiveDocumentEditLocksForSession(ctx, db.ListLiveDocumentEditLocksForSessionParams{
		UserID: userID, SessionID: sessionID,
	})
	if err != nil {
		return err
	}
	for _, l := range rows {
		if sessionID != "" && l.SessionID != sessionID && l.HoldDeviceSessionID.String != sessionID {
			continue
		}
		if err := c.docs.endTenureBySystem(ctx, l, DocumentEditEndSessionRevoked, nil); err != nil {
			return err
		}
	}
	return nil
}

// releaseUserInOrganization ends the person's tenures in one organization;
// recheck keeps those whose holder still edits the document.
func (c *DocumentEditLockReleaser) releaseUserInOrganization(ctx context.Context, orgID, userID, reason string, recheck bool) error {
	if userID == "" {
		return nil
	}
	rows, err := c.docs.q.ListLiveDocumentEditLocksForUserInOrg(ctx, db.ListLiveDocumentEditLocksForUserInOrgParams{
		OrganizationID: orgID, UserID: userID,
	})
	if err != nil {
		return err
	}
	var keep func(ctx context.Context, q *db.Queries, doc db.Document, l db.DocumentEditLock) (bool, error)
	if recheck {
		keep = c.docs.holderStillEdits
	}
	for _, l := range rows {
		if err := c.docs.endTenureBySystem(ctx, l, reason, keep); err != nil {
			return err
		}
	}
	return nil
}

func (c *DocumentEditLockReleaser) recheckDocument(ctx context.Context, orgID, documentID string) error {
	if documentID == "" {
		return nil
	}
	live, err := c.docs.q.GetLiveDocumentEditLock(ctx, db.GetLiveDocumentEditLockParams{
		OrganizationID: orgID, DocumentID: documentID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	return c.docs.endTenureBySystem(ctx, live, DocumentEditEndAccessLost, c.docs.holderStillEdits)
}

func (c *DocumentEditLockReleaser) releaseOrganization(ctx context.Context, orgID string) error {
	for {
		rows, err := c.docs.q.ListLiveDocumentEditLocksForOrganization(ctx, db.ListLiveDocumentEditLocksForOrganizationParams{
			OrganizationID: orgID, BatchLimit: documentEditLockSweepBatch,
		})
		if err != nil {
			return err
		}
		for _, l := range rows {
			if err := c.docs.endTenureBySystem(ctx, l, DocumentEditEndOrganizationSuspended, nil); err != nil {
				return err
			}
		}
		if len(rows) < int(documentEditLockSweepBatch) {
			return nil
		}
	}
}

// releaseDeleted ends the tenure of a document the purge removed. The row
// is gone, so there is no document lock to take; the tenant pair comes from
// the event.
func (c *DocumentEditLockReleaser) releaseDeleted(ctx context.Context, orgID, documentID, workspaceID string) error {
	if documentID == "" {
		return nil
	}
	live, err := c.docs.q.GetLiveDocumentEditLock(ctx, db.GetLiveDocumentEditLockParams{
		OrganizationID: orgID, DocumentID: documentID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if _, err := c.docs.q.GetDocumentByID(ctx, documentID); err == nil {
		// Still there (an older event, or a re-created id): the normal path.
		return c.docs.endTenureBySystem(ctx, live, DocumentEditEndDocumentDeleted, nil)
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	ops := &editLockOps{}
	tx, err := c.docs.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := c.docs.q.WithTx(tx)
	locked, err := q.LockLiveDocumentEditLock(ctx, db.LockLiveDocumentEditLockParams{OrganizationID: orgID, DocumentID: documentID})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	now, err := editLockClock(ctx, q)
	if err != nil {
		return err
	}
	doc := db.Document{ID: documentID, OrganizationID: orgID, WorkspaceID: workspaceID}
	if _, err := c.docs.releaseTenure(ctx, q, doc, locked, DocumentEditEndDocumentDeleted, documentEditLockSystem, now, ops); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	c.docs.flushEditLockOps(ops)
	return nil
}

// holderStillEdits is the consumer's re-check: the holder of l reads the
// document at edit or more now. A closed tenant gate or a lower level is a
// no; the archive state is ignored (archive releases on its own).
func (s *DocumentService) holderStillEdits(ctx context.Context, q *db.Queries, doc db.Document, l db.DocumentEditLock) (bool, error) {
	access, err := s.effectiveLevel(ctx, q, Human(l.UserID), doc)
	if err != nil {
		if isGateRefusal(err) {
			return false, nil
		}
		return false, err
	}
	return access.Level.AtLeast(DocumentLevelEdit), nil
}

// endTenureBySystem ends one tenure in its own transaction under its
// document row lock, as the system, if it is still the document's unended
// tenure and keep (when set) does not keep it.
func (s *DocumentService) endTenureBySystem(ctx context.Context, l db.DocumentEditLock, reason string, keep func(ctx context.Context, q *db.Queries, doc db.Document, l db.DocumentEditLock) (bool, error)) error {
	ops := &editLockOps{}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	doc, err := q.LockDocumentByID(ctx, l.DocumentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	live, err := q.LockLiveDocumentEditLock(ctx, db.LockLiveDocumentEditLockParams{
		OrganizationID: doc.OrganizationID, DocumentID: doc.ID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if live.ID != l.ID {
		return nil
	}
	if keep != nil {
		ok, err := keep(ctx, q, doc, live)
		if err != nil {
			return err
		}
		if ok {
			return nil
		}
	}
	now, err := editLockClock(ctx, q)
	if err != nil {
		return err
	}
	if _, err := s.releaseTenure(ctx, q, doc, live, reason, documentEditLockSystem, now, ops); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	s.flushEditLockOps(ops)
	return nil
}

// Compile-time check that the consumer fits the dispatcher.
var _ interface {
	Name() string
	Topics() []string
	Handle(context.Context, outbox.Row) error
} = (*DocumentEditLockReleaser)(nil)
