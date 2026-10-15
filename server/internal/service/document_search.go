package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Document listing and search (C-01 §5.1/§3.7, G1-04b, UNI-678). One SQL
// permission predicate (document_search.sql) does the authorization inside
// the query, so the limit is applied to rows the caller may actually read -
// never fetch-50-filter-to-2. Cursors are stable: they pin the ordering
// value of the last row returned, so inserts between two pages change
// neither the next page's contents nor its order.
//
// Free queries never see work-product-owned documents (owner_id IS NULL in
// every predicate); owned search belongs to the owner service (§13.6). A
// file document's search_text is its metadata only - the file text index
// accepts a verified extractor result and nothing else writes the column.

const (
	defaultDocumentListPage = 50
	maxDocumentListPage     = 100

	// DocumentKindDocument is the list filter for every non-folder document
	// (pages and files; E6/FD-05, UNI-1465).
	DocumentKindDocument = "document"
	// DocumentMatchTitle switches workspace search from search_text to
	// uw_fold_search(title).
	DocumentMatchTitle = "title"
)

// ListDocumentsInput is GET /workspaces/{ws}/documents.
//   - ParentID nil: the flat list (all/recent kinds of listings a workspace
//     member pages through); a pointer lists one level of the tree
//     ("" for the roots).
//   - Query runs the folded-text search over the whole workspace - it
//     ignores ParentID, the way search behaves in the client.
//   - Archived switches to the trash view (manage-only).
type ListDocumentsInput struct {
	ParentID    *string
	Query       string
	Kind        string
	Match       string
	Archived    bool
	UpdatedBy   string
	UpdatedFrom time.Time
	UpdatedTo   time.Time
	Cursor      string
	Limit       int
}

// DocumentPathItem is one ancestor step from root to direct parent on a
// workspace list result row (E6/FD-05, UNI-1465).
type DocumentPathItem struct {
	ID    string
	Title string
}

// DocumentListItem is one result row. Snippet is a short excerpt of
// content_text when Query matched, empty otherwise (and always empty for
// file documents - only metadata is searched).
type DocumentListItem struct {
	Document db.Document
	Snippet  string
	Facts    DocumentListFacts
	// EditLock is who is editing this row's document right now, when a live
	// tenure exists (UNI-1645 §3.2); nil when nobody holds it. It never
	// carries the tenure id - that is R1's or the holder's.
	EditLock *DocumentEditLockSummary
	// Access is the actor's level on the row (document_list_access.go); the
	// zero value means the service did not compute it.
	Access DocumentAccess
	Path   []DocumentPathItem
}

// DocumentListPage is one page plus the cursor for the next.
type DocumentListPage struct {
	Items      []DocumentListItem
	NextCursor string
}

// documentCursor pins the ordering value of the last row returned. At pairs
// with the (updated_at|archived_at, id) descending lists, Pos with the
// position-ordered children list; exactly one is set.
type documentCursor struct {
	At  *time.Time `json:"t,omitempty"`
	Pos *float64   `json:"p,omitempty"`
	ID  string     `json:"id"`
}

func encodeDocumentCursor(c documentCursor) string {
	raw, _ := json.Marshal(c)
	return base64.RawURLEncoding.EncodeToString(raw)
}

func decodeDocumentCursor(s string) (documentCursor, error) {
	if s == "" {
		return documentCursor{}, nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return documentCursor{}, Invalid("cursor không hợp lệ")
	}
	var c documentCursor
	if err := json.Unmarshal(raw, &c); err != nil || c.ID == "" || (c.At == nil && c.Pos == nil) || (c.At != nil && c.Pos != nil) {
		return documentCursor{}, Invalid("cursor không hợp lệ")
	}
	return c, nil
}

