package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/files"
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
//   - Shelved switches to the archive shelf (ARCHIVE-01): the shelved rows
//     the caller can view, keyset shelved_at DESC, id DESC, filters allowed.
//     Shelved with Archived is 400 invalid_filter.
type ListDocumentsInput struct {
	ParentID *string
	Query    string
	Kind     string
	Match    string
	Archived bool
	// ArchivedBy narrows the trash view to what any of these users archived;
	// empty is no filter, and it means nothing without Archived.
	ArchivedBy  []string
	Shelved     bool
	UpdatedBy   string
	UpdatedFrom time.Time
	UpdatedTo   time.Time
	SharedByMe  bool
	// Format and Access are the type and access filters of the library list
	// (UNI-1868): a file format of the six in internal/files, and one of
	// manage/edit/restricted. An unknown value, Format with kind=page and
	// manage/edit on the trash are 400 invalid_filter (resolveListFilters).
	Format string
	Access string
	// Types is the repeated ?type= filter (UNI-2113): "page" and/or file
	// formats, OR-ed with each other and AND-ed with Kind and Format - type
	// narrows like any other filter, so type=docx with format=pdf is empty and
	// with kind=page is empty too. Nil is no constraint; any value outside
	// page + the seven formats, the empty string included, is 400 invalid_type.
	// Like Format, folders stay in a file-format answer and a page-only answer
	// has none.
	Types  []string
	Cursor string
	Limit  int
	// Sort is the optional column sort (UNI-2038 S3); the zero value keeps the
	// list's own order and its own cursor. The trash and the shelf take it
	// with their own screen key (UNI-2045 SV-0).
	Sort DocumentSort
	// favorites narrows the flat list to the caller's own stars in the
	// workspace (ListFavoriteDocuments sets it; no handler input reaches it).
	favorites bool
	// templates narrows the flat list to files marked as templates
	// (ListTemplateDocuments sets it; no handler input reaches it).
	templates bool
	// withPaths resolves Path on every row, not only on a search: the shared
	// trash names each document's folders (TrashService sets it; no handler
	// input reaches it).
	withPaths bool
	// WithEditors resolves updated_by_user on every row (UNI-2045 SV-6); the
	// HTTP list routes set it, internal callers (MCP, Ask UNI) skip the lookup.
	WithEditors bool
	// Activity narrows /documents/recent to what the caller opened or edited
	// (UNI-2045 SV-1b): "" (all), "opened" or "edited". Other lists ignore it.
	Activity string
	// IncludeOwned also lists, on /documents/recent, the documents the caller
	// owns (acl_owner) at their updated_at, so one stays listed after somebody
	// else edits it (UNI-2012 F5). Other lists ignore it.
	IncludeOwned bool
}

// The activity filter of /documents/recent and the kinds last_activity reports.
const (
	DocumentActivityOpened    = "opened"
	DocumentActivityEdited    = "edited"
	DocumentActivityCommented = "commented"
	// DocumentActivityOwned is a kind last_activity reports only, never a
	// filter: with IncludeOwned, a row the caller owns whose latest change is
	// somebody else's, dated at its updated_at (the SQL names the literal).
	DocumentActivityOwned = "owned"
)

// DocumentLastActivity is the caller's latest activity on a recent row: the
// kind (opened, edited, commented, owned) and when it happened.
type DocumentLastActivity struct {
	Kind string
	At   time.Time
}

// listScreenSortKey is the screen key the flat list route takes under this
// input: the trash and the shelf each have their own timestamp, shared_by_me
// has the grant time; every other shape takes the four column keys only.
func listScreenSortKey(in ListDocumentsInput) string {
	switch {
	case in.favorites:
		return DocumentSortStarred
	case in.Archived:
		return DocumentSortDeleted
	case in.Shelved:
		return DocumentSortShelved
	case in.SharedByMe:
		return DocumentSortShared
	}
	return ""
}

// The access filter of a document list (UNI-1868). manage and edit compare
// the level the caller holds on the row; restricted is the row's visibility,
// exactly as the library's own access filter reads it.
const (
	DocumentAccessManage     = "manage"
	DocumentAccessEdit       = "edit"
	DocumentAccessRestricted = "restricted"
)

