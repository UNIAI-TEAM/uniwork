package service

import (
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/files"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Document kinds (C-01 §3.1; UNI-675): one table holds both shapes - a page
// keeps its working copy in content, a file points at a document_versions
// blob through file_version_id.
const (
	DocumentKindPage = "page"
	DocumentKindFile = "file"
)

// DocumentLevel is the permission ladder on a document (C-01 §4). Order is
// encoded by position: none < view < edit < manage.
type DocumentLevel string

const (
	DocumentLevelNone   DocumentLevel = ""
	DocumentLevelView   DocumentLevel = "view"
	DocumentLevelEdit   DocumentLevel = "edit"
	DocumentLevelManage DocumentLevel = "manage"
)

func (l DocumentLevel) rank() int {
	switch l {
	case DocumentLevelView:
		return 1
	case DocumentLevelEdit:
		return 2
	case DocumentLevelManage:
		return 3
	default:
		return 0
	}
}

// AtLeast reports whether l grants at least the level required.
func (l DocumentLevel) AtLeast(required DocumentLevel) bool {
	return l.rank() >= required.rank()
}

// DocumentVia names the access path the effective level came from (C-01
// §3.6): member, share, link, owner (§13 owner delegation) or ai_context.
type DocumentVia string

const (
	DocumentViaMember    DocumentVia = "member"
	DocumentViaShare     DocumentVia = "share"
	DocumentViaLink      DocumentVia = "link"
	DocumentViaOwner     DocumentVia = "owner"
	DocumentViaAIContext DocumentVia = "ai_context"
)

// DocumentService is the home of document commands. G1-01 brought the
// owned-create seam (§13/C-14) and the FileService reference providers;
// G1-02 the permission gate (document_permissions.go); the public business
// commands land with G1-03/G1-04.
type DocumentService struct {
	pool *pgxpool.Pool
	q    *db.Queries
	// The two membership gates: effectiveLevel decides membership only
	// through them (CLAUDE.md "Database and Migration Rules").
	orgs *OrganizationService
	ws   *WorkspaceService

	// files reads document bytes (proxy only, FS-C1); entitlements gates
	// public links; accessMetrics counts access-log writes that failed.
	files         files.Service
	entitlements  *EntitlementService
	accessMetrics DocumentAccessMetrics

	// ownerLevel resolves the caller's level through the owning work
	// product. nil means no owner service is wired: owned creates and
	// owner-delegated levels then fail closed (C-01 §13.8).
	ownerLevel    OwnerLevelResolver
	ownerLevelSet bool

	// store is the G1-03 write side's own state (document_files.go):
	// validation limits, spool directory, test seam.
	store documentStore
}

func NewDocumentService(pool *pgxpool.Pool, q *db.Queries, orgs *OrganizationService, ws *WorkspaceService) *DocumentService {
	return &DocumentService{pool: pool, q: q, orgs: orgs, ws: ws, accessMetrics: nopDocumentAccessMetrics{}}
}

// maxSearchContentRunes is the C-01 §3.7 search contract: the search column
// folds title + content_text[:20k].
const maxSearchContentRunes = 20000

// documentSearchText builds the folded search_text column. Both the create
// and update paths go through here so the column always matches what a
// search query term is folded with.
func documentSearchText(title, contentText string) string {
	runes := []rune(contentText)
	if len(runes) > maxSearchContentRunes {
		runes = runes[:maxSearchContentRunes]
	}
	return foldForSearch(title + " " + string(runes))
}
