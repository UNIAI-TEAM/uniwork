package service

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Document access report (UNI-1643): who holds which level on every document
// the caller manages in a workspace or one folder (recursive). It reads the
// caller's and each person's level through the list mirror of the resolver
// (documentListScope + listRowAccess), never through a second access rule.

// Row sources of the access report. Unknown values stay possible on the wire
// (break_glass lands with UNI-1413); clients render them as "other".
const (
	AccessReportSourceACLOwner   = "acl_owner"
	AccessReportSourceWorkspace  = "workspace"
	AccessReportSourceShare      = "share"
	AccessReportSourceBreakGlass = "break_glass"
)

// DocumentAccessReportQuery is one request of the report. Levels are
// validated values; AfterID is the last candidate of the previous page.
type DocumentAccessReportQuery struct {
	FolderID, PersonID, Visibility, AfterID string
	Levels                                  []string
	Limit                                   int
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
}

// DocumentAccessReportItem is one listed document with its rows.
type DocumentAccessReportItem struct {
	Item          DocumentListItem // Document, Access (the caller's), Path
	ACLOwnerName  string
	LiveLinkCount int
	// PersonLevel is set only when the query names a person.
	PersonLevel DocumentLevel
	Rows        []DocumentAccessReportRow
}

// DocumentAccessReportPage is one page of the report.
type DocumentAccessReportPage struct {
	FolderID, FolderTitle string
	GeneratedAt           time.Time
	Items                 []DocumentAccessReportItem
	Candidates, Skipped   int
	// NextAfterID is the last candidate read when the page was full; "" = done.
	NextAfterID string
}

// DocumentAccessReportExport is what an export wrote.
type DocumentAccessReportExport struct {
	Rows, Documents, Skipped int
	GeneratedAt              time.Time
	FolderTitle              string
	// Format is csv or xlsx; FileName is ASCII, ready for Content-Disposition.
	Format, FileName string
}

// EffectiveAccessReportLimit clamps a requested page size (<= 0 or > 100 ->
// 50), exported so the handler can tell a full page without a second copy.
func EffectiveAccessReportLimit(limit int) int {
	if limit <= 0 || limit > 100 {
		return 50
	}
	return limit
}

// accessReportLevels are the row levels a filter may name. comment is
// accepted before UNI-1413 adds it to the shares CHECK; it then matches
// nothing.
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
	return nil
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
// live folder of this workspace the caller reads.
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
	}
	if len(in.Levels) > 0 {
		run.levels = make(map[string]bool, len(in.Levels))
		for _, l := range in.Levels {
			run.levels[l] = true
		}
	}
	if in.FolderID != "" {
		doc, _, err := s.authorizeDocumentQ(ctx, q, actor, in.FolderID, DocumentLevelView)
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
	nextAfterID         string
}

// page reads limit candidates after afterID and builds the listed items. The
// query count does not grow with the page: one candidate read, one share
// read for the caller's levels, one for the rows, one link count, the path
// reads, one name batch, and per distinct principal the memoized gates.
func (r *accessReportRun) page(ctx context.Context, afterID string, limit int) (accessReportPageResult, error) {
	var out accessReportPageResult
	var docs []db.Document
	if r.folder != nil {
		rows, err := r.q.ListDocumentAccessReportSubtreeCandidates(ctx, db.ListDocumentAccessReportSubtreeCandidatesParams{
			OrganizationID: r.scope.organizationID, WorkspaceID: r.workspaceID, RootID: r.folder.ID,
			MaxLevel: subtreeMaxLevel(), Visibility: r.in.Visibility, AfterID: afterID, MaxRows: int32(limit),
		})
		if err != nil {
			return out, err
		}
		docs = make([]db.Document, len(rows))
		for i, row := range rows {
			docs[i] = accessReportCandidate(row)
		}
	} else {
		rows, err := r.q.ListDocumentAccessReportWorkspaceCandidates(ctx, db.ListDocumentAccessReportWorkspaceCandidatesParams{
			OrganizationID: r.scope.organizationID, WorkspaceID: r.workspaceID,
			Visibility: r.in.Visibility, AfterID: afterID, MaxRows: int32(limit),
		})
		if err != nil {
			return out, err
		}
		docs = make([]db.Document, len(rows))
		for i, row := range rows {
			docs[i] = accessReportCandidate(db.ListDocumentAccessReportSubtreeCandidatesRow(row))
		}
	}
	out.candidates = len(docs)
	if len(docs) == limit {
		out.nextAfterID = docs[len(docs)-1].ID
	}
	if len(docs) == 0 {
		return out, nil
	}
	cands := make([]DocumentListItem, len(docs))
	for i, d := range docs {
		cands[i] = DocumentListItem{Document: d}
	}
	if err := r.s.attachListAccessQ(ctx, r.q, r.scope, r.workspaceID, false, cands); err != nil {
		return out, err
	}
	var listed []DocumentListItem
	for _, c := range cands {
		switch {
		case c.Access.Level.AtLeast(DocumentLevelManage):
			listed = append(listed, c)
		case c.Access.Level.AtLeast(DocumentLevelView):
			out.skipped++
		}
	}
	if len(listed) == 0 || (r.in.PersonID != "" && r.person == nil) {
		return out, nil
	}
	ids := make([]string, len(listed))
	for i, it := range listed {
		ids[i] = it.Document.ID
	}
	shareRows, err := r.q.ListLiveDocumentSharesForReport(ctx, db.ListLiveDocumentSharesForReportParams{
		OrganizationID: r.scope.organizationID, WorkspaceID: r.workspaceID, DocumentIds: ids,
	})
	if err != nil {
		return out, err
	}
	shares := make(map[string][]db.ListLiveDocumentSharesForReportRow, len(listed))
	for _, sh := range shareRows {
		shares[sh.DocumentID] = append(shares[sh.DocumentID], sh)
	}
	linkRows, err := r.q.CountLiveDocumentShareLinksForDocuments(ctx, db.CountLiveDocumentShareLinksForDocumentsParams{
		OrganizationID: r.scope.organizationID, WorkspaceID: r.workspaceID, DocumentIds: ids,
	})
	if err != nil {
		return out, err
	}
	links := make(map[string]int, len(linkRows))
	for _, l := range linkRows {
		links[l.DocumentID] = int(l.N)
	}
	if err := r.s.attachListPathsQ(ctx, r.q, r.scope, r.workspaceID, false, listed); err != nil {
		return out, err
	}
	for _, it := range listed {
		item, keep, err := r.buildItem(ctx, it, shares[it.Document.ID], links[it.Document.ID])
		if err != nil {
			return out, err
		}
		if keep {
			out.items = append(out.items, item)
		}
	}
	return out, r.attachNames(ctx, out.items)
}