// documentListFilters is the format/access pair of one list request, resolved
// into what the list queries take: the format and the MIME its verified
// uploads carry, every MIME the format table names (so the SQL can tell a MIME
// it cannot name from one it can), the access filter and the levels that
// satisfy it. A zero Format/Access means the filter is not set.
type documentListFilters struct {
	format       string
	access       string
	formatMime   string
	accessLevels []string
	// typePage, typeFormats and typeMimes are the repeated ?type= filter
	// (UNI-2113): the page leg, the file formats, and the MIME each verified
	// upload of those formats carries. The legs are OR-ed in SQL and the whole
	// is AND-ed with format/kind. typeFormats and typeMimes are never nil: pgx
	// writes a nil slice as NULL, which the SQL's cardinality() cannot read.
	typePage    bool
	typeFormats []string
	typeMimes   []string
}

// DocumentTypePage is the ?type= value for pages; every other accepted value is
// a file format of internal/files.
const DocumentTypePage = "page"

// resolveListTypes parses the repeated ?type= values strictly (UNI-2113): each
// is "page" or one of the seven file formats, exactly as written. An unknown,
// empty or differently-cased value is 400 invalid_type; a repeat counts once.
func resolveListTypes(types []string) (page bool, formats, mimes []string, err error) {
	formats, mimes = []string{}, []string{}
	for _, typ := range types {
		if typ == DocumentTypePage {
			page = true
			continue
		}
		mime, ok := files.DocumentFormatMime(typ)
		if !ok {
			return false, nil, nil, coded(http.StatusBadRequest, "invalid_type", "type phải là page, docx, xlsx, pptx, pdf, md, html hoặc txt")
		}
		if slices.Contains(formats, typ) {
			continue
		}
		formats = append(formats, typ)
		mimes = append(mimes, mime)
	}
	return page, formats, mimes, nil
}

// resolveListFilters parses ?format=, ?access= and ?type= strictly (UNI-1868,
// UNI-2113). An unknown value, format together with kind=page, and manage/edit
// on the trash view are 400 invalid_filter (a bad type is 400 invalid_type);
// the trash is manage-only, so its one access filter is restricted. type
// narrows beside kind and format - the three are AND-ed - and adds no refusal
// of its own: type=docx with kind=page is simply an empty answer.
func resolveListFilters(format, access, kind string, archived bool, types []string) (documentListFilters, error) {
	var out documentListFilters
	var err error
	if out.typePage, out.typeFormats, out.typeMimes, err = resolveListTypes(types); err != nil {
		return documentListFilters{}, err
	}
	if format != "" {
		if kind == DocumentKindPage {
			return out, coded(http.StatusBadRequest, "invalid_filter", "format không dùng được cùng kind=page")
		}
		if mime, ok := files.DocumentFormatMime(format); !ok {
			return out, coded(http.StatusBadRequest, "invalid_filter", "format phải là docx, xlsx, pptx, pdf, md, html hoặc txt")
		} else {
			out.format = format
			out.formatMime = mime
		}
	}
	switch access {
	case "":
	case DocumentAccessRestricted:
		out.access = access
	case DocumentAccessManage, DocumentAccessEdit:
		if archived {
			return out, coded(http.StatusBadRequest, "invalid_filter", "access=manage/edit không dùng được trên thùng rác")
		}
		out.access = access
		out.accessLevels = accessFilterLevels(access)
	default:
		return out, coded(http.StatusBadRequest, "invalid_filter", "access phải là manage, edit hoặc restricted")
	}
	return out, nil
}

// accessFilterLevels is the levels that satisfy one access filter, the way the
// library's filter reads my_level: manage needs manage, edit takes edit or
// manage. A share and a home row are compared against the same list (a home
// row never carries manage, so manage's list only ever matches a share or a
// role), which is why the SQL takes one array for both legs.
func accessFilterLevels(access string) []string {
	if access == DocumentAccessManage {
		return []string{string(DocumentLevelManage)}
	}
	return []string{string(DocumentLevelEdit), string(DocumentLevelManage)}
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
	// ShareScope summarizes who reaches this row's document (SH-S3, UNI-1782;
	// addendum §6.4, §7); nil for agent actors (C-01 §4).
	ShareScope *DocumentShareScope
	// Access is the actor's level on the row (document_list_access.go); the
	// zero value means the service did not compute it.
	Access DocumentAccess
	Path   []DocumentPathItem
	// LastActivity is the caller's last activity on the row (recent only).
	LastActivity *DocumentLastActivity
	// FavoritedAt is when the caller starred the row (favorites only).
	FavoritedAt *time.Time
	// ShareSummary counts the row's live grants (shared_by_me only).
	ShareSummary *DocumentShareSummary
	// IsOwner is whether the caller is the document's ACL owner (UNI-2045 SV-5).
	IsOwner bool
	// IsEmpty is set on folder rows of the list screens only: whether the
	// caller can read nothing directly inside it (ADR 0037, per viewer).
	IsEmpty *bool
	// UpdatedByUser is the last editor when a person of the caller's
	// organization; nil for an agent, the system or a stranger (SV-6).
	UpdatedByUser *DocumentPerson
}

