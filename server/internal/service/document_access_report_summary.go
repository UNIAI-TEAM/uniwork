package service

import (
	"context"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The access report's whole-scope reads (UNI-2039 S6, S7): the summary tiles
// and the by-principal table. Both scan the scope the way the export does -
// one RepeatableRead snapshot, 500 candidates a chunk - through the same run,
// so they see exactly the documents, rows and names the page does.

// accessReportScanMaxDocs caps a summary or principals scan (candidates);
// a var so tests can shrink it.
var accessReportScanMaxDocs = 10000

// accessReportPrincipalsMax caps the principals table.
const accessReportPrincipalsMax = 500

// DocumentAccessReportTiles are the whole-scope counts of managed documents.
// They never depend on a filter, so a tile does not jump when one is set.
type DocumentAccessReportTiles struct {
	PublicLink, OutsideWorkspace, DirectManage     int
	Documents, Restricted, Workspace, Organization int
}

// DocumentAccessReportSummary is S6: the tiles of the scope, and how many of
// its documents the filters match.
type DocumentAccessReportSummary struct {
	GeneratedAt       time.Time
	Tiles             DocumentAccessReportTiles
	MatchingDocuments int
	// Skipped counts documents the caller can read but not manage, over the
	// whole scope.
	Skipped int
	// Truncated: the scan hit its candidate cap, so every number is the part
	// scanned.
	Truncated bool
}

// DocumentAccessReportSummary reads S6 inside one snapshot.
func (s *DocumentService) DocumentAccessReportSummary(ctx context.Context, actor Actor, workspaceID string, in DocumentAccessReportQuery) (DocumentAccessReportSummary, error) {
	var out DocumentAccessReportSummary
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return out, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	run, err := s.openAccessReport(ctx, s.q.WithTx(tx), actor, workspaceID, in)
	if err != nil {
		return out, err
	}
	// The tiles are about the scope, not the filters: the candidate read does
	// not narrow by visibility here (the filter decides matching_documents).
	run.visibility = ""
	out.Truncated, err = run.scan(ctx, accessReportExportPage, accessReportScanMaxDocs, func(results []arResult) error {
		for _, res := range results {
			if res.skipped {
				out.Skipped++
			}
			if res.item != nil {
				out.MatchingDocuments++
			}
			if !res.listed {
				continue
			}
			out.Tiles.Documents++
			switch res.scope {
			case AccessReportScopeRestricted:
				out.Tiles.Restricted++
			case AccessReportScopeWorkspace:
				out.Tiles.Workspace++
			case AccessReportScopeOrganization:
				out.Tiles.Organization++
			}
			for _, f := range res.flags {
				switch f {
				case AccessReportFlagPublicLink:
					out.Tiles.PublicLink++
				case AccessReportFlagDirectManage:
					out.Tiles.DirectManage++
				}
			}
			if hasOutsideFlag(res.flags) {
				out.Tiles.OutsideWorkspace++
			}
		}
		return nil
	})
	if err != nil {
		return out, err
	}
	out.GeneratedAt = s.now().UTC()
	return out, nil
}

// hasOutsideFlag: "shared outside the workspace" is another workspace or the
// whole organization.
func hasOutsideFlag(flags []string) bool {
	for _, f := range flags {
		if f == AccessReportFlagOtherWS || f == AccessReportFlagOrganization {
			return true
		}
	}
	return false
}

// Principal kinds of S7.
const (
	AccessReportKindMember         = "member"
	AccessReportKindHomeWorkspace  = "home_workspace"
	AccessReportKindOtherWorkspace = "other_workspace"
	AccessReportKindOrganization   = "organization"
	AccessReportKindLink           = "link"
	AccessReportSortCount          = "count"
	AccessReportSortName           = "name"
)

// DocumentAccessReportPrincipalsQuery is one S7 request.
type DocumentAccessReportPrincipalsQuery struct {
	FolderID, Q, Kind string
	Levels            []string
	Sort, Order       string
}

// DocumentAccessReportPrincipal is one row of the by-principal table.
type DocumentAccessReportPrincipal struct {
	PrincipalType, PrincipalID, PrincipalName, Kind string
	// MemberCount is set for a workspace or the organization.
	MemberCount   *int
	DocumentCount int
	// Levels counts documents by the highest level the principal holds on each.
	Levels     map[string]int
	MainSource string
}

// DocumentAccessReportPrincipals is S7.
type DocumentAccessReportPrincipals struct {
	GeneratedAt time.Time
	Principals  []DocumentAccessReportPrincipal
	Truncated   bool
}

func validatePrincipalsQuery(in DocumentAccessReportPrincipalsQuery) error {
	if utf8.RuneCountInString(in.Q) > 100 {
		return Invalid("q tối đa 100 ký tự")
	}
	switch in.Kind {
	case "", AccessReportKindMember, AccessReportKindHomeWorkspace, AccessReportKindOtherWorkspace,
		AccessReportKindOrganization, AccessReportKindLink:
	default:
		return Invalid("kind không hợp lệ")
	}
	switch in.Sort {
	case "", AccessReportSortCount, AccessReportSortName:
	default:
		return Invalid("sort không hợp lệ")
	}
	switch in.Order {
	case "", AccessReportOrderAsc, AccessReportOrderDesc:
	default:
		return Invalid("order không hợp lệ")
	}
	return validateAccessReportQuery(DocumentAccessReportQuery{Levels: in.Levels})
}

// mainSourcePrecedence breaks a tie of main_source (S7): direct, chat, link,
// workspace, owner, then break-glass.
var mainSourcePrecedence = []string{
	AccessReportSourceKeyDirect, AccessReportSourceKeyChat, AccessReportSourceKeyLink,
	AccessReportSourceKeyWorkspace, AccessReportSourceKeyOwner, AccessReportSourceKeyBreakGlass,
}

type principalAgg struct {
	DocumentAccessReportPrincipal
	sources map[string]int
}

// DocumentAccessReportPrincipals reads S7 inside one snapshot: one entry per
// principal that holds a row on a document the caller manages.
func (s *DocumentService) DocumentAccessReportPrincipals(ctx context.Context, actor Actor, workspaceID string, in DocumentAccessReportPrincipalsQuery) (DocumentAccessReportPrincipals, error) {
	var out DocumentAccessReportPrincipals
	if err := validatePrincipalsQuery(in); err != nil {
		return out, err
	}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return out, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	// The scan is the report's own: the folder and the level filter reach the
	// rows; q and kind are about the principal and apply below.
	run, err := s.openAccessReport(ctx, q, actor, workspaceID, DocumentAccessReportQuery{FolderID: in.FolderID, Levels: in.Levels})
	if err != nil {
		return out, err
	}
	aggs := map[string]*principalAgg{}
	out.Truncated, err = run.scan(ctx, accessReportExportPage, accessReportScanMaxDocs, func(results []arResult) error {
		for _, res := range results {
			if res.item == nil {
				continue
			}
			best := map[string]DocumentLevel{}
			for _, row := range res.item.Rows {
				key := row.PrincipalType + ":" + row.PrincipalID
				if row.PrincipalType == AccessReportSourceLink {
					key = AccessReportSourceLink + ":"
				}
				a := aggs[key]
				if a == nil {
					a = &principalAgg{
						DocumentAccessReportPrincipal: DocumentAccessReportPrincipal{
							PrincipalType: row.PrincipalType, PrincipalID: row.PrincipalID, PrincipalName: row.PrincipalName,
							Kind: principalKind(row, workspaceID), Levels: map[string]int{},
						},
						sources: map[string]int{},
					}
					if row.PrincipalType == AccessReportSourceLink {
						a.PrincipalID = ""
					}
					aggs[key] = a
				}
				a.sources[accessReportSourceKey(row)]++
				if lvl := DocumentLevel(row.Level); lvl.rank() > best[key].rank() {
					best[key] = lvl
				}
			}
			for key, lvl := range best {
				a := aggs[key]
				a.DocumentCount++
				a.Levels[string(lvl)]++
			}
		}
		return nil
	})
	if err != nil {
		return out, err
	}
	list := make([]*principalAgg, 0, len(aggs))
	qFold := foldForSearch(in.Q)
	for _, a := range aggs {
		if in.Kind != "" && a.Kind != in.Kind {
			continue
		}
		if qFold != "" && !strings.Contains(foldForSearch(a.PrincipalName), qFold) {
			continue
		}
		a.MainSource = mainSource(a.sources)
		list = append(list, a)
	}
	sortPrincipals(list, in.Sort, in.Order)
	if len(list) > accessReportPrincipalsMax {
		list, out.Truncated = list[:accessReportPrincipalsMax], true
	}
	if err := attachMemberCounts(ctx, q, run.scope.organizationID, list); err != nil {
		return out, err
	}
	out.Principals = make([]DocumentAccessReportPrincipal, len(list))
	for i, a := range list {
		out.Principals[i] = a.DocumentAccessReportPrincipal
	}
	out.GeneratedAt = s.now().UTC()
	return out, nil
}

func principalKind(row DocumentAccessReportRow, workspaceID string) string {
	switch row.PrincipalType {
	case DocumentPrincipalUser:
		return AccessReportKindMember
	case DocumentPrincipalWorkspace:
		if row.PrincipalID == workspaceID {
			return AccessReportKindHomeWorkspace
		}
		return AccessReportKindOtherWorkspace
	case DocumentPrincipalOrganization:
		return AccessReportKindOrganization
	case AccessReportSourceLink:
		return AccessReportKindLink
	}
	return row.PrincipalType
}

// mainSource is the source that appears on the most rows; a tie goes by
// mainSourcePrecedence.
func mainSource(counts map[string]int) string {
	best, bestN := "", 0
	for _, src := range mainSourcePrecedence {
		if n := counts[src]; n > bestN {
			best, bestN = src, n
		}
	}
	for src, n := range counts { // a source this build does not know yet
		if n > bestN {
			best, bestN = src, n
		}
	}
	return best
}

// sortPrincipals orders by document count (default, descending) or name
// (default ascending); ties fall to the name, then the id, so the table is
// stable between reads.
func sortPrincipals(list []*principalAgg, key, order string) {
	if key == "" {
		key = AccessReportSortCount
	}
	desc := key == AccessReportSortCount
	switch order {
	case AccessReportOrderAsc:
		desc = false
	case AccessReportOrderDesc:
		desc = true
	}
	byName := func(a, b *principalAgg) int {
		if c := strings.Compare(foldForSearch(a.PrincipalName), foldForSearch(b.PrincipalName)); c != 0 {
			return c
		}
		return strings.Compare(a.PrincipalType+":"+a.PrincipalID, b.PrincipalType+":"+b.PrincipalID)
	}
	sort.SliceStable(list, func(i, j int) bool {
		a, b := list[i], list[j]
		c := 0
		if key == AccessReportSortCount {
			c = a.DocumentCount - b.DocumentCount
		} else {
			c = byName(a, b)
		}
		switch {
		case c == 0:
			return byName(a, b) < 0
		case desc:
			return c > 0
		}
		return c < 0
	})
}

// attachMemberCounts fills member_count of the workspace principals and of the
// organization, inside the same snapshot.
func attachMemberCounts(ctx context.Context, q *db.Queries, organizationID string, list []*principalAgg) error {
	var wsIDs []string
	for _, a := range list {
		if a.PrincipalType == DocumentPrincipalWorkspace {
			wsIDs = append(wsIDs, a.PrincipalID)
		}
	}
	counts := map[string]int{}
	if len(wsIDs) > 0 {
		rows, err := q.CountDocumentAccessReportWorkspaceMembers(ctx, db.CountDocumentAccessReportWorkspaceMembersParams{
			OrganizationID: organizationID, WorkspaceIds: wsIDs,
		})
		if err != nil {
			return err
		}
		for _, r := range rows {
			counts[r.WorkspaceID] = int(r.N)
		}
	}
	for _, a := range list {
		switch a.PrincipalType {
		case DocumentPrincipalWorkspace:
			n := counts[a.PrincipalID]
			a.MemberCount = &n
		case DocumentPrincipalOrganization:
			total, err := q.CountOrganizationMembers(ctx, organizationID)
			if err != nil {
				return err
			}
			n := int(total)
			a.MemberCount = &n
		}
	}
	return nil
}