// documentListScope is the actor's standing in the workspace the list runs
// against - what the shared SQL permission predicate needs, resolved once
// per request through the same gates effectiveLevel uses.
type documentListScope struct {
	organizationID string
	actorID        string
	// seeAll is workspace owner/admin: manage on every document.
	seeAll bool
	// memberVisible is the workspace-member paths: visibility='workspace',
	// and acl_owner (both only ever true for an effective member).
	memberVisible bool
	// aclOwner gates the acl_owner leg: only an effective human member can
	// hold it - resolveLevel never reaches the check for an agent or a
	// non-member, and neither does the SQL.
	aclOwner bool
	// allowShares gates every share leg: agents are never share principals
	// (resolveLevel answers the same), so for an agent this is false and a
	// share row can never admit one to a restricted document.
	allowShares bool
	// shareWorkspaces are the workspaces of this organization the actor is
	// a member of - the workspace-principal share legs that reach them.
	shareWorkspaces []string
}

// documentListScope resolves the gates a list needs: the organization gate
// (humans) or the workspace agent gate (agents), the workspace role, and the
// actor's workspaces inside this organization for share evaluation. A
// workspace non-member still lists through the share legs - a document
// shared with them is theirs to read without joining the workspace
// (resolveLevel does the same).
func (s *DocumentService) documentListScope(ctx context.Context, actor Actor, workspaceID string) (documentListScope, error) {
	return s.documentListScopeQ(ctx, s.q, actor, workspaceID)
}

// documentListScopeQ is documentListScope read through q, for a caller that
// holds a transaction: the gate reads on that connection (and its snapshot)
// instead of borrowing a second one from the pool. Same decision, same
// errors (see WorkspaceService.RequireMemberQ).
func (s *DocumentService) documentListScopeQ(ctx context.Context, q *db.Queries, actor Actor, workspaceID string) (documentListScope, error) {
	if !validActor(actor) || workspaceID == "" {
		return documentListScope{}, ErrNotFound
	}
	w, err := q.GetWorkspaceByID(ctx, workspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		return documentListScope{}, ErrNotFound
	}
	if err != nil {
		return documentListScope{}, err
	}
	return s.documentListScopeForWorkspace(ctx, q, actor, workspaceID, w)
}

// documentListScopeForWorkspace is documentListScopeQ for a caller that
// already read the workspace row through the same q (the change feed reads
// it inside its snapshot transaction to learn the organization id).
func (s *DocumentService) documentListScopeForWorkspace(ctx context.Context, q *db.Queries, actor Actor, workspaceID string, w db.Workspace) (documentListScope, error) {
	if !validActor(actor) || workspaceID == "" {
		return documentListScope{}, ErrNotFound
	}
	scope := documentListScope{organizationID: w.OrganizationID, actorID: actor.ID}
	switch actor.Kind {
	case audit.KindHuman:
		if _, err := s.orgs.RequireMemberQ(ctx, q, w.OrganizationID, actor.ID); err != nil {
			return documentListScope{}, err
		}
		scope.allowShares = true
		m, err := s.ws.RequireMemberQ(ctx, q, workspaceID, actor.ID)
		switch {
		case err == nil:
			if m.Role == "owner" || m.Role == "admin" {
				scope.seeAll = true
			} else {
				scope.memberVisible = true
				scope.aclOwner = true
			}
		case errors.Is(err, ErrForbidden):
			// Shares may still cover the caller (plan §3.1).
		default:
			return documentListScope{}, err
		}
		wss, err := q.ListWorkspacesForUser(ctx, actor.ID)
		if err != nil {
			return documentListScope{}, err
		}
		for _, x := range wss {
			if x.OrganizationID == w.OrganizationID {
				scope.shareWorkspaces = append(scope.shareWorkspaces, x.ID)
			}
		}
	case audit.KindAgent:
		// Agents never pass a share leg and never see restricted documents;
		// memberVisible keeps their predicate to the workspace-visible set
		// while aclOwner and allowShares stay false.
		if _, err := s.ws.RequireAgentMemberQ(ctx, q, workspaceID, actor.ID); err != nil {
			return documentListScope{}, err
		}
		scope.memberVisible = true
	default:
		return documentListScope{}, ErrForbidden
	}
	return scope, nil
}

func shareLevelsFor(min DocumentLevel) []string {
	switch min {
	case DocumentLevelManage:
		return []string{string(DocumentLevelManage)}
	case DocumentLevelEdit:
		return []string{string(DocumentLevelEdit), string(DocumentLevelManage)}
	default:
		return []string{string(DocumentLevelView), string(DocumentLevelEdit), string(DocumentLevelManage)}
	}
}