// DocumentShareSummary is how widely a document is shared by its owner: the
// live direct user shares, the live workspace shares, the links neither
// revoked nor expired, and the newest of those grants (nil when none).
type DocumentShareSummary struct {
	People, Workspaces, Links int
	LatestAt                  *time.Time
}

// DocumentListPage is one page plus the cursor for the next.
type DocumentListPage struct {
	Items      []DocumentListItem
	NextCursor string
}

// documentCursor pins the ordering value of the last row returned. At pairs
// with the (updated_at|archived_at|shelved_at, id) descending lists, Pos
// with the position-ordered children list; exactly one is set. A page of a
// column sort (UNI-2038 S3) also carries the sort it was minted for and the
// key of its last row (DocumentSortCursor); its At is then the updated key.
type documentCursor struct {
	At  *time.Time `json:"t,omitempty"`
	Pos *float64   `json:"p,omitempty"`
	ID  string     `json:"id"`
	DocumentSortCursor
}

func encodeDocumentCursor(c documentCursor) string {
	raw, _ := json.Marshal(c)
	return base64.RawURLEncoding.EncodeToString(raw)
}

// sortedDocumentCursor is the cursor of a sorted page's last row, from the key
// values the list query returned for it.
func sortedDocumentCursor(sort DocumentSort, id string, keyAt pgtype.Timestamptz, size int64, name, editor string, editorNull bool) documentCursor {
	c := documentCursor{ID: id, DocumentSortCursor: NewDocumentSortCursor(sort, size, name, editor, editorNull)}
	if keyAt.Valid {
		at := keyAt.Time
		c.At = &at
	}
	return c
}

// legacy is the cursor a list's own (unsorted) keyset reads: a sorted cursor
// carries a key in At, which must never reach the unsorted predicates.
func (c documentCursor) legacy() documentCursor {
	if c.Sorted() {
		return documentCursor{}
	}
	return c
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
	if err := json.Unmarshal(raw, &c); err != nil || c.ID == "" || strings.ContainsRune(c.ID, 0) {
		return documentCursor{}, Invalid("cursor không hợp lệ")
	}
	if c.Sorted() {
		if c.Pos != nil || !c.ValidShape(c.At != nil) {
			return documentCursor{}, Invalid("cursor không hợp lệ")
		}
		return c, nil
	}
	if (c.At == nil && c.Pos == nil) || (c.At != nil && c.Pos != nil) {
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
	case DocumentLevelComment:
		return []string{string(DocumentLevelComment), string(DocumentLevelEdit), string(DocumentLevelManage)}
	default:
		return []string{string(DocumentLevelView), string(DocumentLevelComment), string(DocumentLevelEdit), string(DocumentLevelManage)}
	}
}

// escapeLikeQuery folds the user's term the same way search_text was built,
// then escapes the LIKE wildcards so %, _ and \ match literally.
func escapeLikeQuery(q string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return r.Replace(foldForSearch(q))
}

// ListFavoriteDocuments is GET /workspaces/{ws}/documents/favorites (UNI-2045
// SV-2): the caller's own stars in the workspace, as the same list rows, newest
// star first (sort=starred, descending by default) or by an S3 key. It runs the
// flat list's query and permission predicate with the star joined in, so a row
// the caller can no longer read (a revoked share, a trashed document) is simply
// not there, and the page limit counts only rows they can see. Only kind and
// format narrow it; only a person has stars.
func (s *DocumentService) ListFavoriteDocuments(ctx context.Context, actor Actor, workspaceID string, in ListDocumentsInput) (DocumentListPage, error) {
	if actor.Kind != audit.KindHuman {
		return DocumentListPage{}, ErrForbidden
	}
	if !in.Sort.Active() {
		in.Sort = DocumentSort{Key: DocumentSortStarred, Desc: true}
	}
	return s.ListDocuments(ctx, actor, workspaceID, ListDocumentsInput{
		Kind: in.Kind, Format: in.Format, Types: in.Types, Cursor: in.Cursor, Limit: in.Limit, Sort: in.Sort, favorites: true,
		WithEditors: in.WithEditors,
	})
}

