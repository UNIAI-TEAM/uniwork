package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Document tree (C-01 §5.1, G1-04b, UNI-678): the parent_id move and the
// workspace tree read. A folder is a page without content, so every tree
// operation is a document operation; the whole subtree moves and archives
// with its root. Every tree write follows the one order the code paths
// share - the idempotency ledger claim, then the workspace tree lock, then
// document row locks (N-01) - so two moves in one workspace serialize and
// can never interleave into a cycle.
//
// Move checks permission on BOTH ends: edit on the document being moved and
// edit on the destination page. Depth and cycle checks are computed on the
// whole subtree, not the moved node alone.

const (
	idempotencyScopeDocumentMove    = "documents.move"
	idempotencyScopeDocumentArchive = "documents.archive"
	idempotencyScopeDocumentRestore = "documents.restore"
)

func errDocumentCycle() error {
	return coded(http.StatusUnprocessableEntity, "document_cycle", "không thể đưa tài liệu vào chính nhánh của nó")
}

func errDocumentCrossWorkspace() error {
	return coded(http.StatusUnprocessableEntity, "cross_workspace_reference", "tài liệu cha phải cùng workspace")
}

// MoveDocumentInput is POST /documents/{id}/move: the new parent ("" moves
// to the workspace root), the sibling position (nil appends last) and the
// revision the client last saw.
type MoveDocumentInput struct {
	ParentID       string
	Position       *float64
	Revision       int64
	IdempotencyKey string
}

