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

// Trashing a workspace folder (ADR 0037 point 5, UNI-2055): the folder's
// creator or an admin may trash it whatever it holds. A document they cannot
// manage - hidden from them, or readable without manage - is never trashed by
// them: it moves to the workspace root with its own subtree, its access and
// its title untouched. Everything else, every folder below included, goes to
// the trash in the command's one batch.

// planFolderTrash splits the bounded live subtree of a workspace folder into
// the ids the archive stamps and the documents it relocates. Walking down from
// the root, the first page or file the actor does not manage on each path
// relocates and takes its subtree with it; folders always go to the trash. A
// live node whose parent is not live (left under an already-trashed page)
// starts a walk of its own. It writes nothing, so the archive-impact read
// shares it. A work-product-owned node is never in a folder tree; one that is
// refuses the command as before rather than being moved.
func (s *DocumentService) planFolderTrash(ctx context.Context, q *db.Queries, actor Actor, root db.Document, live []string) (trash []string, relocate []db.Document, err error) {
	rows, err := q.ListDocumentsByIDs(ctx, db.ListDocumentsByIDsParams{
		OrganizationID: root.OrganizationID, WorkspaceID: root.WorkspaceID, Ids: live,
	})
	if err != nil {
		return nil, nil, err
	}
	unmanaged, err := s.unmanagedInSubtree(ctx, q, actor, root, live)
	if err != nil {
		return nil, nil, err
	}
	byID := make(map[string]bool, len(rows))
	for _, r := range rows {
		byID[r.ID] = true
	}
	children := make(map[string][]db.Document, len(rows))
	var starts []db.Document
	for _, r := range rows {
		switch {
		case r.ID == root.ID:
		case r.ParentID.Valid && byID[r.ParentID.String]:
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
// requireManageOnSubtree. Folders are not asked: they always go to the trash.
// A work-product-owned node refuses (ErrForbidden), as the old check did.
func (s *DocumentService) unmanagedInSubtree(ctx context.Context, q *db.Queries, actor Actor, root db.Document, live []string) (map[string]bool, error) {
	check := live
	if actor.Kind == audit.KindHuman {
		isMember, isAdmin, err := s.workspaceManageHints(ctx, q, root.WorkspaceID, actor.ID)
		if err != nil {
			return nil, err
		}
		check, err = q.ListDocumentSubtreeNeedingAccessCheck(ctx, db.ListDocumentSubtreeNeedingAccessCheckParams{
			IsWsAdmin: isAdmin, IsWsMember: isMember, ActorID: actor.ID,
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
		node, err := q.GetDocument(ctx, db.GetDocumentParams{
			ID: id, OrganizationID: root.OrganizationID, WorkspaceID: root.WorkspaceID,
		})
		if err != nil {
			return nil, err
		}
		if node.OwnerKind.Valid {
			return nil, ErrForbidden
		}
		if node.Kind == DocumentKindFolder {
			continue
		}
		err = s.requireManageOn(ctx, q, actor, node)
		switch {
		case errors.Is(err, ErrForbidden):
			out[id] = true
		case err != nil:
			return nil, err
		}
	}
	return out, nil
}

// relocateOutOfTrashedFolder moves each planned document to the workspace
// root inside the archive transaction, title kept (pages and files have no
// name index, and a relocation is not the owner's rename), at the end of the
// root list. Each gets one document.moved audit row - the hook UNI-2056
// notifies the owner from - and its ids-only frame in the same Record; the
// pages under it keep their parent and get no row.
func (s *DocumentService) relocateOutOfTrashedFolder(ctx context.Context, q *db.Queries, actor Actor, folder db.Document, batch string, relocate []db.Document) error {
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
				"from_folder_id": folder.ID,
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