// ListTemplateDocuments is the workspace's Templates section (UNI-2225): the
// files marked as templates the caller can read, newest update first, through
// the flat list's query and permission predicate (a template the caller cannot
// read, or one in the trash, is simply not there). Kind, format, type and the
// cursor narrow it; only a person reads the library.
func (s *DocumentService) ListTemplateDocuments(ctx context.Context, actor Actor, workspaceID string, in ListDocumentsInput) (DocumentListPage, error) {
	if actor.Kind != audit.KindHuman {
		return DocumentListPage{}, ErrForbidden
	}
	return s.ListDocuments(ctx, actor, workspaceID, ListDocumentsInput{
		Kind: in.Kind, Format: in.Format, Types: in.Types, Cursor: in.Cursor, Limit: in.Limit, Sort: in.Sort, templates: true,
		WithEditors: in.WithEditors,
	})
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
	if err := s.attachFolderEmptiness(ctx, actor, workspaceID, page.Items); err != nil {
		return DocumentListPage{}, err
	}
	if err := s.attachListFacts(ctx, page.Items); err != nil {
		return DocumentListPage{}, err
	}
	if err := s.attachListEditLocks(ctx, actor, page.Items); err != nil {
		return DocumentListPage{}, err
	}
	markListOwners(actor, page.Items)
	if in.WithEditors {
		if err := s.attachListEditors(ctx, page.Items); err != nil {
			return DocumentListPage{}, err
		}
	}
	return page, s.attachListShareScopes(ctx, actor, page.Items)
}