// escapeLikeQuery folds the user's term the same way search_text was built,
// then escapes the LIKE wildcards so %, _ and \ match literally.
func escapeLikeQuery(q string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return r.Replace(foldForSearch(q))
}

// ListDocuments pages the workspace document list. The permission filter is
// inside the query; a page boundary is the (ordering value, id) pair of the
// last row, so rows created or moved while the client pages change neither
// the next page's membership nor its order.
func (s *DocumentService) ListDocuments(ctx context.Context, actor Actor, workspaceID string, in ListDocumentsInput) (DocumentListPage, error) {
	page, err := s.listDocumentsPage(ctx, actor, workspaceID, in)
	if err != nil {
		return DocumentListPage{}, err
	}
	if err := s.attachListFacts(ctx, page.Items); err != nil {
		return DocumentListPage{}, err
	}
	return page, s.attachListEditLocks(ctx, actor, page.Items)
}

func (s *DocumentService) listDocumentsPage(ctx context.Context, actor Actor, workspaceID string, in ListDocumentsInput) (DocumentListPage, error) {
	scope, err := s.documentListScope(ctx, actor, workspaceID)
	if err != nil {
		return DocumentListPage{}, err
	}
	cursor, err := decodeDocumentCursor(in.Cursor)
	if err != nil {
		return DocumentListPage{}, err
	}
	limit := in.Limit
	if limit <= 0 {
		limit = defaultDocumentListPage
	}
	if limit > maxDocumentListPage {
		limit = maxDocumentListPage
	}
	var matchTitle bool
	switch in.Match {
	case "":
	case DocumentMatchTitle:
		matchTitle = true
	default:
		return DocumentListPage{}, Invalid("match phải là title")
	}
	query := pgtype.Text{}
	if q := escapeLikeQuery(in.Query); q != "" {
		query = pgtype.Text{String: q, Valid: true}
	}
	var kind, excludeKind pgtype.Text
	switch in.Kind {
	case "":
	case DocumentKindPage, DocumentKindFile, DocumentKindFolder:
		kind = pgtype.Text{String: in.Kind, Valid: true}
	case DocumentKindDocument:
		excludeKind = pgtype.Text{String: DocumentKindFolder, Valid: true}
	default:
		return DocumentListPage{}, Invalid("kind phải là page, file, folder hoặc document")
	}
	updatedBy := nullText(in.UpdatedBy)
	var from, to pgtype.Timestamptz
	if !in.UpdatedFrom.IsZero() {
		from = pgtype.Timestamptz{Time: in.UpdatedFrom, Valid: true}
	}
	if !in.UpdatedTo.IsZero() {
		to = pgtype.Timestamptz{Time: in.UpdatedTo, Valid: true}
	}
	cursorID := nullText(cursor.ID)
	agent := actor.Kind == audit.KindAgent

	out := DocumentListPage{Items: []DocumentListItem{}}
	switch {
	case in.Archived:
		// The trash answers to manage-level eyes only (decideDocumentAccess
		// does the same on a single row).
		var cursorAt pgtype.Timestamptz
		if cursor.At != nil {
			cursorAt = pgtype.Timestamptz{Time: *cursor.At, Valid: true}
		}
		rows, err := s.q.ListArchivedDocumentsPage(ctx, db.ListArchivedDocumentsPageParams{
			OrganizationID: scope.organizationID, WorkspaceID: workspaceID,
			SeeAll: scope.seeAll, AclOwner: scope.aclOwner, ActorID: nullText(scope.actorID),
			AllowShares: scope.allowShares, ShareWorkspaces: scope.shareWorkspaces,
			Kind: kind, ExcludeKind: excludeKind, UpdatedBy: updatedBy, UpdatedFrom: from, UpdatedTo: to,
			Query: query, MatchTitle: matchTitle,
			CursorAt: cursorAt, CursorID: cursorID, PageLimit: int32(limit + 1),
		})
		if err != nil {
			return DocumentListPage{}, err
		}
		for i, d := range rows {
			if i == limit {
				out.NextCursor = encodeDocumentCursor(documentCursor{At: &rows[limit-1].ArchivedAt.Time, ID: rows[limit-1].ID})
				break
			}
			out.Items = append(out.Items, DocumentListItem{Document: d})
		}

	case in.ParentID != nil && !query.Valid:
		// One level of the tree, position order. q present searches the
		// whole workspace instead (the flat branch below).
		var cursorPos pgtype.Float8
		if cursor.Pos != nil {
			cursorPos = pgtype.Float8{Float64: *cursor.Pos, Valid: true}
		}
		rows, err := s.q.ListDocumentsByParentPage(ctx, db.ListDocumentsByParentPageParams{
			OrganizationID: scope.organizationID, WorkspaceID: workspaceID, ParentID: nullText(*in.ParentID),
			SeeAll: scope.seeAll, MemberVisible: scope.memberVisible,
			AclOwner: scope.aclOwner, ActorID: nullText(scope.actorID), AllowShares: scope.allowShares,
			ShareLevels: shareLevelsFor(DocumentLevelView), ShareWorkspaces: scope.shareWorkspaces,
			Kind: kind, ExcludeKind: excludeKind, UpdatedBy: updatedBy, UpdatedFrom: from, UpdatedTo: to,
			Query: query, MatchTitle: matchTitle,
			CursorPosition: cursorPos, CursorID: cursorID, PageLimit: int32(limit + 1),
		})
		if err != nil {
			return DocumentListPage{}, err
		}
		for i, d := range rows {
			if i == limit {
				out.NextCursor = encodeDocumentCursor(documentCursor{Pos: &rows[limit-1].Position, ID: rows[limit-1].ID})
				break
			}
			out.Items = append(out.Items, DocumentListItem{Document: d})
		}

	default:
		var cursorAt pgtype.Timestamptz
		if cursor.At != nil {
			cursorAt = pgtype.Timestamptz{Time: *cursor.At, Valid: true}
		}
		rows, err := s.q.ListDocumentsPage(ctx, db.ListDocumentsPageParams{
			OrganizationID: scope.organizationID, WorkspaceID: workspaceID,
			SeeAll: scope.seeAll, MemberVisible: scope.memberVisible,
			AclOwner: scope.aclOwner, ActorID: nullText(scope.actorID), AllowShares: scope.allowShares,
			ShareLevels: shareLevelsFor(DocumentLevelView), ShareWorkspaces: scope.shareWorkspaces,
			Kind: kind, ExcludeKind: excludeKind, UpdatedBy: updatedBy, UpdatedFrom: from, UpdatedTo: to,
			Query: query, MatchTitle: matchTitle,
			CursorAt: cursorAt, CursorID: cursorID, PageLimit: int32(limit + 1),
		})
		if err != nil {
			return DocumentListPage{}, err
		}
		for i, r := range rows {
			if i == limit {
				out.NextCursor = encodeDocumentCursor(documentCursor{At: &rows[limit-1].UpdatedAt.Time, ID: rows[limit-1].ID})
				break
			}
			out.Items = append(out.Items, DocumentListItem{Document: listRowDocument(r), Snippet: r.Snippet})
		}
	}
	if err := s.attachListAccess(ctx, scope, workspaceID, agent, out.Items); err != nil {
		return DocumentListPage{}, err
	}
	if !query.Valid {
		return out, nil
	}
	return out, s.attachListPaths(ctx, scope, workspaceID, agent, out.Items)
}

