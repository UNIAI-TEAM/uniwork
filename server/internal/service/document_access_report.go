package service

import "time"

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
}

// EffectiveAccessReportLimit clamps a requested page size (<= 0 or > 100 ->
// 50), exported so the handler can tell a full page without a second copy.
func EffectiveAccessReportLimit(limit int) int {
	if limit <= 0 || limit > 100 {
		return 50
	}
	return limit
}