func (s *DocumentService) listDocumentsPage(ctx context.Context, actor Actor, workspaceID string, in ListDocumentsInput) (DocumentListPage, error) {
	scope, err := s.documentListScope(ctx, actor, workspaceID)
	if err != nil {
		return DocumentListPage{}, err
	}
	if in.SharedByMe && in.ParentID != nil {
		return DocumentListPage{}, coded(http.StatusBadRequest, "invalid_filter", "shared_by_me không thể dùng cùng parent_id")
	}
	if in.Shelved && in.Archived {
		// ARCHIVE-01 (Q-AR3 = a): the shelf and the trash are two views; a
		// trashed-and-shelved row lives in the trash only.
		return DocumentListPage{}, coded(http.StatusBadRequest, "invalid_filter", "shelved không thể dùng cùng archived")
	}
	if err := in.Sort.CheckRoute(listScreenSortKey(in)); err != nil {
		return DocumentListPage{}, err
	}
	cursor, err := decodeDocumentCursor(in.Cursor)
	if err != nil {
		return DocumentListPage{}, err
	}
	if in.Cursor != "" {
		if err := cursor.CheckAgainst(in.Sort); err != nil {
			return DocumentListPage{}, err
		}
	}
	sortArg := sortArgs(in.Sort, cursor.DocumentSortCursor, cursor.At, cursor.ID)
	cursor = cursor.legacy()
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
	if in.SharedByMe {
		// A folder is never shared (UNI-1974): Shared by me lists documents
		// only, whatever a legacy row says. The query already binds
		// exclude_kind, so the shared_by_me SQL stays as it is.
		if in.Kind == DocumentKindFolder {
			return DocumentListPage{}, coded(http.StatusBadRequest, "invalid_filter", "shared_by_me không áp dụng cho thư mục")
		}
		excludeKind = pgtype.Text{String: DocumentKindFolder, Valid: true}
	}
	filters, err := resolveListFilters(in.Format, in.Access, in.Kind, in.Archived, in.Types)
	if err != nil {
		return DocumentListPage{}, err
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
	templatesOnly := pgtype.Bool{Bool: in.templates, Valid: in.templates}
	var favoritesUser pgtype.Text
	if in.favorites {
		favoritesUser = nullText(actor.ID)
	}

	out := DocumentListPage{Items: []DocumentListItem{}}
	switch {
	case in.Archived && in.SharedByMe:
		return out, nil

	case in.Archived:
		// The trash answers to manage and edit holders (RESTORE-01 §3):
		// attachListAccess below populates the caller's real level on each row.
		var cursorAt pgtype.Timestamptz
		if cursor.At != nil {
			cursorAt = pgtype.Timestamptz{Time: *cursor.At, Valid: true}
		}
		rows, err := s.q.ListArchivedDocumentsPage(ctx, db.ListArchivedDocumentsPageParams{
			OrganizationID: scope.organizationID, WorkspaceID: workspaceID,
			MaxLevel: subtreeMaxLevel(),
			SeeAll:   scope.seeAll, MemberVisible: scope.memberVisible, Agent: agent,
			AclOwner: scope.aclOwner, ActorID: nullText(scope.actorID),
			AllowShares: scope.allowShares, ShareLevels: shareLevelsFor(DocumentLevelEdit),
			ShareWorkspaces: scope.shareWorkspaces,
			Kind:            kind, ExcludeKind: excludeKind, UpdatedBy: updatedBy, ArchivedBy: in.ArchivedBy, UpdatedFrom: from, UpdatedTo: to,
			Format: nullText(filters.format), FormatMime: nullText(filters.formatMime),
			FormatMimes: files.DocumentFormatMimes(),
			TypePage:    filters.typePage, TypeFormats: filters.typeFormats, TypeMimes: filters.typeMimes, Access: nullText(filters.access),
			Query: query, MatchTitle: matchTitle,
			CursorAt: cursorAt, CursorID: cursorID, PageLimit: int32(limit + 1),
			SortKey: sortArg.key, SortDesc: sortArg.desc, SortCursorID: sortArg.id, SortCursorAt: sortArg.at,
			SortCursorNum: sortArg.num, SortCursorText: sortArg.text, SortCursorNull: sortArg.null,
		})
		if err != nil {
			return DocumentListPage{}, err
		}
		for i, r := range rows {
			if i == limit {
				last := rows[limit-1]
				if in.Sort.Active() {
					out.NextCursor = encodeDocumentCursor(sortedDocumentCursor(in.Sort, last.Document.ID, last.SortAt, last.SortSize, last.SortName, last.SortEditor, last.SortEditorNull))
				} else {
					out.NextCursor = encodeDocumentCursor(documentCursor{At: &last.Document.ArchivedAt.Time, ID: last.Document.ID})
				}
				break
			}
			out.Items = append(out.Items, DocumentListItem{Document: r.Document})
		}

	case in.Shelved:
		// ARCHIVE-01 §4: the archive shelf. Every caller sees the shelved
		// rows they can view - the flat list's own permission ladder, not the
		// trash's manage/edit gate - ordered shelved_at DESC, id DESC. A
		// parent_id or search term still applies; the filters resolve with
		// archived=false so access=manage/edit stays legal here.
		var cursorAt pgtype.Timestamptz
		if cursor.At != nil {
			cursorAt = pgtype.Timestamptz{Time: *cursor.At, Valid: true}
		}
		rows, err := s.q.ListShelvedDocumentsPage(ctx, db.ListShelvedDocumentsPageParams{
			OrganizationID: scope.organizationID, WorkspaceID: workspaceID,
			SeeAll: scope.seeAll, MemberVisible: scope.memberVisible, Agent: agent,
			AclOwner: scope.aclOwner, ActorID: nullText(scope.actorID),
			AllowShares: scope.allowShares, ShareWorkspaces: scope.shareWorkspaces,
			ShareLevels: shareLevelsFor(DocumentLevelView),
			Kind:        kind, ExcludeKind: excludeKind, UpdatedBy: updatedBy, UpdatedFrom: from, UpdatedTo: to,
			Format: nullText(filters.format), FormatMime: nullText(filters.formatMime),
			FormatMimes: files.DocumentFormatMimes(),
			TypePage:    filters.typePage, TypeFormats: filters.typeFormats, TypeMimes: filters.typeMimes,
			Access: nullText(filters.access), AccessLevels: filters.accessLevels,
			SharedByMe: in.SharedByMe,
			Query:      query, MatchTitle: matchTitle,
			CursorAt: cursorAt, CursorID: cursorID, PageLimit: int32(limit + 1),
			SortKey: sortArg.key, SortDesc: sortArg.desc, SortCursorID: sortArg.id, SortCursorAt: sortArg.at,
			SortCursorNum: sortArg.num, SortCursorText: sortArg.text, SortCursorNull: sortArg.null,
		})
		if err != nil {
			return DocumentListPage{}, err
		}
		for i, r := range rows {
			if i == limit {
				last := rows[limit-1]
				if in.Sort.Active() {
					out.NextCursor = encodeDocumentCursor(sortedDocumentCursor(in.Sort, last.Document.ID, last.SortAt, last.SortSize, last.SortName, last.SortEditor, last.SortEditorNull))
				} else {
					out.NextCursor = encodeDocumentCursor(documentCursor{At: &last.Document.ShelvedAt.Time, ID: last.Document.ID})
				}
				break
			}
			out.Items = append(out.Items, DocumentListItem{Document: r.Document})
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
			MaxLevel: subtreeMaxLevel(),
			SeeAll:   scope.seeAll, MemberVisible: scope.memberVisible,
			AclOwner: scope.aclOwner, ActorID: nullText(scope.actorID), AllowShares: scope.allowShares,
			ShareLevels: shareLevelsFor(DocumentLevelView), ShareWorkspaces: scope.shareWorkspaces,
			Kind: kind, ExcludeKind: excludeKind, UpdatedBy: updatedBy, UpdatedFrom: from, UpdatedTo: to,
			Format: nullText(filters.format), FormatMime: nullText(filters.formatMime),
			FormatMimes: files.DocumentFormatMimes(),
			TypePage:    filters.typePage, TypeFormats: filters.typeFormats, TypeMimes: filters.typeMimes,
			Access: nullText(filters.access), AccessLevels: filters.accessLevels, Agent: agent,
			Query: query, MatchTitle: matchTitle,
			CursorPosition: cursorPos, CursorID: cursorID, PageLimit: int32(limit + 1),
			SortKey: sortArg.key, SortDesc: sortArg.desc, SortCursorID: sortArg.id, SortCursorAt: sortArg.at,
			SortCursorNum: sortArg.num, SortCursorText: sortArg.text, SortCursorNull: sortArg.null,
		})
		if err != nil {
			return DocumentListPage{}, err
		}
		for i, r := range rows {
			if i == limit {
				last := rows[limit-1]
				if in.Sort.Active() {
					out.NextCursor = encodeDocumentCursor(sortedDocumentCursor(in.Sort, last.Document.ID, last.Document.UpdatedAt, last.SortSize, last.SortName, last.SortEditor, last.SortEditorNull))
				} else {
					out.NextCursor = encodeDocumentCursor(documentCursor{Pos: &last.Document.Position, ID: last.Document.ID})
				}
				break
			}
			out.Items = append(out.Items, DocumentListItem{Document: r.Document})
		}

	default:
		var cursorAt pgtype.Timestamptz
		if cursor.At != nil {
			cursorAt = pgtype.Timestamptz{Time: *cursor.At, Valid: true}
		}
		rows, err := s.q.ListDocumentsPage(ctx, db.ListDocumentsPageParams{
			OrganizationID: scope.organizationID, WorkspaceID: workspaceID,
			MaxLevel: subtreeMaxLevel(),
			SeeAll:   scope.seeAll, MemberVisible: scope.memberVisible,
			AclOwner: scope.aclOwner, ActorID: nullText(scope.actorID), AllowShares: scope.allowShares,
			ShareLevels: shareLevelsFor(DocumentLevelView), ShareWorkspaces: scope.shareWorkspaces,
			Kind: kind, ExcludeKind: excludeKind, UpdatedBy: updatedBy, UpdatedFrom: from, UpdatedTo: to,
			Format: nullText(filters.format), FormatMime: nullText(filters.formatMime),
			FormatMimes: files.DocumentFormatMimes(),
			TypePage:    filters.typePage, TypeFormats: filters.typeFormats, TypeMimes: filters.typeMimes,
			Access: nullText(filters.access), AccessLevels: filters.accessLevels, Agent: agent,
			SharedByMe: in.SharedByMe,
			Query:      query, MatchTitle: matchTitle,
			CursorAt: cursorAt, CursorID: cursorID, PageLimit: int32(limit + 1),
			FavoritesUser: favoritesUser, TemplatesOnly: templatesOnly,
			SortKey: sortArg.key, SortDesc: sortArg.desc, SortCursorID: sortArg.id, SortCursorAt: sortArg.at,
			SortCursorNum: sortArg.num, SortCursorText: sortArg.text, SortCursorNull: sortArg.null,
		})
		if err != nil {
			return DocumentListPage{}, err
		}
		for i, r := range rows {
			if i == limit {
				last := rows[limit-1]
				if in.Sort.Active() {
					out.NextCursor = encodeDocumentCursor(sortedDocumentCursor(in.Sort, last.ID, last.SortAt, last.SortSize, last.SortName, last.SortEditor, last.SortEditorNull))
				} else {
					out.NextCursor = encodeDocumentCursor(documentCursor{At: &last.UpdatedAt.Time, ID: last.ID})
				}
				break
			}
			item := DocumentListItem{Document: listRowDocument(r), Snippet: r.Snippet}
			if r.FavoritedAt.Valid {
				at := r.FavoritedAt.Time.UTC()
				item.FavoritedAt = &at
			}
			out.Items = append(out.Items, item)
		}
	}
	if err := s.attachListAccess(ctx, scope, workspaceID, agent, out.Items); err != nil {
		return DocumentListPage{}, err
	}
	if in.SharedByMe {
		if err := s.attachShareSummaries(ctx, scope.organizationID, workspaceID, out.Items); err != nil {
			return DocumentListPage{}, err
		}
	}
	if query.Valid || in.withPaths {
		if err := s.attachListPaths(ctx, scope, workspaceID, agent, out.Items); err != nil {
			return DocumentListPage{}, err
		}
	}
	return out, s.maskListParents(ctx, scope, workspaceID, agent, out.Items)
}

