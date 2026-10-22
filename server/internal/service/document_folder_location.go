package service

import (
	"context"
	"errors"
	"net/http"
	"strconv"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Folder location (ADR 0037, UNI-2055): a folder outside every My Folder tree
// is the workspace's - visibility='workspace', workspace_level='view' - and a
// folder inside one stays restricted. The location decides, never a request:
// create, move and the admin command write the pair through these helpers,
// and every other home-row command refuses a folder (folder_not_shareable).

// isWorkspaceFolder reports whether doc is a workspace folder as stored: a
// user folder (not a My Folder, not work-product-owned) that is open to its
// workspace. Only the location rule writes that state, so the columns are
// enough; no ancestor walk is needed.
func isWorkspaceFolder(doc db.Document) bool {
	return doc.Kind == DocumentKindFolder && !doc.SystemKind.Valid && !doc.OwnerKind.Valid &&
		doc.Visibility == documentVisibilityWorkspace
}

// folderInMyFolderTree reports whether doc is a My Folder or sits anywhere
// under one, walking the parent chain through q (inside a tree writer that
// holds the workspace tree lock, so the chain cannot move under the walk). It
// takes any document kind, so a create passes the parent it will land under.
// A chain longer than twice the tree bound is reported as too deep, as
// documentDepth does.
func folderInMyFolderTree(ctx context.Context, q *db.Queries, doc db.Document) (bool, error) {
	cur := doc
	for steps := 0; ; steps++ {
		if isMyFolder(cur) {
			return true, nil
		}
		if !cur.ParentID.Valid {
			return false, nil
		}
		if steps > 2*maxDocumentDepth {
			return false, errDocumentTooDeep()
		}
		p, err := q.GetDocument(ctx, db.GetDocumentParams{
			ID: cur.ParentID.String, OrganizationID: cur.OrganizationID, WorkspaceID: cur.WorkspaceID,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		if err != nil {
			return false, err
		}
		cur = p
	}
}

// folderHomeRowAt is the pair a folder is stored with at its location:
// restricted inside a My Folder tree, workspace/view everywhere else.
func folderHomeRowAt(inMyFolder bool) (visibility, level string) {
	if inMyFolder {
		return documentVisibilityRestricted, string(DocumentLevelView)
	}
	return documentVisibilityWorkspace, string(DocumentLevelView)
}

// parentInMyFolderTree is folderInMyFolderTree for a create's parent: the
// workspace root (nil) is outside every My Folder.
func parentInMyFolderTree(ctx context.Context, q *db.Queries, parent *db.Document) (bool, error) {
	if parent == nil {
		return false, nil
	}
	return folderInMyFolderTree(ctx, q, *parent)
}

// contributesToWorkspaceFolder is the create gate's one widening (ADR 0037
// §4): inside a workspace folder every human member of its workspace may
// create - a folder, a page, a file, a folder upload, or move their own
// document in - although the folder grants them only view. The role comes
// from the workspace gate itself; the roles that exist (owner, admin, member)
// all edit in the workspace. Agents never pass: they never write documents
// (ADR 0010). The view level never grants edit on the folder itself or on any
// document inside it: this answers only "may this parent take a child".
func (s *DocumentService) contributesToWorkspaceFolder(ctx context.Context, q *db.Queries, actor Actor, parent db.Document) (bool, error) {
	if actor.Kind != audit.KindHuman || !isWorkspaceFolder(parent) || parent.ArchivedAt.Valid {
		return false, nil
	}
	m, err := s.ws.RequireMemberQ(ctx, q, parent.WorkspaceID, actor.ID)
	if errors.Is(err, ErrForbidden) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	switch m.Role {
	case "owner", "admin", "member":
		return true, nil
	default:
		return false, nil
	}
}

// decideParentContribution is decideDocumentAccess(parent, edit) with the
// workspace-folder widening: a reader of a workspace folder refused edit is
// let through when contributesToWorkspaceFolder says so; every other answer
// (not found, archived, forbidden) stands.
func (s *DocumentService) decideParentContribution(ctx context.Context, q *db.Queries, actor Actor, parent db.Document, access DocumentAccess) error {
	err := decideDocumentAccess(parent, access, DocumentLevelEdit)
	if !errors.Is(err, ErrForbidden) {
		return err
	}
	ok, cerr := s.contributesToWorkspaceFolder(ctx, q, actor, parent)
	if cerr != nil {
		return cerr
	}
	if ok {
		return nil
	}
	return err
}

func errFolderIntoMyFolder() error {
	return coded(http.StatusUnprocessableEntity, "folder_into_my_folder", "thư mục chung của workspace không thể chuyển vào Thư mục của tôi")
}

// relocateSubtreeFolders applies the location rule to the folders of a moved
// subtree, inside MoveDocument's transaction after the move write. Into a My
// Folder tree a subtree holding a workspace folder is refused before any
// write (refuseWorkspaceFoldersIntoMyFolder); out of one, every folder of the
// subtree that is not workspace/view yet opens: one document.moved row (the
// root already has its own from the move) and one
// document.workspace_access_changed row with its frame per folder. Pages and
// files are never touched - moving changes no document's access.
func (s *DocumentService) relocateSubtreeFolders(ctx context.Context, q *db.Queries, actor Actor, moved db.Document, subtree []db.ListDocumentSubtreeRow) (db.Document, error) {
	visibility, level := folderHomeRowAt(false)
	for _, n := range subtree {
		if n.Kind != DocumentKindFolder || n.SystemKind.Valid || n.OwnerKind.Valid {
			continue
		}
		if n.Visibility == visibility && n.WorkspaceLevel == level {
			continue
		}
		if n.ID == moved.ID {
			updated, err := writeDocumentHomeRow(ctx, q, actor, moved, documentHomeRowMove{
				Visibility: visibility, WorkspaceLevel: level, FolderLocation: true,
				// The move already bumped the root's revision once.
				KeepRevision: true,
			})
			if err != nil {
				return db.Document{}, err
			}
			moved = updated
			continue
		}
		row, err := q.LockDocumentByID(ctx, n.ID)
		if errors.Is(err, pgx.ErrNoRows) {
			continue
		}
		if err != nil {
			return db.Document{}, err
		}
		updated, err := writeDocumentHomeRow(ctx, q, actor, row, documentHomeRowMove{
			Visibility: visibility, WorkspaceLevel: level, FolderLocation: true,
		})
		if err != nil {
			return db.Document{}, err
		}
		if err := auditRecorder.Record(ctx, q, audit.Entry{
			OrganizationID: updated.OrganizationID,
			WorkspaceID:    updated.WorkspaceID,
			Actor:          actor,
			Action:         audit.ActionDocumentMoved,
			ResourceType:   "document",
			ResourceID:     updated.ID,
			Metadata: map[string]any{
				"revision": strconv.FormatInt(updated.Revision, 10),
				// The folder moved because its ancestor did.
				"moved_with": moved.ID,
			},
		}, audit.Event{Topic: "document.moved", Payload: map[string]string{
			"document_id": updated.ID, "workspace_id": updated.WorkspaceID,
		}}); err != nil {
			return db.Document{}, err
		}
	}
	return moved, nil
}

// refuseWorkspaceFoldersIntoMyFolder is the 422 of ADR 0037 §6: a workspace
// folder - the moved one or any folder below it - never enters a My Folder.
func refuseWorkspaceFoldersIntoMyFolder(subtree []db.ListDocumentSubtreeRow) error {
	for _, n := range subtree {
		if n.Kind == DocumentKindFolder && !n.SystemKind.Valid && !n.OwnerKind.Valid &&
			n.Visibility == documentVisibilityWorkspace {
			return errFolderIntoMyFolder()
		}
	}
	return nil
}
