package service

import (
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/files"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Document kinds (C-01 §3.1; UNI-675): one table holds every shape - a page
// keeps its working copy in content, a file points at a document_versions
// blob through file_version_id, and a folder (UNI-1305) only holds children: no
// content, no versions, no bytes.
const (
	DocumentKindPage   = "page"
	DocumentKindFile   = "file"
	DocumentKindFolder = "folder"
)

// errFolderUnsupported answers a content, version, byte or Office route on a
// folder: the folder exists and the caller may see it, it just has nothing
// those routes act on.
func errFolderUnsupported() error {
	return coded(http.StatusUnprocessableEntity, "folder_not_supported", "thư mục không có nội dung, phiên bản hay tệp")
}

// refuseFolder is the guard those routes call once the caller is authorized.
func refuseFolder(doc db.Document) error {
	if doc.Kind == DocumentKindFolder {
		return errFolderUnsupported()
	}
	return nil
}

// childKindAllowed is the containment rule: a folder sits at the root or in a
// folder; a page or a file sits in a page or a folder.
func childKindAllowed(parentKind, childKind string) bool {
	if childKind == DocumentKindFolder {
		return parentKind == DocumentKindFolder
	}
	return parentKind == DocumentKindPage || parentKind == DocumentKindFolder
}

func errDocumentParentKind() error {
	return coded(http.StatusUnprocessableEntity, "document_parent_kind", "thư mục chỉ nằm ở gốc hoặc trong thư mục khác; trang và tệp nằm trong trang hoặc thư mục")
}

// DocumentLevel is the permission ladder on a document (C-01 §4, G8-18). Order
// is encoded by position: none < view < comment < edit < manage.
type DocumentLevel string

const (
	DocumentLevelNone    DocumentLevel = ""
	DocumentLevelView    DocumentLevel = "view"
	DocumentLevelComment DocumentLevel = "comment"
	DocumentLevelEdit    DocumentLevel = "edit"
	DocumentLevelManage  DocumentLevel = "manage"
)

func (l DocumentLevel) rank() int {
	switch l {
	case DocumentLevelView:
		return 1
	case DocumentLevelComment:
		return 2
	case DocumentLevelEdit:
		return 3
	case DocumentLevelManage:
		return 4
	default:
		return 0
	}
}

// AtLeast reports whether l grants at least the level required.
func (l DocumentLevel) AtLeast(required DocumentLevel) bool {
	return l.rank() >= required.rank()
}

// DocumentVia names the access path the effective level came from (C-01
// §3.6, DOC-05): member, share, link, owner (§13 owner delegation),
// ai_context or break_glass.
type DocumentVia string

const (
	DocumentViaMember     DocumentVia = "member"
	DocumentViaShare      DocumentVia = "share"
	DocumentViaLink       DocumentVia = "link"
	DocumentViaOwner      DocumentVia = "owner"
	DocumentViaAIContext  DocumentVia = "ai_context"
	DocumentViaBreakGlass DocumentVia = "break_glass"
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
	// public links; metrics carries the operational counters (save
	// outcomes, conflicts, quota rejects, worker sweeps, access-log
	// failures).
	files        files.Service
	entitlements *EntitlementService
	metrics      DocumentMetrics

	// ownerLevel resolves the caller's level through the owning work
	// product. nil means no owner service is wired: owned creates and
	// owner-delegated levels then fail closed (C-01 §13.8). ownerPurger is
	// the §13.6 retention delegate the purge sweep calls first.
	ownerLevel    OwnerLevelResolver
	ownerLevelSet bool
	ownerPurger   DocumentOwnerPurger

	// archiveMaxNodes overrides documentArchiveMaxNodes; tests set it so the
	// bound needs a handful of rows, not a thousand. Zero means the default.
	archiveMaxNodes int

	// titleWriteErr is the savepoint-retry test seam (document_names.go): a
	// test makes one title write attempt fail exactly as the folder-name
	// index of PR 2 will, since until that index exists nothing else can.
	titleWriteErr func(attempt int) error

	// clock is the service's time source; tests inject it so the retention
	// and auto-version workers never wait for real time.
	clock func() time.Time

	// intentPolicy, flags and intentMetrics belong to the logical commit
	// intents of G5-07 (document_commit_intent.go): the claim TTL and resume
	// window, the office_sync_write evaluator, and the lookup/replay/sweep
	// counters. Zero values keep the defaults; nil flags read the registry
	// default.
	intentPolicy  CommitIntentPolicy
	flags         DocumentFlags
	intentMetrics OfficeIntentMetrics

	// store is the G1-03 write side's own state (document_files.go):
	// validation limits, spool directory, test seam.
	store documentStore

	// editLock is the edit lock timing (UNI-1645, document_edit_lock.go);
	// zero fields read as the addendum §7 defaults.
	editLock DocumentEditLockConfig
}

func NewDocumentService(pool *pgxpool.Pool, q *db.Queries, orgs *OrganizationService, ws *WorkspaceService) *DocumentService {
	return &DocumentService{pool: pool, q: q, orgs: orgs, ws: ws, metrics: nopDocumentMetrics{}, clock: time.Now}
}

// SetClock injects the time source (tests); nil resets to the wall clock.
func (s *DocumentService) SetClock(now func() time.Time) {
	if now == nil {
		now = time.Now
	}
	s.clock = now
}

// now is the one place document code reads the time.
func (s *DocumentService) now() time.Time { return s.clock() }

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