// maskListParents drops the parent of every row whose parent folder the
// caller does not list (document_parent_visibility.go). It runs last: the
// search path above stops at the same unlisted folder on its own.
func (s *DocumentService) maskListParents(ctx context.Context, scope documentListScope, workspaceID string, agent bool, items []DocumentListItem) error {
	docs := make([]*db.Document, len(items))
	for i := range items {
		docs[i] = &items[i].Document
	}
	return s.maskUnlistedFolderParents(ctx, scope, workspaceID, agent, docs)
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
	var shareCheckIDs, adminIDs []string
	for _, r := range ancRows {
		ancByID[r.ID] = r
		if r.OwnerKind.Valid {
			continue
		}
		switch {
		case listAdminScopeRow(scope, db.Document{Visibility: r.Visibility, AclOwnerID: r.AclOwnerID}):
			// DOC-05: an admin reads a restricted ancestor's title only
			// through a share or a live break-glass grant.
			shareCheckIDs = append(shareCheckIDs, r.ID)
			adminIDs = append(adminIDs, r.ID)
		case scope.allowShares && !scope.seeAll:
			if r.Visibility == documentVisibilityRestricted || r.ArchivedAt.Valid || !scope.memberVisible {
				shareCheckIDs = append(shareCheckIDs, r.ID)
			}
		}
	}
	grants, err := s.liveBreakGlassFor(ctx, q, scope, workspaceID, adminIDs)
	if err != nil {
		return err
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
				WorkspaceLevel: anc.WorkspaceLevel,
				AclOwnerID:     anc.AclOwnerID,
				ArchivedAt:     anc.ArchivedAt,
			}
			acc := listRowAccess(scope, agent, doc, shares[anc.ID], grants[anc.ID])
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
	if err := s.attachListEditLocks(ctx, actor, page.Items); err != nil {
		return DocumentListPage{}, err
	}
	markListOwners(actor, page.Items)
	if in.WithEditors {
		if err := s.attachListEditors(ctx, page.Items); err != nil {
			return DocumentListPage{}, err
		}
	}
	return page, s.attachListShareScopes(ctx, actor, page.Items)
}