// attachListPaths resolves Path (root -> direct parent) for one page of list
// items in a fixed number of queries (E6/FD-05, UNI-1465): one recursive CTE
// loads every ancestor of the page inside the same tenant + workspace, and one
// share query evaluates access for any restricted/archived ancestors when
// seeAll is false. Each item's walk up parent_id stops at the first missing or
// unreadable ancestor, matching documentBreadcrumbs.
func (s *DocumentService) attachListPaths(ctx context.Context, scope documentListScope, workspaceID string, agent bool, items []DocumentListItem) error {
	return s.attachListPathsQ(ctx, s.q, scope, workspaceID, agent, items)
}

// attachListPathsQ is attachListPaths read through q, for a caller that holds
// a snapshot transaction (the access report export).
func (s *DocumentService) attachListPathsQ(ctx context.Context, q *db.Queries, scope documentListScope, workspaceID string, agent bool, items []DocumentListItem) error {
	if len(items) == 0 {
		return nil
	}
	seenParents := make(map[string]struct{}, len(items))
	parentIDs := make([]string, 0, len(items))
	for _, it := range items {
		if !it.Document.ParentID.Valid || it.Document.ParentID.String == "" {
			continue
		}
		pid := it.Document.ParentID.String
		if _, ok := seenParents[pid]; !ok {
			seenParents[pid] = struct{}{}
			parentIDs = append(parentIDs, pid)
		}
	}
	if len(parentIDs) == 0 {
		return nil
	}
	ancRows, err := q.ListDocumentAncestors(ctx, db.ListDocumentAncestorsParams{
		OrganizationID: scope.organizationID,
		WorkspaceID:    workspaceID,
		Ids:            parentIDs,
		MaxLevel:       int32(2 * maxDocumentDepth),
	})
	if err != nil {
		return err
	}
	if len(ancRows) == 0 {
		return nil
	}
	ancByID := make(map[string]db.ListDocumentAncestorsRow, len(ancRows))
	var shareCheckIDs []string
	for _, r := range ancRows {
		ancByID[r.ID] = r
		if scope.allowShares && !scope.seeAll && !r.OwnerKind.Valid {
			if r.Visibility == documentVisibilityRestricted || r.ArchivedAt.Valid || !scope.memberVisible {
				shareCheckIDs = append(shareCheckIDs, r.ID)
			}
		}
	}
	var shares map[string][]db.ListLiveSharesForDocumentsRow
	if len(shareCheckIDs) > 0 {
		shRows, err := q.ListLiveSharesForDocuments(ctx, db.ListLiveSharesForDocumentsParams{
			OrganizationID: scope.organizationID,
			WorkspaceID:    workspaceID,
			DocumentIds:    shareCheckIDs,
		})
		if err != nil {
			return err
		}
		shares = make(map[string][]db.ListLiveSharesForDocumentsRow, len(shRows))
		for _, sh := range shRows {
			shares[sh.DocumentID] = append(shares[sh.DocumentID], sh)
		}
	}
	for i := range items {
		if !items[i].Document.ParentID.Valid {
			continue
		}
		var up []DocumentPathItem
		seen := map[string]struct{}{items[i].Document.ID: {}}
		curID := items[i].Document.ParentID.String
		for curID != "" && len(up) < 2*maxDocumentDepth {
			if _, loop := seen[curID]; loop {
				break
			}
			seen[curID] = struct{}{}
			anc, ok := ancByID[curID]
			if !ok || anc.OwnerKind.Valid {
				break
			}
			doc := db.Document{
				ID:             anc.ID,
				OrganizationID: scope.organizationID,
				WorkspaceID:    workspaceID,
				Visibility:     anc.Visibility,
				AclOwnerID:     anc.AclOwnerID,
				ArchivedAt:     anc.ArchivedAt,
			}
			acc := listRowAccess(scope, agent, doc, shares[anc.ID])
			if decideDocumentAccess(doc, acc, DocumentLevelView) != nil {
				break
			}
			up = append(up, DocumentPathItem{ID: anc.ID, Title: anc.Title})
			if !anc.ParentID.Valid {
				break
			}
			curID = anc.ParentID.String
		}
		if len(up) > 0 {
			path := make([]DocumentPathItem, len(up))
			for j, p := range up {
				path[len(up)-1-j] = p
			}
			items[i].Path = path
		}
	}
	return nil
}