// accessReportCandidate is a narrow candidate row as the document the list
// mirror reads; the columns it leaves out (content, search text, versions)
// no report path reads.
func accessReportCandidate(r db.ListDocumentAccessReportSubtreeCandidatesRow) db.Document {
	return db.Document{
		ID: r.ID, OrganizationID: r.OrganizationID, WorkspaceID: r.WorkspaceID, ParentID: r.ParentID,
		Kind: r.Kind, Title: r.Title, Visibility: r.Visibility, OwnerKind: r.OwnerKind, OwnerID: r.OwnerID,
		AclOwnerID: r.AclOwnerID, ArchivedAt: r.ArchivedAt, UpdatedAt: r.UpdatedAt,
	}
}

// buildItem turns one listed document into its rows, then applies the person
// and level filters; keep is false when the filters leave nothing of it.
func (r *accessReportRun) buildItem(ctx context.Context, it DocumentListItem, shares []db.ListLiveDocumentSharesForReportRow, links int) (DocumentAccessReportItem, bool, error) {
	doc := it.Document
	item := DocumentAccessReportItem{Item: it, LiveLinkCount: links}
	// The page's shares in the list mirror's shape: every level below is
	// listRowAccess over them, the batched form of resolveLevel.
	mirror := make([]db.ListLiveSharesForDocumentsRow, len(shares))
	for i, sh := range shares {
		mirror[i] = db.ListLiveSharesForDocumentsRow{DocumentID: sh.DocumentID, PrincipalType: sh.PrincipalType, PrincipalID: sh.PrincipalID, Level: sh.Level}
	}
	userLevel := func(userID string) (DocumentLevel, error) {
		sc, err := r.userScope(ctx, userID)
		if err != nil || sc == nil {
			return DocumentLevelNone, err
		}
		return listRowAccess(*sc, false, doc, mirror).Level, nil
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
			Level:          string(DocumentLevelEdit),
			EffectiveLevel: accessReportLevel(groupLevel(DocumentPrincipalWorkspace, doc.WorkspaceID)), Active: true,
		})
	}
	for i, sh := range shares {
		row := DocumentAccessReportRow{
			Source: AccessReportSourceShare, Via: string(DocumentViaShare),
			PrincipalType: sh.PrincipalType, PrincipalID: sh.PrincipalID, Level: sh.Level,
			GrantedBy: sh.GrantedBy, GrantedByKind: sh.GrantedByKind, ShareID: sh.ID,
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

	if r.in.PersonID != "" {
		item.PersonLevel = listRowAccess(*r.person, false, doc, mirror).Level
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
	if r.levels != nil {
		kept := item.Rows[:0]
		for _, row := range item.Rows {
			if r.levels[row.Level] {
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
// of them - its own shares, the organization share, and edit for the
// document's own workspace on a workspace-visible document (resolveLevel's
// member path). One member may hold more through their own rows.
func groupFloorLevel(doc db.Document, principalType, principalID string, shares []db.ListLiveDocumentSharesForReportRow, active []bool) DocumentLevel {
	best := DocumentLevelNone
	if principalType == DocumentPrincipalWorkspace && principalID == doc.WorkspaceID && doc.Visibility != documentVisibilityRestricted {
		best = DocumentLevelEdit
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
	res, err := run.page(ctx, in.AfterID, EffectiveAccessReportLimit(in.Limit))
	if err != nil {
		return DocumentAccessReportPage{}, err
	}
	out := DocumentAccessReportPage{
		GeneratedAt: s.now().UTC(), Items: res.items,
		Candidates: res.candidates, Skipped: res.skipped, NextAfterID: res.nextAfterID,
	}
	if run.folder != nil {
		out.FolderID, out.FolderTitle = run.folder.ID, run.folder.Title
	}
	return out, nil
}
