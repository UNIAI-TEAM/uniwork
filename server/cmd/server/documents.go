package main

import (
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// documentServiceOptions is every dependency the process's one DocumentService
// is built from.
type documentServiceOptions struct {
	Pool          *pgxpool.Pool
	Queries       *db.Queries
	Organizations *service.OrganizationService
	Workspaces    *service.WorkspaceService
	// Files is the concrete *service.FileService rather than files.Service:
	// only internal/service may import internal/files
	// (arch_test.go TestFilesContractIsALeafCalledOnlyFromTheServiceTier).
	// Nil means no file store is wired, as the assembly test needs.
	Files         *service.FileService
	Flags         service.DocumentFlags
	Metrics       service.DocumentMetrics
	IntentMetrics service.OfficeIntentMetrics
	Policy        service.CommitIntentPolicy
}

// newDocumentService builds the process's one DocumentService (BE-I4-1). The
// HTTP document routes, the preview broker, the office change feed, the
// notification reads, office commands and launch, and the document workers
// all receive this instance, so the office_sync_write evaluator, the
// DOCUMENT_COMMIT_INTENT_* policy (G5-07) and the save/intent counters are
// live on every path. A second construction leaves them inert on whichever
// instance the routes get.
func newDocumentService(o documentServiceOptions) *service.DocumentService {
	svc := service.NewDocumentService(o.Pool, o.Queries, o.Organizations, o.Workspaces)
	if o.Files != nil {
		svc.SetFiles(o.Files)
	}
	svc.SetEntitlements(service.NewEntitlementService(o.Pool, o.Queries))
	// SetMetrics and SetIntentMetrics read nil as "no sink" (the nop
	// counters), so a process without METRICS_ADDR passes nil.
	svc.SetMetrics(o.Metrics)
	svc.SetIntentMetrics(o.IntentMetrics)
	svc.SetCommitIntentPolicy(o.Policy)
	svc.SetFlags(o.Flags)
	return svc
}