// ListRecentDocuments is GET /workspaces/{ws}/documents/recent: documents the
// actor opened (access log) or last edited, permission-filtered. Only a
// person has a "recent"; agents get the plain list.
func (s *DocumentService) ListRecentDocuments(ctx context.Context, actor Actor, workspaceID string, in ListDocumentsInput) (DocumentListPage, error) {
	page, err := s.listRecentDocumentsPage(ctx, actor, workspaceID, in)
	if err != nil {
		return DocumentListPage{}, err
	}
	if err := s.attachListFacts(ctx, page.Items); err != nil {
		return DocumentListPage{}, err
	}
	return page, s.attachListEditLocks(ctx, actor, page.Items)
}

func (s *DocumentService) listRecentDocumentsPage(ctx context.Context, actor Actor, workspaceID string, in ListDocumentsInput) (DocumentListPage, error) {
	if actor.Kind != audit.KindHuman {
		return DocumentListPage{}, ErrForbidden
	}
	scope, err := s.documentListScope(ctx, actor, workspaceID)
	if err != nil {
		return DocumentListPage{}, err
	}
	cursor, err := decodeDocumentCursor(in.Cursor)
	if err != nil {
		return DocumentListPage{}, err
	}
	switch in.Match {
	case "", DocumentMatchTitle:
	default:
		return DocumentListPage{}, Invalid("match phải là title")
	}
	limit := in.Limit
	if limit <= 0 {
		limit = defaultDocumentListPage
	}
	if limit > maxDocumentListPage {
		limit = maxDocumentListPage
	}
	var cursorAt pgtype.Timestamptz
	if cursor.At != nil {
		cursorAt = pgtype.Timestamptz{Time: *cursor.At, Valid: true}
	}
	rows, err := s.q.ListRecentDocumentsPage(ctx, db.ListRecentDocumentsPageParams{
		OrganizationID: scope.organizationID, WorkspaceID: workspaceID, ActorID: actor.ID,
		SeeAll: scope.seeAll, MemberVisible: scope.memberVisible, AclOwner: scope.aclOwner,
		AllowShares: scope.allowShares, ShareWorkspaces: scope.shareWorkspaces,
		CursorAt: cursorAt, CursorID: nullText(cursor.ID), PageLimit: int32(limit + 1),
	})
	if err != nil {
		return DocumentListPage{}, err
	}
	out := DocumentListPage{Items: []DocumentListItem{}}
	for i, d := range rows {
		if i == limit {
			out.NextCursor = encodeDocumentCursor(documentCursor{At: &rows[limit-1].UpdatedAt.Time, ID: rows[limit-1].ID})
			break
		}
		out.Items = append(out.Items, DocumentListItem{Document: d})
	}
	return out, s.attachListAccess(ctx, scope, workspaceID, false, out.Items)
}