// MoveDocument reparents a document inside one workspace. The subtree rides
// along untouched - only the root's parent and position change.
func (s *DocumentService) MoveDocument(ctx context.Context, actor Actor, documentID string, in MoveDocumentInput) (DocumentView, error) {
	if !validActor(actor) || documentID == "" {
		return DocumentView{}, ErrNotFound
	}
	doc, err := s.q.GetDocumentByID(ctx, documentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return DocumentView{}, ErrNotFound
	}
	if err != nil {
		return DocumentView{}, err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return DocumentView{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	opts := IdempotencyOptions{
		Fingerprint: IdempotencyFingerprint(idempotencyScopeDocumentMove, doc.ID, in.ParentID,
			positionFingerprint(in.Position), strconv.FormatInt(in.Revision, 10)),
		RequireFingerprint: true,
	}
	replay, commit, err := BeginIdempotent(ctx, q, doc.OrganizationID, doc.WorkspaceID,
		idempotencyScopeDocumentMove, in.IdempotencyKey, actor.ID, opts)
	if err != nil {
		return DocumentView{}, NormalizeIdempotencyError(err)
	}
	if replay != nil {
		view, err := s.replayCreatedPage(ctx, q, actor, doc.OrganizationID, doc.WorkspaceID, replay.Body)
		if err != nil {
			return DocumentView{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return DocumentView{}, err
		}
		return view, nil
	}
	// Ledger claim first, then the tree lock, then the document row locks:
	// every tree writer in this workspace queues on this advisory lock, so a
	// concurrent move cannot inspect the tree between this command's checks
	// and its write.
	if err := q.LockDocumentTree(ctx, doc.WorkspaceID); err != nil {
		return DocumentView{}, err
	}
	doc, err = q.LockDocumentByID(ctx, documentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return DocumentView{}, ErrNotFound
	}
	if err != nil {
		return DocumentView{}, err
	}
	access, err := s.effectiveLevel(ctx, q, actor, doc)
	if err != nil {
		return DocumentView{}, err
	}
	if access.Level == DocumentLevelNone {
		// Nothing readable at all is not found - the owned refusal below
		// must never confirm an id to a caller who cannot see it.
		return DocumentView{}, ErrNotFound
	}
	if doc.OwnerKind.Valid {
		// §13: a work-product-owned document has no tree slot; the owner
		// service archives and removes it through the internal seam.
		return DocumentView{}, errDocumentOwned()
	}
	if err := decideDocumentAccess(doc, access, DocumentLevelEdit); err != nil {
		return DocumentView{}, err
	}
	// The self-parent check sits behind the access gate: answering
	// document_cycle before it would tell a stranger the id exists.
	if in.ParentID == documentID {
		return DocumentView{}, errDocumentCycle()
	}
	if doc.ArchivedAt.Valid {
		return DocumentView{}, errDocumentDeleted()
	}
	if in.Revision != doc.Revision {
		return DocumentView{}, errRevisionConflict(doc.Revision)
	}

	// The subtree tells both checks what they need: the members for the
	// cycle test and the height for the depth bound.
	subtree, err := q.ListDocumentSubtree(ctx, db.ListDocumentSubtreeParams{
		OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, RootID: doc.ID,
	})
	if err != nil {
		return DocumentView{}, err
	}
	inSubtree := make(map[string]bool, len(subtree))
	subtreeHeight := int32(1)
	for _, n := range subtree {
		inSubtree[n.ID] = true
		if n.SubtreeDepth > subtreeHeight {
			subtreeHeight = n.SubtreeDepth
		}
	}

	var parent db.Document
	if in.ParentID != "" {
		// Classify the id before locking: a document of another
		// organization answers not found like an unknown one - never a
		// cross-tenant existence oracle, and never a row lock outside this
		// workspace's tenant. Only a same-organization other-workspace id
		// is the named cross_workspace_reference.
		p, err := q.GetDocumentByID(ctx, in.ParentID)
		if errors.Is(err, pgx.ErrNoRows) {
			return DocumentView{}, ErrNotFound
		}
		if err != nil {
			return DocumentView{}, err
		}
		if p.OrganizationID != doc.OrganizationID {
			return DocumentView{}, ErrNotFound
		}
		if p.WorkspaceID != doc.WorkspaceID {
			// The distinct reason is only for a caller who can already see
			// the foreign-workspace row (its members, or a share recipient);
			// anyone else gets the unknown-id answer so the 422 never
			// confirms the id exists (Backend ID Rules).
			paccess, err := s.effectiveLevel(ctx, q, actor, p)
			if err != nil {
				return DocumentView{}, err
			}
			if paccess.Level == DocumentLevelNone {
				return DocumentView{}, ErrNotFound
			}
			return DocumentView{}, errDocumentCrossWorkspace()
		}
		parent, err = q.LockDocumentByID(ctx, in.ParentID)
		if errors.Is(err, pgx.ErrNoRows) {
			return DocumentView{}, ErrNotFound
		}
		if err != nil {
			return DocumentView{}, err
		}
		if parent.OwnerKind.Valid || parent.ArchivedAt.Valid {
			return DocumentView{}, ErrNotFound
		}
		if parent.Kind != DocumentKindPage {
			return DocumentView{}, Invalid("chỉ trang mới chứa được trang con")
		}
		paccess, err := s.effectiveLevel(ctx, q, actor, parent)
		if err != nil {
			return DocumentView{}, err
		}
		if err := decideDocumentAccess(parent, paccess, DocumentLevelEdit); err != nil {
			return DocumentView{}, err
		}
		if inSubtree[parent.ID] {
			return DocumentView{}, errDocumentCycle()
		}
		depth, err := documentDepth(ctx, q, parent)
		if err != nil {
			return DocumentView{}, err
		}
		if depth+int(subtreeHeight) > maxDocumentDepth {
			return DocumentView{}, errDocumentTooDeep()
		}
	}

	position := 0.0
	if in.Position != nil {
		position = *in.Position
	} else {
		position, err = q.NextDocumentPosition(ctx, db.NextDocumentPositionParams{
			OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, ParentID: nullText(in.ParentID),
		})
		if err != nil {
			return DocumentView{}, err
		}
	}
	updated, err := q.MoveDocument(ctx, db.MoveDocumentParams{
		ParentID:         nullText(in.ParentID),
		Position:         position,
		UpdatedBy:        actor.ID,
		UpdatedByKind:    string(actor.Kind),
		ID:               doc.ID,
		OrganizationID:   doc.OrganizationID,
		WorkspaceID:      doc.WorkspaceID,
		ExpectedRevision: doc.Revision,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return DocumentView{}, errRevisionConflict(doc.Revision)
	}
	if err != nil {
		return DocumentView{}, err
	}
	before := map[string]any{"parent_id": textOrNil(doc.ParentID), "position": doc.Position}
	after := map[string]any{"parent_id": textOrNil(updated.ParentID), "position": updated.Position}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: doc.OrganizationID,
		WorkspaceID:    doc.WorkspaceID,
		Actor:          actor,
		Action:         audit.ActionDocumentMoved,
		ResourceType:   "document",
		ResourceID:     doc.ID,
		Changes:        audit.Diff(before, after),
		Metadata:       map[string]any{"revision": strconv.FormatInt(updated.Revision, 10)},
	}, audit.Event{Topic: "document.moved", Payload: map[string]string{
		"document_id": updated.ID, "workspace_id": updated.WorkspaceID,
	}}); err != nil {
		return DocumentView{}, err
	}
	view, err := s.documentView(ctx, q, actor, updated)
	if err != nil {
		return DocumentView{}, err
	}
	body, err := json.Marshal(pageReplay{DocumentID: updated.ID})
	if err != nil {
		return DocumentView{}, err
	}
	if err := commit(http.StatusOK, body); err != nil {
		return DocumentView{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return DocumentView{}, err
	}
	return view, nil
}

func positionFingerprint(p *float64) string {
	if p == nil {
		return ""
	}
	return strconv.FormatFloat(*p, 'g', -1, 64)
}

// DocumentTreeNode is one node of the tree read (GET .../documents/tree):
// id, the sidebar labels, its sibling position and its children in order.
// Nodes below an ancestor the caller cannot read do not appear - the tree
// never reveals a restricted page's place in the forest (the flat list
// still shows the node itself when the actor may read it).
type DocumentTreeNode struct {
	ID       string             `json:"id"`
	ParentID string             `json:"parent_id,omitempty"`
	Title    string             `json:"title"`
	Icon     string             `json:"icon,omitempty"`
	Kind     string             `json:"kind"`
	Position float64            `json:"position"`
	Children []DocumentTreeNode `json:"children"`
}

// DocumentTree returns the visible subtree under rootID ("" = the roots) as
// a forest. Visible means at least view through the same rules the list
// query applies; a root the caller cannot read is not found, its children
// are not leaked through it.
func (s *DocumentService) DocumentTree(ctx context.Context, actor Actor, workspaceID, rootID string) ([]DocumentTreeNode, error) {
	scope, err := s.documentListScope(ctx, actor, workspaceID)
	if err != nil {
		return nil, err
	}
	rows, err := s.q.ListTreeDocuments(ctx, db.ListTreeDocumentsParams{
		OrganizationID: scope.organizationID, WorkspaceID: workspaceID,
		SeeAll: scope.seeAll, MemberVisible: scope.memberVisible,
		AclOwner: scope.aclOwner, ActorID: nullText(scope.actorID),
		AllowShares: scope.allowShares, ShareWorkspaces: scope.shareWorkspaces,
	})
	if err != nil {
		return nil, err
	}
	byID := make(map[string]db.Document, len(rows))
	children := make(map[string][]db.Document, len(rows))
	for _, d := range rows {
		byID[d.ID] = d
	}
	for _, d := range rows {
		// An invisible parent hides the whole edge: the node does not float
		// to the root, it leaves the tree with its unreadable ancestor.
		if d.ParentID.Valid {
			if _, ok := byID[d.ParentID.String]; ok {
				children[d.ParentID.String] = append(children[d.ParentID.String], d)
			}
		}
	}
	if rootID == "" {
		var roots []db.Document
		for _, d := range rows {
			if !d.ParentID.Valid {
				roots = append(roots, d)
			}
		}
		return buildTreeNodes(roots, children, 1), nil
	}
	if _, ok := byID[rootID]; !ok {
		return nil, ErrNotFound
	}
	return buildTreeNodes(children[rootID], children, 1), nil
}

func buildTreeNodes(docs []db.Document, children map[string][]db.Document, depth int) []DocumentTreeNode {
	nodes := make([]DocumentTreeNode, 0, len(docs))
	for _, d := range docs {
		node := DocumentTreeNode{
			ID:       d.ID,
			ParentID: d.ParentID.String,
			Title:    d.Title,
			Icon:     d.Icon.String,
			Kind:     d.Kind,
			Position: d.Position,
			Children: []DocumentTreeNode{},
		}
		if depth < maxDocumentDepth {
			node.Children = buildTreeNodes(children[d.ID], children, depth+1)
		}
		nodes = append(nodes, node)
	}
	return nodes
}
