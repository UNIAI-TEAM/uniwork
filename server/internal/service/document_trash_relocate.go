package service

import (
	"context"
	"errors"
	"sort"
	"strconv"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Trashing a root with a live subtree (ADR 0037 point 5, UNI-2055 for a
// workspace folder, UNI-2074 for every other root: a page, a file, a legacy
// private folder, a My Folder sub-folder): whoever passed the root's gate may
// trash it whatever it holds. A page or file below that they cannot manage -
// hidden from them, or readable without manage - is never trashed by them: it
// moves to the workspace root with its own subtree, its access and its title
// untouched, a root inside My Folder included. Everything else goes to the
// trash in the command's one batch.

// planSubtreeTrash splits the bounded live subtree of a trashed root into the
// ids the archive stamps and the documents it relocates. Walking down from
// the root, the first page or file the actor does not manage on each path
// relocates and takes its subtree with it; folders always go to the trash. A
// live node whose parent is not live (left under an already-trashed page)
// starts a walk of its own. It writes nothing, so the archive-impact read
// shares it. A work-product-owned node is never in a document tree; one that
// is refuses the command as before rather than being moved.
func (s *DocumentService) planSubtreeTrash(ctx context.Context, q *db.Queries, actor Actor, root db.Document, live []string) (trash []string, relocate []db.Document, err error) {
	rows, err := q.ListDocumentsByIDs(ctx, db.ListDocumentsByIDsParams{
		OrganizationID: root.OrganizationID, WorkspaceID: root.WorkspaceID, Ids: live,
	})
	if err != nil {
		return nil, nil, err
	}
	byID := make(map[string]db.Document, len(rows))
	for _, r := range rows {
		byID[r.ID] = r
	}
	unmanaged, err := s.unmanagedInSubtree(ctx, q, actor, root, live, byID)
	if err != nil {
		return nil, nil, err
	}
	children := make(map[string][]db.Document, len(rows))
	var starts []db.Document
	for _, r := range rows {
		switch {
		case r.ID == root.ID:
		case r.ParentID.Valid && byID[r.ParentID.String].ID != "":
			children[r.ParentID.String] = append(children[r.ParentID.String], r)
		default:
			starts = append(starts, r)
		}
	}
	queue := append([]db.Document{root}, starts...)
	for i := 0; i < len(queue); i++ {
		n := queue[i]
		if n.ID != root.ID && n.Kind != DocumentKindFolder && unmanaged[n.ID] {
			relocate = append(relocate, n)
			continue
		}
		trash = append(trash, n.ID)
		queue = append(queue, children[n.ID]...)
	}
	sort.Strings(trash)
	sort.Slice(relocate, func(i, j int) bool { return relocate[i].ID < relocate[j].ID })
	return trash, relocate, nil
}

// unmanagedInSubtree names the pages and files of the live id set the actor
// does not manage, on the same trivial-rule prefilter as
// requireManageOnSubtree, reading the nodes from the rows the plan already
// loaded. Workspace folders are not asked: they always go to the trash. Any
// other folder (a legacy private one, another person's) is asked like before
// ADR 0037 and refuses the whole command when the actor does not manage it -
// it is never relocated (folders have a unique name index). A page or file
// the actor cannot READ is unmanaged too, even for an admin who administers it
// without reading (AdminScope alone, UNI-2055 TV-02): the trash is for what the
// actor sees and manages, the rest relocates. A work-product-owned node
// refuses (ErrForbidden), as the old check did.
func (s *DocumentService) unmanagedInSubtree(ctx context.Context, q *db.Queries, actor Actor, root db.Document, live []string, rows map[string]db.Document) (map[string]bool, error) {
	check := live
	if actor.Kind == audit.KindHuman {
		isMember, _, err := s.workspaceManageHints(ctx, q, root.WorkspaceID, actor.ID)
		if err != nil {
			return nil, err
		}
		check, err = q.ListDocumentSubtreeNeedingAccessCheck(ctx, db.ListDocumentSubtreeNeedingAccessCheckParams{
			// IsWsAdmin stays false: an admin manages every node but may not
			// read it, so the admin shortcut would hide the nodes to relocate.
			IsWsAdmin: false, IsWsMember: isMember, ActorID: actor.ID,
			OrganizationID: root.OrganizationID, WorkspaceID: root.WorkspaceID, Ids: live,
		})
		if err != nil {
			return nil, err
		}
	}
	out := map[string]bool{}
	for _, id := range check {
		if id == root.ID {
			continue
		}
		node, ok := rows[id]
		if !ok {
			continue
		}
		if node.OwnerKind.Valid {
			return nil, ErrForbidden
		}
		if isWorkspaceFolder(node) {
			continue
		}
		lvl, err := s.effectiveLevel(ctx, q, actor, node)
		if err != nil {
			return nil, err
		}
		if node.Kind == DocumentKindFolder {
			// A legacy folder the actor cannot read refuses the command, even
			// for an admin who administers it without reading it.
			if !lvl.Level.AtLeast(DocumentLevelView) {
				return nil, ErrForbidden
			}
			if err := manageDecision(node, lvl); err != nil {
				return nil, err
			}
			continue
		}
		if !lvl.Level.AtLeast(DocumentLevelView) {
			out[id] = true
			continue
		}
		switch err := manageDecision(node, lvl); {
		case errors.Is(err, ErrForbidden):
			out[id] = true
		case err != nil:
			return nil, err
		}
	}
	return out, nil
}

// relocateOutOfTrashedRoot moves each planned document to the workspace
// root inside the archive transaction, title kept (pages and files have no
// name index, and a relocation is not the owner's rename), at the end of the
// root list. Each gets one document.moved audit row - the hook UNI-2056
// notifies the owner from - and its ids-only frame in the same Record; the
// pages under it keep their parent and get no row. The row keeps the reason
// folder_trashed and the key from_folder_id whatever the root's kind (the
// hook keys on them) and names that kind in from_kind, so the notice can say
// a page rather than a folder was trashed.
func (s *DocumentService) relocateOutOfTrashedRoot(ctx context.Context, q *db.Queries, actor Actor, root db.Document, batch string, relocate []db.Document) error {
	for _, d := range relocate {
		row, err := q.LockDocumentByID(ctx, d.ID)
		if err != nil {
			return err
		}
		position, err := q.NextDocumentPosition(ctx, db.NextDocumentPositionParams{
			OrganizationID: row.OrganizationID, WorkspaceID: row.WorkspaceID, ParentID: pgtype.Text{},
		})
		if err != nil {
			return err
		}
		// The stored title goes back unchanged, whatever shape a legacy row
		// has: a relocation is not the owner's rename.
		moved, err := q.DetachDocumentToRoot(ctx, db.DetachDocumentToRootParams{
			ID: row.ID, OrganizationID: row.OrganizationID, WorkspaceID: row.WorkspaceID,
			Position: position, Title: row.Title, SearchText: documentSearchText(row.Title, row.ContentText),
			UpdatedBy: actor.ID, UpdatedByKind: string(actor.Kind),
		})
		if errors.Is(err, pgx.ErrNoRows) {
			continue
		}
		if err != nil {
			return err
		}
		before := map[string]any{"parent_id": textOrNil(row.ParentID), "position": row.Position}
		after := map[string]any{"parent_id": nil, "position": moved.Position}
		if err := auditRecorder.Record(ctx, q, audit.Entry{
			OrganizationID: moved.OrganizationID,
			WorkspaceID:    moved.WorkspaceID,
			Actor:          actor,
			Action:         audit.ActionDocumentMoved,
			ResourceType:   "document",
			ResourceID:     moved.ID,
			Changes:        audit.Diff(before, after),
			Metadata: map[string]any{
				"revision":       strconv.FormatInt(moved.Revision, 10),
				"reason":         audit.ReasonFolderTrashed,
				"from_folder_id": root.ID,
				"from_kind":      root.Kind,
				"batch_id":       batch,
			},
		}, audit.Event{Topic: "document.moved", Payload: map[string]string{
			"document_id": moved.ID, "workspace_id": moved.WorkspaceID,
		}}); err != nil {
			return err
		}
	}
	return nil
}

// attachFolderEmptiness sets IsEmpty on the live folder rows of a list page:
// true when the caller may list nothing directly inside the folder (ADR 0037,
// per viewer - a workspace folder holding only documents the caller cannot
// read still lists, empty for them). One query over the page's folders, on
// the tree's own reader predicate.
func (s *DocumentService) attachFolderEmptiness(ctx context.Context, actor Actor, workspaceID string, items []DocumentListItem) error {
	var folders []string
	for _, it := range items {
		if it.Document.Kind == DocumentKindFolder && !it.Document.ArchivedAt.Valid && it.Document.WorkspaceID == workspaceID {
			folders = append(folders, it.Document.ID)
		}
	}
	if len(folders) == 0 {
		return nil
	}
	scope, err := s.documentListScope(ctx, actor, workspaceID)
	if err != nil {
		return err
	}
	holding, err := s.q.ListFoldersHoldingReadableDocuments(ctx, db.ListFoldersHoldingReadableDocumentsParams{
		OrganizationID: scope.organizationID, WorkspaceID: workspaceID, FolderIds: folders,
		MaxLevel: subtreeMaxLevel(),
		SeeAll:   scope.seeAll, MemberVisible: scope.memberVisible,
		AclOwner: scope.aclOwner, ActorID: nullText(scope.actorID),
		AllowShares: scope.allowShares, ShareLevels: shareLevelsFor(DocumentLevelView),
		ShareWorkspaces: scope.shareWorkspaces,
	})
	if err != nil {
		return err
	}
	holds := make(map[string]bool, len(holding))
	for _, id := range holding {
		holds[id] = true
	}
	for i := range items {
		d := items[i].Document
		if d.Kind == DocumentKindFolder && !d.ArchivedAt.Valid && d.WorkspaceID == workspaceID {
			empty := !holds[d.ID]
			items[i].IsEmpty = &empty
		}
	}
	return nil
}