// listRowDocument converts the flat-page row (which carries the snippet)
// back into the document shape.
func listRowDocument(r db.ListDocumentsPageRow) db.Document {
	return db.Document{
		ID: r.ID, OrganizationID: r.OrganizationID, WorkspaceID: r.WorkspaceID, ParentID: r.ParentID,
		Kind: r.Kind, Title: r.Title, Icon: r.Icon, Visibility: r.Visibility, Content: r.Content,
		ContentText: r.ContentText, SearchText: r.SearchText, ContentBytes: r.ContentBytes,
		CurrentVersion: r.CurrentVersion, FileVersionID: r.FileVersionID, Revision: r.Revision,
		Position: r.Position, OwnerKind: r.OwnerKind, OwnerID: r.OwnerID, AclOwnerID: r.AclOwnerID,
		SourceDocumentID: r.SourceDocumentID, SourceVersionID: r.SourceVersionID, SourceRevision: r.SourceRevision,
		SourceFormat: r.SourceFormat, SourceEngine: r.SourceEngine, TargetFormat: r.TargetFormat,
		SourceChecksumSha256: r.SourceChecksumSha256, ConversionReason: r.ConversionReason,
		CreatedBy: r.CreatedBy, CreatedByKind: r.CreatedByKind, UpdatedBy: r.UpdatedBy,
		UpdatedByKind: r.UpdatedByKind, ContentSavedAt: r.ContentSavedAt, LastVersionAt: r.LastVersionAt,
		ArchivedAt: r.ArchivedAt, ArchivedBy: r.ArchivedBy, PurgeAfter: r.PurgeAfter,
		ArchiveBatchID: r.ArchiveBatchID, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
	}
}