func (s *DocumentService) listRecentDocumentsPage(ctx context.Context, actor Actor, workspaceID string, in ListDocumentsInput) (DocumentListPage, error) {
	if actor.Kind != audit.KindHuman {
		return DocumentListPage{}, ErrForbidden
	}
	scope, err := s.documentListScope(ctx, actor, workspaceID)
	if err != nil {
		return DocumentListPage{}, err
	}
	if err := in.Sort.CheckRoute(DocumentSortActivity); err != nil {
		return DocumentListPage{}, err
	}
	cursor, err := decodeDocumentCursor(in.Cursor)
	if err != nil {
		return DocumentListPage{}, err
	}
	if in.Cursor != "" {
		if err := cursor.CheckAgainst(in.Sort); err != nil {
			return DocumentListPage{}, err
		}
	}
	sortArg := sortArgs(in.Sort, cursor.DocumentSortCursor, cursor.At, cursor.ID)
	cursor = cursor.legacy()
	switch in.Match {
	case "", DocumentMatchTitle:
	default:
		return DocumentListPage{}, Invalid("match phải là title")
	}
	filters, err := resolveListFilters(in.Format, in.Access, in.Kind, false, in.Types)
	if err != nil {
		return DocumentListPage{}, err
	}
	switch in.Activity {
	case "", DocumentActivityOpened, DocumentActivityEdited:
	default:
		return DocumentListPage{}, coded(http.StatusBadRequest, "invalid_filter", "activity phải là opened hoặc edited")
	}
	var from, to pgtype.Timestamptz
	if !in.UpdatedFrom.IsZero() {
		from = pgtype.Timestamptz{Time: in.UpdatedFrom, Valid: true}
	}
	if !in.UpdatedTo.IsZero() {
		to = pgtype.Timestamptz{Time: in.UpdatedTo, Valid: true}
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
		MaxLevel: subtreeMaxLevel(),
		SeeAll:   scope.seeAll, MemberVisible: scope.memberVisible, AclOwner: scope.aclOwner,
		AllowShares: scope.allowShares, ShareLevels: shareLevelsFor(DocumentLevelView),
		ShareWorkspaces: scope.shareWorkspaces,
		Format:          nullText(filters.format), FormatMime: nullText(filters.formatMime),
		FormatMimes: files.DocumentFormatMimes(),
		TypePage:    filters.typePage, TypeFormats: filters.typeFormats, TypeMimes: filters.typeMimes,
		// The recent list is human-only, so the home-row leg never needs the
		// agent cap.
		Access: nullText(filters.access), AccessLevels: filters.accessLevels, Agent: false,
		CursorAt: cursorAt, CursorID: nullText(cursor.ID), PageLimit: int32(limit + 1),
		IncludeOwned: in.IncludeOwned,
		Activity:     nullText(in.Activity), UpdatedBy: nullText(in.UpdatedBy), UpdatedFrom: from, UpdatedTo: to,
		SortKey: sortArg.key, SortDesc: sortArg.desc, SortCursorID: sortArg.id, SortCursorAt: sortArg.at,
		SortCursorNum: sortArg.num, SortCursorText: sortArg.text, SortCursorNull: sortArg.null,
	})
	if err != nil {
		return DocumentListPage{}, err
	}
	out := DocumentListPage{Items: []DocumentListItem{}}
	for i, r := range rows {
		if i == limit {
			last := rows[limit-1]
			if in.Sort.Active() {
				out.NextCursor = encodeDocumentCursor(sortedDocumentCursor(in.Sort, last.Document.ID, last.SortAt, last.SortSize, last.SortName, last.SortEditor, last.SortEditorNull))
			} else {
				out.NextCursor = encodeDocumentCursor(documentCursor{At: &last.Document.UpdatedAt.Time, ID: last.Document.ID})
			}
			break
		}
		item := DocumentListItem{Document: r.Document}
		if r.ActivityAt.Valid {
			item.LastActivity = &DocumentLastActivity{Kind: r.ActivityKind, At: r.ActivityAt.Time.UTC()}
		}
		out.Items = append(out.Items, item)
	}
	if err := s.attachListAccess(ctx, scope, workspaceID, false, out.Items); err != nil {
		return DocumentListPage{}, err
	}
	return out, s.maskListParents(ctx, scope, workspaceID, false, out.Items)
}

