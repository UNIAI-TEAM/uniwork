package service

import (
	"context"
	"errors"
	"fmt"
	"strconv"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// foldersIntoMyFolderActor attributes the pass: a system job, never a person,
// so the history shows the folder was not moved by anyone's hand.
var foldersIntoMyFolderActor = audit.System("folder-ws-public")

const (
	foldersIntoMyFolderDefaultBatch = 200
	// foldersIntoMyFolderReason is metadata.reason on every row the pass moves;
	// it is never folder_trashed, which belongs to the Trash command (§5).
	foldersIntoMyFolderReason = "folders_into_my_folder"
	// myFolderDepth is the level a folder moved into My Folder lands under: My
	// Folder is a root row, so the moved subtree is one level deeper.
	myFolderDepth = 1
)

// FoldersIntoMyFolderSkip is one folder the pass left where it was, with why.
type FoldersIntoMyFolderSkip struct {
	FolderID string
	Reason   string
}

// FoldersIntoMyFolderReport is what one pass found or did. Units counts the
// units found (the skipped ones included); MovedFolders the folders put into
// a My Folder; RelocatedDocuments the documents of another owner taken out of
// a unit to the workspace root; RelocatedPublicFolders the workspace-visible
// folders taken out of a unit the same way (a public folder keeps its place
// in the workspace tree, it does not become private).
type FoldersIntoMyFolderReport struct {
	DryRun                 bool
	Units                  int
	MovedFolders           int
	RelocatedDocuments     int
	RelocatedPublicFolders int
	Skipped                []FoldersIntoMyFolderSkip
}

// MoveFoldersIntoMyFolder moves every private folder that sits outside My
// Folder into its owner's My Folder (ADR 0037 point 8, UNI-2055 S3). A unit is
// the highest private folder of one owner outside every My Folder tree; it
// keeps `restricted` and takes "(n)" from the move allocator when the My Folder
// already holds the name. Before a unit moves, what in its subtree is not the
// owner's is taken out so nobody loses a document into someone else's My
// Folder: a private folder of another owner becomes a unit of its own, a
// document of another owner (and a workspace-visible folder) goes to the
// workspace root with its subtree and its access untouched. The owner's My
// Folder is created when missing, deactivated members included.
//
// One unit is one transaction under the workspace tree lock, so an interrupted
// pass resumes by running again and a pass over a finished tree writes nothing.
// Every moved row is audited as document.moved by the system actor with
// metadata.reason folders_into_my_folder and one batch_id per pass, and emits
// the same ids-only document.moved frame a normal move does. A folder the pass
// cannot place (no owner, too deep, My Folder cannot be created) is reported as
// skipped and never fails the pass. Archived folders are included: a restore
// must never bring a private folder back to a public place. dryRun counts and
// writes nothing. organizationID limits the pass to one organization ("" is
// all of them).
func (s *DocumentService) MoveFoldersIntoMyFolder(ctx context.Context, dryRun bool, batchSize int, organizationID string) (FoldersIntoMyFolderReport, error) {
	if batchSize <= 0 {
		batchSize = foldersIntoMyFolderDefaultBatch
	}
	report := FoldersIntoMyFolderReport{DryRun: dryRun}
	batchID := util.NewID()
	after := ""
	// A dry run moves nothing, so a sub-folder counted inside its parent unit
	// would be found again as a candidate of its own; the ids placed so far are
	// remembered to count each unit once. A real run needs no memory: a placed
	// folder is already inside a My Folder.
	var placed map[string]bool
	if dryRun {
		placed = map[string]bool{}
	}
	for {
		rows, err := s.q.ListFolderUnitCandidates(ctx, db.ListFolderUnitCandidatesParams{
			OrganizationID: organizationID, AfterID: after, MaxRows: int32(batchSize),
		})
		if err != nil {
			return report, err
		}
		for _, r := range rows {
			after = r.ID
			out, err := s.foldersIntoMyFolderUnit(ctx, r.ID, dryRun, batchID, placed)
			if err != nil {
				return report, err
			}
			report.Units += out.Units
			report.MovedFolders += out.MovedFolders
			report.RelocatedDocuments += out.RelocatedDocuments
			report.RelocatedPublicFolders += out.RelocatedPublicFolders
			report.Skipped = append(report.Skipped, out.Skipped...)
		}
		if len(rows) < batchSize {
			return report, nil
		}
	}
}

// fimSkip is the "leave this folder alone" answer: it unwinds the unit, whose
// writes are rolled back, and becomes a Skipped row instead of a failure.
type fimSkip struct {
	folderID string
	reason   string
}

func (e fimSkip) Error() string { return "folder " + e.folderID + " skipped: " + e.reason }

// fimRun is one unit's transaction and what it has counted so far.
type fimRun struct {
	s       *DocumentService
	tx      pgx.Tx
	q       *db.Queries
	dryRun  bool
	batchID string
	unitID  string
	placed  map[string]bool // dry run only: units of earlier candidates
	seen    map[string]bool // units placed by this run, kept when it succeeds
	out     FoldersIntoMyFolderReport
}

// foldersIntoMyFolderUnit re-reads the candidate under the tree lock and its
// own row lock (a concurrent move or rename wins), decides whether it is still
// a unit, and places it.
func (s *DocumentService) foldersIntoMyFolderUnit(ctx context.Context, id string, dryRun bool, batchID string, placed map[string]bool) (FoldersIntoMyFolderReport, error) {
	if placed[id] {
		return FoldersIntoMyFolderReport{}, nil
	}
	first, err := s.q.GetDocumentByID(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return FoldersIntoMyFolderReport{}, nil
	}
	if err != nil {
		return FoldersIntoMyFolderReport{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return FoldersIntoMyFolderReport{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	if err := q.LockDocumentTree(ctx, first.WorkspaceID); err != nil {
		return FoldersIntoMyFolderReport{}, err
	}
	doc, err := q.LockDocumentByID(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return FoldersIntoMyFolderReport{}, nil
	}
	if err != nil {
		return FoldersIntoMyFolderReport{}, err
	}
	if !fimPrivateFolder(doc) {
		return FoldersIntoMyFolderReport{}, nil
	}
	unit, err := fimIsUnit(ctx, q, doc)
	if err != nil || !unit {
		return FoldersIntoMyFolderReport{}, err
	}
	run := &fimRun{s: s, tx: tx, q: q, dryRun: dryRun, batchID: batchID, unitID: doc.ID, placed: placed, seen: map[string]bool{}}
	err = run.placeUnit(ctx, doc)
	var skip fimSkip
	if errors.As(err, &skip) {
		out := FoldersIntoMyFolderReport{Units: 1, Skipped: []FoldersIntoMyFolderSkip{{FolderID: skip.folderID, Reason: skip.reason}}}
		if skip.folderID != doc.ID {
			out.Skipped = append(out.Skipped, FoldersIntoMyFolderSkip{FolderID: doc.ID, Reason: "blocked_by_sub_folder"})
		}
		return out, nil
	}
	if err != nil {
		return FoldersIntoMyFolderReport{}, err
	}
	if dryRun {
		for id := range run.seen {
			placed[id] = true
		}
		return run.out, nil
	}
	if err := tx.Commit(ctx); err != nil {
		return FoldersIntoMyFolderReport{}, err
	}
	return run.out, nil
}

// fimPrivateFolder is a plain private folder: no My Folder, no work-product
// owner, visibility restricted. A workspace-visible folder outside My Folder
// is public on purpose after ADR 0037 and is never a unit.
func fimPrivateFolder(d db.Document) bool {
	return d.Kind == DocumentKindFolder && !d.SystemKind.Valid && !d.OwnerKind.Valid &&
		d.Visibility == documentVisibilityRestricted
}

// fimIsUnit walks the ancestors: a folder inside a My Folder tree is done, and
// one under a private folder of the same owner travels with that folder.
func fimIsUnit(ctx context.Context, q *db.Queries, doc db.Document) (bool, error) {
	cur := doc.ParentID
	for i := 0; cur.Valid && i < 2*maxDocumentDepth+2; i++ {
		p, err := q.GetDocumentByID(ctx, cur.String)
		if errors.Is(err, pgx.ErrNoRows) {
			return true, nil
		}
		if err != nil {
			return false, err
		}
		if isMyFolder(p) {
			return false, nil
		}
		if doc.AclOwnerID.Valid && fimPrivateFolder(p) && p.AclOwnerID == doc.AclOwnerID {
			return false, nil
		}
		cur = p.ParentID
	}
	return true, nil
}

type fimRelocation struct {
	id     string
	folder bool
}

// placeUnit puts one unit into its owner's My Folder after taking out what is
// not the owner's. Sub-folders of other owners recurse as units of their own.
func (r *fimRun) placeUnit(ctx context.Context, unit db.Document) error {
	if r.placed[unit.ID] {
		return nil
	}
	r.seen[unit.ID] = true
	r.out.Units++
	if !unit.AclOwnerID.Valid || unit.AclOwnerID.String == "" {
		return fimSkip{folderID: unit.ID, reason: "no_owner"}
	}
	owner := unit.AclOwnerID.String
	subtree, err := r.q.ListDocumentSubtree(ctx, db.ListDocumentSubtreeParams{
		OrganizationID: unit.OrganizationID, WorkspaceID: unit.WorkspaceID, RootID: unit.ID,
		MaxLevel: subtreeMaxLevel(),
	})
	if err != nil {
		return err
	}
	height := int32(1)
	children := make(map[string][]db.ListDocumentSubtreeRow, len(subtree))
	for _, n := range subtree {
		if n.SubtreeDepth > height {
			height = n.SubtreeDepth
		}
		if n.ParentID.Valid && n.ID != unit.ID {
			children[n.ParentID.String] = append(children[n.ParentID.String], n)
		}
	}
	if myFolderDepth+int(height) > maxDocumentDepth {
		return fimSkip{folderID: unit.ID, reason: "too_deep"}
	}

	var relocate []fimRelocation
	var subUnits []string
	// kept: the node sits in the unit owner's own tree. loose: it sits under a
	// row that is leaving for the root, so only private folders need a home.
	var walk func(parentID string, kept bool)
	walk = func(parentID string, kept bool) {
		for _, c := range children[parentID] {
			if c.OwnerKind.Valid || (c.SystemKind.Valid && c.SystemKind.String == DocumentSystemKindMyFolder) {
				continue
			}
			isFolder := c.Kind == DocumentKindFolder
			private := isFolder && c.Visibility == documentVisibilityRestricted
			foreign := c.AclOwnerID.Valid && c.AclOwnerID.String != owner
			switch {
			case !kept && private:
				subUnits = append(subUnits, c.ID)
			case !kept:
				walk(c.ID, false)
			case isFolder && !private:
				relocate = append(relocate, fimRelocation{id: c.ID, folder: true})
				walk(c.ID, false)
			case private && foreign:
				subUnits = append(subUnits, c.ID)
			case !isFolder && foreign:
				relocate = append(relocate, fimRelocation{id: c.ID})
				walk(c.ID, false)
			default:
				walk(c.ID, true)
			}
		}
	}
	walk(unit.ID, true)

	for _, rel := range relocate {
		if !r.dryRun {
			if err := r.moveRow(ctx, rel.id, ""); err != nil {
				return err
			}
		}
		if rel.folder {
			r.out.RelocatedPublicFolders++
		} else {
			r.out.RelocatedDocuments++
		}
	}
	for _, id := range subUnits {
		sub, err := r.q.LockDocumentByID(ctx, id)
		if errors.Is(err, pgx.ErrNoRows) {
			continue
		}
		if err != nil {
			return err
		}
		if err := r.placeUnit(ctx, sub); err != nil {
			return err
		}
	}

	if r.dryRun {
		r.out.MovedFolders++
		return nil
	}
	mf, _, err := r.s.ensureMyFolderInTx(ctx, r.tx, r.q, Human(owner), unit.OrganizationID, unit.WorkspaceID)
	if err != nil {
		return fimSkip{folderID: unit.ID, reason: "my_folder_unavailable: " + err.Error()}
	}
	if err := r.moveRow(ctx, unit.ID, mf.ID); err != nil {
		return err
	}
	r.out.MovedFolders++
	return nil
}

// moveRow is the move write of MoveDocument for one row, as the system actor:
// the destination's name clash gets "(n)" from the same allocator, the write
// runs in a savepoint that is retried against the folder-name index, and the
// audit row and the outbox frame commit with it. The row is re-locked first so
// its revision is the one the write checks. Visibility is never touched.
func (r *fimRun) moveRow(ctx context.Context, id, newParentID string) error {
	row, err := r.q.LockDocumentByID(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	position, err := r.q.NextDocumentPosition(ctx, db.NextDocumentPositionParams{
		OrganizationID: row.OrganizationID, WorkspaceID: row.WorkspaceID, ParentID: nullText(newParentID),
	})
	if err != nil {
		return err
	}
	scope := documentNameScope{
		OrganizationID: row.OrganizationID, WorkspaceID: row.WorkspaceID,
		ParentID: newParentID, Kind: row.Kind, ExcludeID: row.ID,
	}
	var updated db.Document
	var title string
	var moveErr error
	for attempt := 1; attempt <= titleWriteAttempts; attempt++ {
		moveErr = r.s.withTitleSavepoint(ctx, r.tx, attempt, func() error {
			name := titleDecision{Title: row.Title}
			// A row in the Trash takes no part in the name index; its restore
			// allocates its own name.
			if !row.ArchivedAt.Valid {
				var err error
				if name, err = r.s.availableMoveTitle(ctx, r.q, scope, row.Title); err != nil {
					return err
				}
			}
			moved, err := r.q.MoveDocumentAnyState(ctx, db.MoveDocumentAnyStateParams{
				ParentID:         nullText(newParentID),
				Position:         position,
				Title:            name.Title,
				SearchText:       documentSearchText(name.Title, row.ContentText),
				UpdatedBy:        foldersIntoMyFolderActor.ID,
				UpdatedByKind:    string(foldersIntoMyFolderActor.Kind),
				ID:               row.ID,
				OrganizationID:   row.OrganizationID,
				WorkspaceID:      row.WorkspaceID,
				ExpectedRevision: row.Revision,
			})
			if errors.Is(err, pgx.ErrNoRows) {
				return errRevisionConflict(row.Revision)
			}
			if err != nil {
				return err
			}
			updated, title = moved, name.Title
			return nil
		})
		if moveErr == nil {
			break
		}
		if !isUniqueViolation(moveErr) {
			return moveErr
		}
		if attempt == titleWriteAttempts {
			return fmt.Errorf("move %s: %w", row.ID, documentTitleWriteError(row.Kind, moveErr))
		}
	}
	before := map[string]any{"parent_id": textOrNil(row.ParentID), "position": row.Position}
	after := map[string]any{"parent_id": textOrNil(updated.ParentID), "position": updated.Position}
	if title != row.Title {
		before["title"], after["title"] = row.Title, title
	}
	return auditRecorder.Record(ctx, r.q, audit.Entry{
		OrganizationID: row.OrganizationID,
		WorkspaceID:    row.WorkspaceID,
		Actor:          foldersIntoMyFolderActor,
		Action:         audit.ActionDocumentMoved,
		ResourceType:   "document",
		ResourceID:     row.ID,
		Changes:        audit.Diff(before, after),
		Metadata: map[string]any{
			"revision": strconv.FormatInt(updated.Revision, 10),
			"reason":   foldersIntoMyFolderReason,
			"batch_id": r.batchID,
			"unit_id":  r.unitID,
		},
	}, audit.Event{Topic: "document.moved", Payload: map[string]string{
		"document_id": updated.ID, "workspace_id": updated.WorkspaceID,
	}})
}
