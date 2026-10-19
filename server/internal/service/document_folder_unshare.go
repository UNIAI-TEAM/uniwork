package service

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// folderUnshareActor attributes the clean-up rows: a system job, never a
// person, so the history shows the access did not change by anyone's hand.
var folderUnshareActor = audit.System("folder-share-off")

const folderUnshareDefaultBatch = 200

// FolderUnshareReport is what one pass found or did.
type FolderUnshareReport struct {
	DryRun bool
	// Folders is the folders that held an access (visibility workspace or a
	// live share); Shares the live share rows on them, the workspace home row
	// not counted.
	Folders int
	Shares  int
	// HomeRows is the folders that were workspace-visible.
	HomeRows int
}

// UnshareFolders makes every folder private and revokes the live shares on it
// (UNI-1974, CLAUDE.md: a folder is never shared). The documents inside are not
// touched: shares never inherit, so their own access is the same before and
// after. It runs the existing home-row writer and the share revoker, so each
// change carries its audit row and its document.workspace_access_changed /
// document.share_revoked frame, and one folder is one transaction: an
// interrupted pass resumes by running again, and a pass over clean data
// writes nothing. dryRun counts and writes nothing. Archived folders are
// included, so a restore never brings a shared folder back.
func (s *DocumentService) UnshareFolders(ctx context.Context, dryRun bool, batchSize int) (FolderUnshareReport, error) {
	if batchSize <= 0 {
		batchSize = folderUnshareDefaultBatch
	}
	report := FolderUnshareReport{DryRun: dryRun}
	batchID := util.NewID()
	after := ""
	for {
		rows, err := s.q.ListSharedFoldersForUnshare(ctx, db.ListSharedFoldersForUnshareParams{
			AfterID: after, MaxRows: int32(batchSize),
		})
		if err != nil {
			return report, err
		}
		for _, r := range rows {
			after = r.ID
			home, shares, err := s.unshareOneFolder(ctx, r.ID, dryRun, batchID)
			if err != nil {
				return report, err
			}
			if home || shares > 0 {
				report.Folders++
				report.Shares += shares
				if home {
					report.HomeRows++
				}
			}
		}
		if len(rows) < batchSize {
			return report, nil
		}
	}
}

// unshareOneFolder re-reads the folder under its row lock (a concurrent PATCH
// or revoke wins), then closes the home row and revokes the live shares.
func (s *DocumentService) unshareOneFolder(ctx context.Context, id string, dryRun bool, batchID string) (home bool, shares int, err error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return false, 0, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	doc, err := q.LockDocumentByID(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, 0, nil
	}
	if err != nil {
		return false, 0, err
	}
	if doc.Kind != DocumentKindFolder || isMyFolder(doc) || doc.OwnerKind.Valid {
		return false, 0, nil
	}
	live, err := q.ListDocumentShares(ctx, db.ListDocumentSharesParams{
		OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID,
	})
	if err != nil {
		return false, 0, err
	}
	home = doc.Visibility == documentVisibilityWorkspace
	// A share naming the folder's own workspace is the legacy twin of the home
	// row and is revoked by the home-row writer, not counted twice here.
	own := 0
	for _, sh := range live {
		if sh.PrincipalType == DocumentPrincipalWorkspace && sh.PrincipalID == doc.WorkspaceID {
			own++
		}
	}
	shares = len(live) - own
	if dryRun {
		return home || own > 0, shares, nil
	}
	if home || own > 0 {
		doc, err = writeDocumentHomeRow(ctx, q, folderUnshareActor, doc, documentHomeRowMove{
			Visibility: documentVisibilityRestricted, WorkspaceLevel: doc.WorkspaceLevel, BatchID: batchID,
		})
		if err != nil {
			return false, 0, err
		}
	}
	remaining, err := q.ListDocumentShares(ctx, db.ListDocumentSharesParams{
		OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID,
	})
	if err != nil {
		return false, 0, err
	}
	for _, sh := range remaining {
		if err := revokeDocumentShareRowWithBatch(ctx, q, folderUnshareActor, doc, sh, batchID); err != nil {
			return false, 0, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return false, 0, err
	}
	return home || own > 0, shares, nil
}