// listRowDocument converts the flat-page row (which carries the snippet)
// back into the document shape.
func listRowDocument(r db.ListDocumentsPageRow) db.Document {
	return db.Document{
		ID: r.ID, OrganizationID: r.OrganizationID, WorkspaceID: r.WorkspaceID, ParentID: r.ParentID,
		Kind: r.Kind, SystemKind: r.SystemKind, Title: r.Title, Icon: r.Icon, Visibility: r.Visibility, WorkspaceLevel: r.WorkspaceLevel,
		Content:     r.Content,
		ContentText: r.ContentText, SearchText: r.SearchText, ContentBytes: r.ContentBytes,
		CurrentVersion: r.CurrentVersion, FileVersionID: r.FileVersionID, Revision: r.Revision,
		Position: r.Position, OwnerKind: r.OwnerKind, OwnerID: r.OwnerID, AclOwnerID: r.AclOwnerID,
		SourceDocumentID: r.SourceDocumentID, SourceVersionID: r.SourceVersionID, SourceRevision: r.SourceRevision,
		SourceFormat: r.SourceFormat, SourceEngine: r.SourceEngine, TargetFormat: r.TargetFormat,
		SourceChecksumSha256: r.SourceChecksumSha256, ConversionReason: r.ConversionReason,
		CreatedBy: r.CreatedBy, CreatedByKind: r.CreatedByKind, UpdatedBy: r.UpdatedBy,
		UpdatedByKind: r.UpdatedByKind, ContentSavedAt: r.ContentSavedAt, LastVersionAt: r.LastVersionAt,
		ArchivedAt: r.ArchivedAt, ArchivedBy: r.ArchivedBy, PurgeAfter: r.PurgeAfter,
		ArchiveBatchID: r.ArchiveBatchID,
		// ARCHIVE-01 (Q-AR3 = a): search rows the shelf holds must report the
		// state so the client can label them "Đã lưu trữ".
		ShelvedAt:     r.ShelvedAt,
		ShelvedBy:     r.ShelvedBy,
		ShelvedByKind: r.ShelvedByKind, ShelveBatchID: r.ShelveBatchID,
		CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
		TemplateMarkedAt: r.TemplateMarkedAt, TemplateMarkedBy: r.TemplateMarkedBy, TemplateMarkedByKind: r.TemplateMarkedByKind,
	}
}
