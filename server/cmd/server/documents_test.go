package main

import (
	"context"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/service"
)

// stubDocumentFlags stands in for the /api/v1/config evaluator. Nothing on a
// database-free path asks it anything, so it only has to be identifiable.
type stubDocumentFlags struct{}

func (*stubDocumentFlags) IsEnabled(context.Context, string, bool) bool { return true }

// stubDocumentMetrics counts the save outcomes the service records; the count
// is what proves SetMetrics reached the instance.
type stubDocumentMetrics struct{ saves int }

func (*stubDocumentMetrics) IncDocumentAccessLogFailed()                        {}
func (*stubDocumentMetrics) IncDocumentVersionsProtectedOverflow()              {}
func (m *stubDocumentMetrics) ObserveDocumentSave(string, string, float64)      { m.saves++ }
func (*stubDocumentMetrics) IncDocumentConflict(string, string)                 {}
func (*stubDocumentMetrics) IncDocumentQuotaRejected(string)                    {}
func (*stubDocumentMetrics) ObserveDocumentWorkerSweep(string, string, float64) {}
func (*stubDocumentMetrics) AddDocumentWorkerRowsFailed(string, int)            {}

// stubOfficeIntentMetrics stands in for reg.Office's intent counters.
type stubOfficeIntentMetrics struct{}

func (*stubOfficeIntentMetrics) IncOfficeIntentLookup(string)    {}
func (*stubOfficeIntentMetrics) IncOfficeIdempotentReplay()      {}
func (*stubOfficeIntentMetrics) AddOfficeCommitIntentsSwept(int) {}

// TestNewDocumentServiceWiresIntentPolicyFlagsAndCounters pins the G5-07 stack
// on the instance newDocumentService returns - the instance main.go hands to
// the HTTP routes, the preview broker, the change feed and the notification
// reads. The BE-I4-1 route instance carried none of the three.
func TestNewDocumentServiceWiresIntentPolicyFlagsAndCounters(t *testing.T) {
	flags := &stubDocumentFlags{}
	intentMetrics := &stubOfficeIntentMetrics{}
	policy := service.CommitIntentPolicy{ClaimTTL: 13 * time.Minute, Retention: 72 * time.Hour}

	svc := newDocumentService(documentServiceOptions{
		Flags: flags, IntentMetrics: intentMetrics, Policy: policy,
	})

	wiring := svc.IntentWiringForTest()
	if wiring.Policy != policy {
		t.Errorf("commit intent policy = %+v, want %+v; without it the route commits claim with the default TTL and resume window", wiring.Policy, policy)
	}
	if wiring.Flags != flags {
		t.Errorf("flag evaluator = %#v, want the evaluator main.go passes in; without it office_sync_write never reaches the routes", wiring.Flags)
	}
	if wiring.IntentMetrics != intentMetrics {
		t.Errorf("intent counters = %#v, want the counters main.go passes in; without them route lookups and replays stay silent", wiring.IntentMetrics)
	}
}

// TestNewDocumentServiceRecordsRouteSaves pins the ordinary document counters
// (G1-09) on the same instance: a commit on the route path records its
// outcome. With no file store wired the commit stops before any database
// work, so the test needs no Postgres.
func TestNewDocumentServiceRecordsRouteSaves(t *testing.T) {
	metrics := &stubDocumentMetrics{}
	svc := newDocumentService(documentServiceOptions{Metrics: metrics})

	if _, err := svc.CommitFileVersion(context.Background(), service.Human("user-1"), "doc-1", service.CommitFileVersionInput{}); err == nil {
		t.Fatal("expected the commit to fail without a file store")
	}
	if metrics.saves != 1 {
		t.Fatalf("recorded %d save outcomes, want 1; SetMetrics did not reach the instance the routes receive", metrics.saves)
	}
}

// TestProcessBuildsOneDocumentService is the BE-I4-1 guard. Package main must
// construct a DocumentService exactly once, inside newDocumentService, and
// call that builder exactly once, so every consumer - the HTTP routes
// included - shares the one configured instance. The old wiring constructed
// two and the routes got the one without the G5-07 setters, which fails the
// counts below.
func TestProcessBuildsOneDocumentService(t *testing.T) {
	fset := token.NewFileSet()
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}
	constructed, inBuilder, built := 0, 0, 0
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		file, err := parser.ParseFile(fset, name, nil, 0)
		if err != nil {
			t.Fatalf("parse %s: %v", name, err)
		}
		for _, decl := range file.Decls {
			fn, ok := decl.(*ast.FuncDecl)
			if !ok || fn.Body == nil {
				continue
			}
			ast.Inspect(fn.Body, func(n ast.Node) bool {
				call, ok := n.(*ast.CallExpr)
				if !ok {
					return true
				}
				switch fun := call.Fun.(type) {
				case *ast.SelectorExpr:
					if fun.Sel.Name == "NewDocumentService" {
						constructed++
						if fn.Name.Name == "newDocumentService" {
							inBuilder++
						}
					}
				case *ast.Ident:
					if fun.Name == "newDocumentService" {
						built++
					}
				}
				return true
			})
		}
	}
	if constructed != 1 || inBuilder != 1 {
		t.Fatalf("package main constructs a DocumentService %d times (%d inside newDocumentService); it must build exactly one there, or the routes can get an instance without the G5-07 wiring", constructed, inBuilder)
	}
	if built != 1 {
		t.Fatalf("newDocumentService is called %d times; the process must build its one DocumentService once", built)
	}
}
