package service

import (
	"context"
	"errors"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Document access report (UNI-1643): who holds which level on every document
// the caller may administer (canAdminister: manage, or DOC-05's AdminScope on
// a restricted document) in a workspace or one folder (recursive). It reads
// the caller's and each person's level through the list mirror of the
// resolver (documentListScope + listRowAccess, break-glass grants included),
// never through a second access rule. It carries metadata only - titles,
// paths, principals, levels - never a document's content, so an AdminScope
// caller with no read level sees here what the share panel shows them.

// Row sources of the access report. Unknown values stay possible on the wire;
// clients render them as "other".
const (
	AccessReportSourceACLOwner   = "acl_owner"
	AccessReportSourceWorkspace  = "workspace"
	AccessReportSourceShare      = "share"
	AccessReportSourceBreakGlass = "break_glass"
	AccessReportSourceLink       = "link"
	AccessReportViaLink          = "link"
)

// Revoke kinds of a row (the DELETE route to call) and share origins.
const (
	AccessReportRevokeShare      = "share"
	AccessReportRevokeLink       = "link"
	AccessReportRevokeBreakGlass = "break_glass"
	AccessReportOriginDirect     = DocumentShareOriginDirect
	AccessReportOriginChat       = DocumentShareOriginChat
)

// Source keys of the S5 source filter and of the principals' main_source.
const (
	AccessReportSourceKeyOwner      = "owner"
	AccessReportSourceKeyWorkspace  = "workspace"
	AccessReportSourceKeyDirect     = "direct"
	AccessReportSourceKeyChat       = "chat"
	AccessReportSourceKeyLink       = "link"
	AccessReportSourceKeyBreakGlass = "break_glass"
)

// accessReportSourceKey is the S5 source of a row: the origin of a share, the
// kind of every other row.
func accessReportSourceKey(row DocumentAccessReportRow) string {
	switch row.Source {
	case AccessReportSourceACLOwner:
		return AccessReportSourceKeyOwner
	case AccessReportSourceWorkspace:
		return AccessReportSourceKeyWorkspace
	case AccessReportSourceShare:
		if row.Origin == AccessReportOriginChat {
			return AccessReportSourceKeyChat
		}
		return AccessReportSourceKeyDirect
	case AccessReportSourceLink:
		return AccessReportSourceKeyLink
	case AccessReportSourceBreakGlass:
		return AccessReportSourceKeyBreakGlass
	}
	return row.Source
}

// General scope kinds and document flags (UNI-2039 S1).
const (
	AccessReportScopeRestricted   = "restricted"
	AccessReportScopeWorkspace    = "workspace"
	AccessReportScopeOrganization = "organization"
	AccessReportFlagOutside       = "outside_workspace" // other_workspace or organization
	AccessReportFlagPublicLink    = "public_link"
	AccessReportFlagOtherWS       = "other_workspace"
	AccessReportFlagOrganization  = "organization"
	AccessReportFlagDirectManage  = "direct_manage"
)

// Sort keys and directions of the page (UNI-2039 S4). accessReportSortID is
// the export's historic order and is never accepted from a client.
const (
	AccessReportSortChanged = "changed"
	AccessReportSortTitle   = "title"
	accessReportSortID      = "id"
	AccessReportOrderAsc    = "asc"
	AccessReportOrderDesc   = "desc"
)

// accessReportScanFactor bounds how many candidates one page reads while it
// looks for limit listable documents (S4): 10 x limit, then a short page.
const accessReportScanFactor = 10

// AccessReportKey is the keyset position of one candidate: the sort value of
// its order plus the id that breaks ties.
type AccessReportKey struct {
	Changed time.Time
	Title   string
	ID      string
}

// DocumentAccessReportQuery is one request of the report. Levels, Sort and
// Order are validated values; After is the last candidate of the previous
// page (nil = first page). A client's cursor holds its ID only: the sort
// value is read from the anchor document by page (UNI-2039 fx1).
type DocumentAccessReportQuery struct {
	FolderID, PersonID, Visibility string
	Levels                         []string
	Limit                          int
	// Sort is changed (default) or title; Order is asc or desc (default desc
	// for changed, asc for title).
	Sort, Order string
	After       *AccessReportKey

	// UNI-2039 S5. Q is a case- and accent-insensitive match on the document
	// title or a principal name (<= 100 runes). PrincipalType/PrincipalID keep
	// only the rows of one principal (link without an id = anyone with the
	// link; a person is PersonID, whose rows reach them). Scope is the general
	// scope; Sources are source keys; Flag a document flag; NonDefault drops
	// the owner and default-workspace rows.
	Q                          string
	PrincipalType, PrincipalID string
	Scope, Flag                string
	Sources                    []string
	NonDefault                 bool
}

// DocumentAccessReportRow is one grant: a path that gives a principal a level
// on the document. EffectiveLevel is the person's level (user principals) or
// the level every member of the group gets from this document.
type DocumentAccessReportRow struct {
	Source, Via, PrincipalType, PrincipalID, Level, EffectiveLevel string
	PrincipalName                                                  string
	Active                                                         bool
	GrantedBy, GrantedByKind, GrantedByName, ShareID               string
	GrantedAt                                                      *time.Time
	// RevokeKind/RevokeID name the existing DELETE route that ends this row
	// (share, link, break_glass); empty when the caller cannot revoke it. A
	// hint for the button only: the revoke service's own gate decides.
	RevokeKind, RevokeID string
	// Origin is direct or chat on a share row; empty on every other row.
	Origin string
	// ExpiresAt is set on a link row.
	ExpiresAt *time.Time
}

// DocumentAccessReportItem is one listed document with its rows.
type DocumentAccessReportItem struct {
	Item          DocumentListItem // Document, Access (the caller's), Path
	ACLOwnerName  string
	LiveLinkCount int
	// PersonLevel is set only when the query names a person.
	PersonLevel DocumentLevel
	Rows        []DocumentAccessReportRow
	// UNI-2039 S1: facts of the whole document, computed from every row
	// before any row filter. GeneralScope is restricted, workspace or
	// organization; GeneralLevel is the level of the workspace or
	// organization row ("" when restricted).
	GeneralScope, GeneralLevel string
	Flags                      []string
	AccessChangedAt            time.Time
}

// DocumentAccessReportPage is one page of the report.
type DocumentAccessReportPage struct {
	FolderID, FolderTitle string
	GeneratedAt           time.Time
	Items                 []DocumentAccessReportItem
	Candidates, Skipped   int
	// Next is the last candidate consumed when the page stopped early (full,
	// or the scan bound was reached); nil = done.
	Next *AccessReportKey
}

// DocumentAccessReportExport is what an export wrote.
type DocumentAccessReportExport struct {
	Rows, Documents, Skipped int
	GeneratedAt              time.Time
	FolderTitle              string
	// Format is csv or xlsx; FileName is ASCII, ready for Content-Disposition.
	Format, FileName string
}

// effectiveAccessReportLimit clamps a requested page size (<= 0 or > 100 ->
// 50). The handler tells a full page from NextAfterID, not from the limit.
func effectiveAccessReportLimit(limit int) int {
	if limit <= 0 || limit > 100 {
		return 50
	}
	return limit
}

// accessReportLevels are the row levels a filter may name (G8-18's ladder).
var accessReportLevels = map[string]bool{"view": true, "comment": true, "edit": true, "manage": true}

func validateAccessReportQuery(in DocumentAccessReportQuery) error {
	switch in.Visibility {
	case "", "workspace", documentVisibilityRestricted:
	default:
		return Invalid("visibility không hợp lệ")
	}
	for _, l := range in.Levels {
		if !accessReportLevels[l] {
			return Invalid("level không hợp lệ")
		}
	}
	if utf8.RuneCountInString(in.Q) > 100 {
		return Invalid("q tối đa 100 ký tự")
	}
	switch in.PrincipalType {
	case "", DocumentPrincipalUser, DocumentPrincipalWorkspace, DocumentPrincipalOrganization:
		if in.PrincipalType != "" && in.PrincipalID == "" {
			return Invalid("principal cần id")
		}
	case AccessReportSourceLink:
	default:
		return Invalid("principal không hợp lệ")
	}
	switch in.Scope {
	case "", AccessReportScopeRestricted, AccessReportScopeWorkspace, AccessReportScopeOrganization:
	default:
		return Invalid("scope không hợp lệ")
	}
	switch in.Flag {
	case "", AccessReportFlagPublicLink, AccessReportFlagOutside, AccessReportFlagDirectManage:
	default:
		return Invalid("flag không hợp lệ")
	}
	for _, src := range in.Sources {
		switch src {
		case AccessReportSourceKeyOwner, AccessReportSourceKeyWorkspace, AccessReportSourceKeyDirect,
			AccessReportSourceKeyChat, AccessReportSourceKeyLink, AccessReportSourceKeyBreakGlass:
		default:
			return Invalid("source không hợp lệ")
		}
	}
	switch in.Sort {
	case "", AccessReportSortChanged, AccessReportSortTitle:
	default:
		return Invalid("sort không hợp lệ")
	}
	switch in.Order {
	case "", AccessReportOrderAsc, AccessReportOrderDesc:
	default:
		return Invalid("order không hợp lệ")
	}
	return nil
}

// PrincipalRef is the <type>:<id> form of the principal filter ("" when none;
// "link" for anyone with the link).
func (in DocumentAccessReportQuery) PrincipalRef() string {
	switch {
	case in.PrincipalType == "":
		return ""
	case in.PrincipalID == "":
		return in.PrincipalType
	}
	return in.PrincipalType + ":" + in.PrincipalID
}

// s5Pairs are the S5 filters that are set, as key/value pairs for the file's
// filter record.
func (in DocumentAccessReportQuery) s5Pairs() [][]string {
	var out [][]string
	add := func(k, v string) {
		if v != "" {
			out = append(out, []string{k, v})
		}
	}
	add("q", in.Q)
	add("principal", in.PrincipalRef())
	add("scope", in.Scope)
	add("source", strings.Join(in.Sources, ","))
	add("flag", in.Flag)
	if in.NonDefault {
		add("non_default", "1")
	}
	return out
}

// SortOrder is the page's resolved order: the sort key and whether it runs
// descending (changed defaults to newest first, title to A-Z).
func (in DocumentAccessReportQuery) SortOrder() (mode string, descending bool) {
	mode = in.Sort
	if mode == "" {
		mode = AccessReportSortChanged
	}
	switch in.Order {
	case AccessReportOrderAsc:
		return mode, false
	case AccessReportOrderDesc:
		return mode, true
	}
	return mode, mode == AccessReportSortChanged
}

// accessReportRun is one report request: the caller's gates, the folder and
// the person filter resolved once, plus the per-principal lookups memoized
// across every page the request reads (the export reads many).
type accessReportRun struct {
	s           *DocumentService
	q           *db.Queries
	workspaceID string
	in          DocumentAccessReportQuery
	scope       documentListScope
	folder      *db.Document
	levels      map[string]bool
	// visibility is the visibility the candidate read filters on in SQL.
	visibility string
	sources    map[string]bool
	qFold      string

	// person is the filtered person's list scope; nil with a person filter
	// means their gates refuse them, so nothing reaches them.
	person *documentListScope

	userScopes  map[string]*documentListScope
	groupActive map[string]bool
	groupNames  map[string]string
}

// openAccessReport runs the gates of one report request through q: the
// caller is a human effective member of the workspace (the same
// documentListScope every document list resolves), and a named folder is a
// live folder of this workspace the caller reads or administers (DOC-05: an
// AdminScope caller sees a restricted folder's metadata, so it may scope the
// report to it; the same gate the share panel opens on).
func (s *DocumentService) openAccessReport(ctx context.Context, q *db.Queries, actor Actor, workspaceID string, in DocumentAccessReportQuery) (*accessReportRun, error) {
	if err := validateAccessReportQuery(in); err != nil {
		return nil, err
	}
	if !validActor(actor) || workspaceID == "" {
		return nil, ErrNotFound
	}
	if actor.Kind != audit.KindHuman {
		return nil, ErrForbidden
	}
	scope, err := s.documentListScopeQ(ctx, q, actor, workspaceID)
	if err != nil {
		return nil, err
	}
	if !scope.seeAll && !scope.memberVisible {
		// A report is a workspace tool: shares alone do not open it.
		return nil, ErrForbidden
	}
	run := &accessReportRun{
		s: s, q: q, workspaceID: workspaceID, in: in, scope: scope,
		userScopes: map[string]*documentListScope{}, groupActive: map[string]bool{}, groupNames: map[string]string{},
		visibility: in.Visibility,
	}
	if len(in.Levels) > 0 {
		run.levels = make(map[string]bool, len(in.Levels))
		for _, l := range in.Levels {
			run.levels[l] = true
		}
	}
	if len(in.Sources) > 0 {
		run.sources = make(map[string]bool, len(in.Sources))
		for _, src := range in.Sources {
			run.sources[src] = true
		}
	}
	run.qFold = foldForSearch(in.Q)
	if in.FolderID != "" {
		doc, _, err := s.authorizeDocumentGate(ctx, q, actor, in.FolderID, decideDocumentViewOrAdminister)
		if err != nil {
			if isGateRefusal(err) {
				return nil, ErrNotFound
			}
			return nil, err
		}
		// One answer for every unusable folder: no oracle on other
		// workspaces, kinds or the trash.
		if doc.WorkspaceID != workspaceID || doc.Kind != DocumentKindFolder || doc.ArchivedAt.Valid || doc.OwnerKind.Valid {
			return nil, ErrNotFound
		}
		if err := s.refuseAdminForeignMyFolderScope(ctx, q, scope, workspaceID, doc); err != nil {
			return nil, err
		}
		run.folder = &doc
	}
	if in.PersonID != "" {
		p, err := run.userScope(ctx, in.PersonID)
		if err != nil {
			return nil, err
		}
		run.person = p
	}
	return run, nil
}

// refuseAdminForeignMyFolderScope answers not-found for a see_all caller
// whose folder lives in another member's My Folder and who has no real
// access of their own (ACL owner, workspace-visible at a member-admitted
// level, or a live share). An ordinary restricted folder the admin
// administers stays; CountDocumentAccessReportSubtree never sees a refused
// root.
func (s *DocumentService) refuseAdminForeignMyFolderScope(ctx context.Context, q *db.Queries, scope documentListScope, workspaceID string, doc db.Document) error {
	if !scope.seeAll {
		return nil
	}
	if doc.AclOwnerID.Valid && doc.AclOwnerID.String == scope.actorID {
		return nil
	}
	if doc.Visibility == documentVisibilityWorkspace {
		for _, l := range shareLevelsFor(DocumentLevelView) {
			if doc.WorkspaceLevel == l {
				return nil
			}
		}
	}
	if scope.allowShares {
		rows, err := q.ListLiveSharesForDocuments(ctx, db.ListLiveSharesForDocumentsParams{
			OrganizationID: scope.organizationID, WorkspaceID: workspaceID, DocumentIds: []string{doc.ID},
		})
		if err != nil {
			return err
		}
		for _, sh := range rows {
			if listShareApplies(scope, sh, doc) {
				return nil
			}
		}
	}
	inSet, err := q.DocumentInForeignMyFolder(ctx, db.DocumentInForeignMyFolderParams{
		ActorID: scope.actorID, OrganizationID: scope.organizationID, WorkspaceID: workspaceID,
		MaxLevel: subtreeMaxLevel(), DocumentID: doc.ID,
	})
	if err != nil {
		return err
	}
	if inSet {
		return ErrNotFound
	}
	return nil
}

// userScope is one person's list scope in this workspace, resolved once per
// request through the same gates the lists run; nil when a gate refuses them
// (left, deactivated, not in this organization).
func (r *accessReportRun) userScope(ctx context.Context, userID string) (*documentListScope, error) {
	if sc, ok := r.userScopes[userID]; ok {
		return sc, nil
	}
	sc, err := r.s.documentListScopeQ(ctx, r.q, Human(userID), r.workspaceID)
	if err != nil {
		if !isGateRefusal(err) {
			return nil, err
		}
		r.userScopes[userID] = nil
		return nil, nil
	}
	r.userScopes[userID] = &sc
	return &sc, nil
}

// groupShareActiveMemo is groupShareActive once per principal per request.
func (r *accessReportRun) groupShareActiveMemo(ctx context.Context, principalType, principalID string) (bool, error) {
	key := principalType + ":" + principalID
	if ok, seen := r.groupActive[key]; seen {
		return ok, nil
	}
	ok, err := groupShareActive(ctx, r.q, r.scope.organizationID, principalType, principalID)
	if err != nil {
		return false, err
	}
	r.groupActive[key] = ok
	return ok, nil
}

// groupName is a workspace or organization display name, read once per
// principal per request; "" when the row is gone.
func (r *accessReportRun) groupName(ctx context.Context, principalType, principalID string) (string, error) {
	key := principalType + ":" + principalID
	if name, ok := r.groupNames[key]; ok {
		return name, nil
	}
	name := ""
	switch principalType {
	case DocumentPrincipalWorkspace:
		w, err := r.q.GetWorkspaceByID(ctx, principalID)
		switch {
		case err == nil:
			// Only a workspace of this organization is named; a row that
			// points elsewhere is shown by id alone.
			if w.OrganizationID == r.scope.organizationID {
				name = w.Name
			}
		case !errors.Is(err, pgx.ErrNoRows):
			return "", err
		}
	case DocumentPrincipalOrganization:
		if principalID == r.scope.organizationID {
			o, err := r.q.GetOrganizationByID(ctx, principalID)
			if err != nil && !errors.Is(err, pgx.ErrNoRows) {
				return "", err
			}
			name = o.Name
		}
	}
	r.groupNames[key] = name
	return name, nil
}

// accessReportPageResult is one page before the request-level fields.
type accessReportPageResult struct {
	items               []DocumentAccessReportItem
	candidates, skipped int
	next                *AccessReportKey
}

// arCandidate is one candidate read: the document and its sort position.
type arCandidate struct {
	doc     db.Document
	changed time.Time
}

func (c arCandidate) key() AccessReportKey {
	return AccessReportKey{Changed: c.changed, Title: c.doc.Title, ID: c.doc.ID}
}

// arResult is what one candidate came to: counted as skipped (readable, not
// manageable), listed as an item, or neither.
type arResult struct {
	key     AccessReportKey
	skipped bool
	item    *DocumentAccessReportItem
	// listed is set for every document the caller manages, whatever the
	// filters did to it, with its general scope and flags (the summary tiles).
	listed bool
	scope  string
	flags  []string
}

// readChunk reads up to n candidates after the keyset position, in the
// requested order (changed, title, or the export's id order).
func (r *accessReportRun) readChunk(ctx context.Context, after *AccessReportKey, n int, mode string, descending bool) ([]arCandidate, error) {
	var afterChanged pgtype.Timestamptz
	var afterTitle, afterID string
	if after != nil {
		afterChanged = pgtype.Timestamptz{Time: after.Changed, Valid: true}
		afterTitle, afterID = after.Title, after.ID
	}
	var out []arCandidate
	if r.folder != nil {
		rows, err := r.q.ListDocumentAccessReportSubtreeCandidates(ctx, db.ListDocumentAccessReportSubtreeCandidatesParams{
			OrganizationID: r.scope.organizationID, WorkspaceID: r.workspaceID, RootID: r.folder.ID,
			SeeAll: r.scope.seeAll, ActorID: r.scope.actorID, MaxLevel: subtreeMaxLevel(),
			ShareLevels: shareLevelsFor(DocumentLevelView), ShareWorkspaces: r.scope.shareWorkspaces,
			Visibility: r.visibility, SortMode: mode, Descending: descending, HasAfter: after != nil,
			AfterChanged: afterChanged, AfterTitle: afterTitle, AfterID: afterID, MaxRows: int32(n),
		})
		if err != nil {
			return nil, err
		}
		out = make([]arCandidate, len(rows))
		for i, row := range rows {
			out[i] = accessReportCandidate(row)
		}
		return out, nil
	}
	rows, err := r.q.ListDocumentAccessReportWorkspaceCandidates(ctx, db.ListDocumentAccessReportWorkspaceCandidatesParams{
		OrganizationID: r.scope.organizationID, WorkspaceID: r.workspaceID,
		SeeAll: r.scope.seeAll, ActorID: r.scope.actorID, MaxLevel: subtreeMaxLevel(),
		ShareLevels: shareLevelsFor(DocumentLevelView), ShareWorkspaces: r.scope.shareWorkspaces,
		Visibility: r.visibility, SortMode: mode, Descending: descending, HasAfter: after != nil,
		AfterChanged: afterChanged, AfterTitle: afterTitle, AfterID: afterID, MaxRows: int32(n),
	})
	if err != nil {
		return nil, err
	}
	out = make([]arCandidate, len(rows))
	for i, row := range rows {
		out[i] = accessReportCandidate(db.ListDocumentAccessReportSubtreeCandidatesRow(row))
	}
	return out, nil
}

// anchorKey completes a cursor's id with the sort value of its document, read
// inside the tenant (UNI-2039 fx1): the cursor carries the id only, so the
// title or change time of a candidate the caller may not read never reaches
// them. An anchor that is gone (purged, archived, owned, a container) is a
// stale cursor: 400, the client restarts the list.
func (r *accessReportRun) anchorKey(ctx context.Context, key AccessReportKey) (AccessReportKey, error) {
	row, err := r.q.GetDocumentAccessReportAnchor(ctx, db.GetDocumentAccessReportAnchorParams{
		OrganizationID: r.scope.organizationID, WorkspaceID: r.workspaceID, ID: key.ID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return key, Invalid("cursor không hợp lệ")
	}
	if err != nil {
		return key, err
	}
	key.Title = row.Title
	if row.AccessChangedAt.Valid {
		key.Changed = row.AccessChangedAt.Time.UTC()
	}
	return key, nil
}

// page reads one page of the report in the query's order. It reads the whole
// scan window - accessReportScanFactor x limit candidates - in ONE candidate
// query (UNI-2039 r1 F3) and works through it in chunks of limit in memory,
// keeping on until it holds limit listable documents (S4) or the window is
// used up; only then does it return short, with a cursor, as the keyset walk
// always could. The query count does not grow with a chunk: one candidate
// read, one share read for the caller's levels, one for the rows, one link
// read, the path reads, one name batch, and per distinct principal the
// memoized gates.
func (r *accessReportRun) page(ctx context.Context, in DocumentAccessReportQuery, limit int) (accessReportPageResult, error) {
	var out accessReportPageResult
	mode, descending := in.SortOrder()
	after := in.After
	if after != nil {
		anchored, err := r.anchorKey(ctx, *after)
		if err != nil {
			return out, err
		}
		after = &anchored
	}
	window := accessReportScanFactor * limit
	all, err := r.readChunk(ctx, after, window, mode, descending)
	if err != nil {
		return out, err
	}
	for off := 0; off < len(all); off += limit {
		cands := all[off:min(off+limit, len(all))]
		results, err := r.process(ctx, cands)
		if err != nil {
			return out, err
		}
		for i, res := range results {
			out.candidates++
			if res.skipped {
				out.skipped++
			}
			if res.item != nil {
				out.items = append(out.items, *res.item)
			}
			key := res.key
			if len(out.items) == limit {
				// A full page. The walk is over when this was the last
				// candidate of a chunk that came back short.
				if i < len(results)-1 || len(cands) == limit {
					out.next = &key
				}
				return out, nil
			}
			after = &key
		}
		if len(cands) < limit {
			return out, nil
		}
	}
	if len(all) < window {
		return out, nil
	}
	// The scan bound: a short page that keeps its cursor.
	out.next = after
	return out, nil
}

// scan walks the whole scope in id order, chunk candidates at a time, and
// hands every chunk's results to fn (export, summary, principals). maxCand > 0
// stops after that many candidates and reports truncated when more remain.
func (r *accessReportRun) scan(ctx context.Context, chunk, maxCand int, fn func([]arResult) error) (truncated bool, err error) {
	var after *AccessReportKey
	read := 0
	for {
		n := chunk
		if maxCand > 0 && maxCand-read < n {
			n = maxCand - read
		}
		cands, err := r.readChunk(ctx, after, n, accessReportSortID, false)
		if err != nil {
			return false, err
		}
		results, err := r.process(ctx, cands)
		if err != nil {
			return false, err
		}
		if err := fn(results); err != nil {
			return false, err
		}
		read += len(cands)
		if len(cands) < n {
			return false, nil
		}
		last := cands[len(cands)-1].key()
		after = &last
		if maxCand > 0 && read >= maxCand {
			// Truncated only when one more candidate exists.
			more, err := r.readChunk(ctx, after, 1, accessReportSortID, false)
			return len(more) > 0, err
		}
	}
}

// accessReportCandidate is a narrow candidate row as the document the list
// mirror reads; the columns it leaves out (content, search text, versions)
// no report path reads.
func accessReportCandidate(r db.ListDocumentAccessReportSubtreeCandidatesRow) arCandidate {
	c := arCandidate{doc: db.Document{
		ID: r.ID, OrganizationID: r.OrganizationID, WorkspaceID: r.WorkspaceID, ParentID: r.ParentID,
		Kind: r.Kind, SystemKind: r.SystemKind, Title: r.Title, Visibility: r.Visibility, WorkspaceLevel: r.WorkspaceLevel,
		OwnerKind: r.OwnerKind, OwnerID: r.OwnerID,
		AclOwnerID: r.AclOwnerID, ArchivedAt: r.ArchivedAt, UpdatedAt: r.UpdatedAt,
	}}
	if r.AccessChangedAt.Valid {
		c.changed = r.AccessChangedAt.Time.UTC()
	}
	return c
}

// process turns one chunk of candidates into results, in order: the caller's
// level on each (the list mirror), the rows of the documents they manage, the
// names, then the filters. Nothing here depends on how many results the
// caller keeps.
func (r *accessReportRun) process(ctx context.Context, cands []arCandidate) ([]arResult, error) {
	results := make([]arResult, len(cands))
	if len(cands) == 0 {
		return results, nil
	}
	items := make([]DocumentListItem, len(cands))
	for i, c := range cands {
		items[i] = DocumentListItem{Document: c.doc}
		results[i].key = c.key()
	}
	if err := r.s.attachListAccessQ(ctx, r.q, r.scope, r.workspaceID, false, items); err != nil {
		return nil, err
	}
	var listed []DocumentListItem
	var listedAt []int
	for i, c := range items {
		switch {
		case c.Access.canAdminister():
			listed = append(listed, c)
			listedAt = append(listedAt, i)
		case c.Access.Level.AtLeast(DocumentLevelView):
			results[i].skipped = true
		}
	}
	if len(listed) == 0 {
		return results, nil
	}
	ids := make([]string, len(listed))
	for i, it := range listed {
		ids[i] = it.Document.ID
	}
	shareRows, err := r.q.ListLiveDocumentSharesForReport(ctx, db.ListLiveDocumentSharesForReportParams{
		OrganizationID: r.scope.organizationID, WorkspaceID: r.workspaceID, DocumentIds: ids,
	})
	if err != nil {
		return nil, err
	}
	shares := make(map[string][]db.ListLiveDocumentSharesForReportRow, len(listed))
	for _, sh := range shareRows {
		shares[sh.DocumentID] = append(shares[sh.DocumentID], sh)
	}
	linkRows, err := r.q.ListLiveDocumentShareLinksForReport(ctx, db.ListLiveDocumentShareLinksForReportParams{
		OrganizationID: r.scope.organizationID, WorkspaceID: r.workspaceID, DocumentIds: ids,
	})
	if err != nil {
		return nil, err
	}
	links := make(map[string][]db.ListLiveDocumentShareLinksForReportRow, len(listed))
	for _, l := range linkRows {
		links[l.DocumentID] = append(links[l.DocumentID], l)
	}
	grantRows, err := r.q.ListLiveBreakGlassGrantsForReport(ctx, db.ListLiveBreakGlassGrantsForReportParams{
		OrganizationID: r.scope.organizationID, WorkspaceID: r.workspaceID, DocumentIds: ids,
	})
	if err != nil {
		return nil, err
	}
	grants := make(map[string][]db.ListLiveBreakGlassGrantsForReportRow, len(listed))
	for _, g := range grantRows {
		// Only a person holds a grant (DOC-05); any other kind is not a
		// principal the report can name.
		if g.ActorKind == string(audit.KindHuman) {
			grants[g.DocumentID] = append(grants[g.DocumentID], g)
		}
	}
	if err := r.s.attachListPathsQ(ctx, r.q, r.scope, r.workspaceID, false, listed); err != nil {
		return nil, err
	}
	var built []DocumentAccessReportItem
	var builtAt []int
	for n, it := range listed {
		item, keep, err := r.buildItem(ctx, it, cands[listedAt[n]].changed, shares[it.Document.ID], grants[it.Document.ID], links[it.Document.ID])
		if err != nil {
			return nil, err
		}
		results[listedAt[n]].listed = true
		results[listedAt[n]].scope, results[listedAt[n]].flags = item.GeneralScope, item.Flags
		if keep {
			built = append(built, item)
			builtAt = append(builtAt, listedAt[n])
		}
	}
	if err := r.attachNames(ctx, built); err != nil {
		return nil, err
	}
	for n := range built {
		if r.matchesQ(built[n]) {
			results[builtAt[n]].item = &built[n]
		}
	}
	return results, nil
}

// buildItem turns one listed document into its rows, then applies the person
// and level filters; keep is false when the filters leave nothing of it.
func (r *accessReportRun) buildItem(ctx context.Context, it DocumentListItem, changed time.Time, shares []db.ListLiveDocumentSharesForReportRow, grants []db.ListLiveBreakGlassGrantsForReportRow, links []db.ListLiveDocumentShareLinksForReportRow) (DocumentAccessReportItem, bool, error) {
	doc := it.Document
	item := DocumentAccessReportItem{Item: it, LiveLinkCount: len(links), AccessChangedAt: changed}
	item.GeneralScope, item.GeneralLevel, item.Flags = accessReportFacts(doc, shares, len(links))
	// The revoke buttons follow the gate of the DELETE routes' services: the
	// share and link routes run requireDocumentACLChange, the break-glass
	// route lets the grant's holder or anyone who administers revoke it.
	canRevokeACL := requireDocumentACLChange(doc, it.Access) == nil
	// Document-level filters need no rows: a document they refuse (or a
	// person no gate admits) costs nothing more. The facts above stay set, so
	// the summary's tiles still count it.
	if !r.matchesDocument(item) || (r.in.PersonID != "" && r.person == nil) {
		return item, false, nil
	}
	// The page's shares in the list mirror's shape: every level below is
	// listRowAccess over them, the batched form of resolveLevel.
	mirror := make([]db.ListLiveSharesForDocumentsRow, len(shares))
	for i, sh := range shares {
		mirror[i] = db.ListLiveSharesForDocumentsRow{DocumentID: sh.DocumentID, PrincipalType: sh.PrincipalType, PrincipalID: sh.PrincipalID, Level: sh.Level}
	}
	// holdsGrant is listRowAccess's break-glass input for one person: a live
	// grant of theirs on this document (it only counts on an AdminScope row).
	holdsGrant := func(userID string) bool {
		for _, g := range grants {
			if g.ActorID == userID {
				return true
			}
		}
		return false
	}
	userLevel := func(userID string) (DocumentLevel, error) {
		sc, err := r.userScope(ctx, userID)
		if err != nil || sc == nil {
			return DocumentLevelNone, err
		}
		return listRowAccess(*sc, false, doc, mirror, holdsGrant(userID)).Level, nil
	}
	active := make([]bool, len(shares))
	for i, sh := range shares {
		if sh.PrincipalType == DocumentPrincipalUser {
			continue
		}
		ok, err := r.groupShareActiveMemo(ctx, sh.PrincipalType, sh.PrincipalID)
		if err != nil {
			return item, false, err
		}
		active[i] = ok
	}
	groupLevel := func(principalType, principalID string) DocumentLevel {
		return groupFloorLevel(doc, principalType, principalID, shares, active)
	}

	if doc.AclOwnerID.Valid {
		lvl, err := userLevel(doc.AclOwnerID.String)
		if err != nil {
			return item, false, err
		}
		item.Rows = append(item.Rows, DocumentAccessReportRow{
			Source: AccessReportSourceACLOwner, Via: string(DocumentViaMember),
			PrincipalType: DocumentPrincipalUser, PrincipalID: doc.AclOwnerID.String,
			Level: string(DocumentLevelManage), EffectiveLevel: accessReportLevel(lvl), Active: lvl != DocumentLevelNone,
		})
	}
	if doc.Visibility != documentVisibilityRestricted {
		item.Rows = append(item.Rows, DocumentAccessReportRow{
			Source: AccessReportSourceWorkspace, Via: string(DocumentViaMember),
			PrincipalType: DocumentPrincipalWorkspace, PrincipalID: doc.WorkspaceID,
			Level:          string(DocumentLevel(doc.WorkspaceLevel)),
			EffectiveLevel: accessReportLevel(groupLevel(DocumentPrincipalWorkspace, doc.WorkspaceID)), Active: true,
		})
	}
	for i, sh := range shares {
		row := DocumentAccessReportRow{
			Source: AccessReportSourceShare, Via: string(DocumentViaShare),
			PrincipalType: sh.PrincipalType, PrincipalID: sh.PrincipalID, Level: sh.Level,
			GrantedBy: sh.GrantedBy, GrantedByKind: sh.GrantedByKind, ShareID: sh.ID,
			Origin: sh.Origin,
		}
		if canRevokeACL {
			row.RevokeKind, row.RevokeID = AccessReportRevokeShare, sh.ID
		}
		if sh.CreatedAt.Valid {
			at := sh.CreatedAt.Time.UTC()
			row.GrantedAt = &at
		}
		lvl := DocumentLevelNone
		if sh.PrincipalType == DocumentPrincipalUser {
			var err error
			if lvl, err = userLevel(sh.PrincipalID); err != nil {
				return item, false, err
			}
			row.Active = lvl != DocumentLevelNone
		} else if active[i] {
			row.Active = true
			lvl = groupLevel(sh.PrincipalType, sh.PrincipalID)
		}
		row.EffectiveLevel = accessReportLevel(lvl)
		item.Rows = append(item.Rows, row)
	}
	// Live public links (UNI-2039 S2), one row each in creation order. A link
	// gives anyone who holds it view, so level and effective level are view.
	for _, l := range links {
		row := DocumentAccessReportRow{
			Source: AccessReportSourceLink, Via: AccessReportViaLink,
			PrincipalType: AccessReportSourceLink, PrincipalID: l.ID,
			Level: string(DocumentLevelView), EffectiveLevel: string(DocumentLevelView), Active: true,
			GrantedBy: l.CreatedBy, GrantedByKind: l.CreatedByKind,
		}
		if l.CreatedAt.Valid {
			at := l.CreatedAt.Time.UTC()
			row.GrantedAt = &at
		}
		if l.ExpiresAt.Valid {
			at := l.ExpiresAt.Time.UTC()
			row.ExpiresAt = &at
		}
		if canRevokeACL {
			row.RevokeKind, row.RevokeID = AccessReportRevokeLink, l.ID
		}
		item.Rows = append(item.Rows, row)
	}
	// Live break-glass grants (UNI-1643 P-10, DOC-05), after the links in
	// granted_at order. The admin opened it for themselves, so granted_by is
	// the grantee; the reason stays off the report.
	for _, g := range grants {
		lvl, err := userLevel(g.ActorID)
		if err != nil {
			return item, false, err
		}
		row := DocumentAccessReportRow{
			Source: AccessReportSourceBreakGlass, Via: string(DocumentViaBreakGlass),
			PrincipalType: DocumentPrincipalUser, PrincipalID: g.ActorID, Level: g.Level,
			EffectiveLevel: accessReportLevel(lvl), Active: lvl != DocumentLevelNone,
			GrantedBy: g.ActorID, GrantedByKind: g.ActorKind,
		}
		if (g.ActorID == r.scope.actorID && g.ActorKind == string(audit.KindHuman)) || it.Access.canAdminister() {
			row.RevokeKind, row.RevokeID = AccessReportRevokeBreakGlass, g.ID
		}
		if g.GrantedAt.Valid {
			at := g.GrantedAt.Time.UTC()
			row.GrantedAt = &at
		}
		item.Rows = append(item.Rows, row)
	}

	if r.in.PersonID != "" {
		item.PersonLevel = listRowAccess(*r.person, false, doc, mirror, holdsGrant(r.in.PersonID)).Level
		kept := item.Rows[:0]
		for _, row := range item.Rows {
			if r.rowReachesPerson(doc, row) {
				kept = append(kept, row)
			}
		}
		item.Rows = kept
		if item.PersonLevel == DocumentLevelNone && len(item.Rows) == 0 {
			return item, false, nil
		}
	}
	if r.levels != nil || r.sources != nil || r.in.PrincipalType != "" || r.in.NonDefault {
		kept := item.Rows[:0]
		for _, row := range item.Rows {
			if r.matchesRow(row) {
				kept = append(kept, row)
			}
		}
		item.Rows = kept
		if len(item.Rows) == 0 {
			return item, false, nil
		}
	}
	return item, true, nil
}

// matchesDocument is the document-level half of the S5 filters, decided from
// the document's facts alone: visibility, general scope, flag.
func (r *accessReportRun) matchesDocument(item DocumentAccessReportItem) bool {
	if v := r.in.Visibility; v != "" && item.Item.Document.Visibility != v {
		return false
	}
	if r.in.Scope != "" && item.GeneralScope != r.in.Scope {
		return false
	}
	switch r.in.Flag {
	case "":
	case AccessReportFlagOutside:
		if !slices.Contains(item.Flags, AccessReportFlagOtherWS) && !slices.Contains(item.Flags, AccessReportFlagOrganization) {
			return false
		}
	default:
		if !slices.Contains(item.Flags, r.in.Flag) {
			return false
		}
	}
	return true
}

// matchesRow is the row-level half: a row that fails level, principal,
// source or non_default is dropped, and a document left with no row is too.
func (r *accessReportRun) matchesRow(row DocumentAccessReportRow) bool {
	if r.levels != nil && !r.levels[row.Level] {
		return false
	}
	key := accessReportSourceKey(row)
	if r.sources != nil && !r.sources[key] {
		return false
	}
	if r.in.NonDefault && (key == AccessReportSourceKeyOwner || key == AccessReportSourceKeyWorkspace) {
		return false
	}
	if t := r.in.PrincipalType; t != "" {
		if row.PrincipalType != t || (r.in.PrincipalID != "" && row.PrincipalID != r.in.PrincipalID) {
			return false
		}
	}
	return true
}

// matchesQ is the S5 text filter, run after the names are attached: the
// document title or the name of a principal on one of its rows, ignoring case
// and accents. A principal name only reaches this check through a row the
// caller already sees on a document they manage.
func (r *accessReportRun) matchesQ(item DocumentAccessReportItem) bool {
	if r.qFold == "" {
		return true
	}
	if strings.Contains(foldForSearch(item.Item.Document.Title), r.qFold) {
		return true
	}
	for _, row := range item.Rows {
		if row.PrincipalName != "" && strings.Contains(foldForSearch(row.PrincipalName), r.qFold) {
			return true
		}
	}
	return false
}

// rowReachesPerson: the person's own user rows, a workspace row of a
// workspace they are in, and the organization row (their gates passed).
func (r *accessReportRun) rowReachesPerson(doc db.Document, row DocumentAccessReportRow) bool {
	switch row.PrincipalType {
	case DocumentPrincipalUser:
		return row.PrincipalID == r.in.PersonID
	case DocumentPrincipalOrganization:
		return row.PrincipalID == doc.OrganizationID
	case DocumentPrincipalWorkspace:
		for _, w := range r.person.shareWorkspaces {
			if w == row.PrincipalID {
				return true
			}
		}
	}
	return false
}

// groupFloorLevel is the level every member of a workspace or organization
// principal gets from one document: the highest active row that reaches all
// of them - its own shares, the organization share, and the home row's stored
// level for the document's own workspace on a workspace-visible document
// (resolveLevel's member path). One member may hold more through their own
// rows.
func groupFloorLevel(doc db.Document, principalType, principalID string, shares []db.ListLiveDocumentSharesForReportRow, active []bool) DocumentLevel {
	best := DocumentLevelNone
	if principalType == DocumentPrincipalWorkspace && principalID == doc.WorkspaceID && doc.Visibility != documentVisibilityRestricted {
		best = DocumentLevel(doc.WorkspaceLevel)
	}
	for i, sh := range shares {
		if !active[i] {
			continue
		}
		reaches := (sh.PrincipalType == principalType && sh.PrincipalID == principalID) ||
			(sh.PrincipalType == DocumentPrincipalOrganization && sh.PrincipalID == doc.OrganizationID)
		if lvl := DocumentLevel(sh.Level); reaches && lvl.rank() > best.rank() {
			best = lvl
		}
	}
	return best
}

// accessReportLevel is the wire form of a level: "none" instead of "".
func accessReportLevel(l DocumentLevel) string {
	if l == DocumentLevelNone {
		return "none"
	}
	return string(l)
}

// attachNames fills every display name of a page in one actor batch plus the
// memoized group names. Names only: the report never carries an email.
func (r *accessReportRun) attachNames(ctx context.Context, items []DocumentAccessReportItem) error {
	seen := map[ActorRef]bool{}
	var refs []ActorRef
	add := func(kind audit.Kind, id string) {
		ref := ActorRef{Kind: kind, ID: id}
		if id != "" && !seen[ref] {
			seen[ref] = true
			refs = append(refs, ref)
		}
	}
	for _, it := range items {
		if it.Item.Document.AclOwnerID.Valid {
			add(audit.KindHuman, it.Item.Document.AclOwnerID.String)
		}
		for _, row := range it.Rows {
			if row.PrincipalType == DocumentPrincipalUser {
				add(audit.KindHuman, row.PrincipalID)
			}
			if row.GrantedBy != "" {
				add(audit.Kind(row.GrantedByKind), row.GrantedBy)
			}
		}
	}
	infos := map[ActorRef]ActorInfo{}
	if len(refs) > 0 {
		var err error
		if infos, err = NewActorService(r.q).Resolve(ctx, refs); err != nil {
			return err
		}
	}
	for i := range items {
		it := &items[i]
		if it.Item.Document.AclOwnerID.Valid {
			it.ACLOwnerName = infos[ActorRef{Kind: audit.KindHuman, ID: it.Item.Document.AclOwnerID.String}].DisplayName
		}
		for j := range it.Rows {
			row := &it.Rows[j]
			if row.PrincipalType == DocumentPrincipalUser {
				row.PrincipalName = infos[ActorRef{Kind: audit.KindHuman, ID: row.PrincipalID}].DisplayName
			} else {
				name, err := r.groupName(ctx, row.PrincipalType, row.PrincipalID)
				if err != nil {
					return err
				}
				row.PrincipalName = name
			}
			if row.GrantedBy != "" {
				row.GrantedByName = infos[ActorRef{Kind: audit.Kind(row.GrantedByKind), ID: row.GrantedBy}].DisplayName
			}
		}
	}
	return nil
}

// DocumentAccessReport reads one page of the access report.
func (s *DocumentService) DocumentAccessReport(ctx context.Context, actor Actor, workspaceID string, in DocumentAccessReportQuery) (DocumentAccessReportPage, error) {
	run, err := s.openAccessReport(ctx, s.q, actor, workspaceID, in)
	if err != nil {
		return DocumentAccessReportPage{}, err
	}
	res, err := run.page(ctx, in, effectiveAccessReportLimit(in.Limit))
	if err != nil {
		return DocumentAccessReportPage{}, err
	}
	out := DocumentAccessReportPage{
		GeneratedAt: s.now().UTC(), Items: res.items,
		Candidates: res.candidates, Skipped: res.skipped, Next: res.next,
	}
	if run.folder != nil {
		out.FolderID, out.FolderTitle = run.folder.ID, run.folder.Title
	}
	return out, nil
}

// accessReportFacts are the whole-document facts of S1, read from every live
// share before a row filter runs: the general scope (an organization share
// wins over workspace visibility), and the warning flags the tiles and the
// flag filter share one definition of.
func accessReportFacts(doc db.Document, shares []db.ListLiveDocumentSharesForReportRow, links int) (scope, level string, flags []string) {
	scope = AccessReportScopeRestricted
	if doc.Visibility != documentVisibilityRestricted {
		scope, level = AccessReportScopeWorkspace, doc.WorkspaceLevel
	}
	var otherWS, org, directManage bool
	for _, sh := range shares {
		switch sh.PrincipalType {
		case DocumentPrincipalOrganization:
			org = true
			scope, level = AccessReportScopeOrganization, sh.Level
		case DocumentPrincipalWorkspace:
			if sh.PrincipalID != doc.WorkspaceID {
				otherWS = true
			}
		}
		isOwner := sh.PrincipalType == DocumentPrincipalUser && doc.AclOwnerID.Valid && sh.PrincipalID == doc.AclOwnerID.String
		if sh.Level == string(DocumentLevelManage) && !isOwner &&
			(sh.PrincipalType == DocumentPrincipalUser || sh.PrincipalType == DocumentPrincipalWorkspace) {
			directManage = true
		}
	}
	flags = []string{}
	if links > 0 {
		flags = append(flags, AccessReportFlagPublicLink)
	}
	if otherWS {
		flags = append(flags, AccessReportFlagOtherWS)
	}
	if org {
		flags = append(flags, AccessReportFlagOrganization)
	}
	if directManage {
		flags = append(flags, AccessReportFlagDirectManage)
	}
	return scope, level, flags
}
