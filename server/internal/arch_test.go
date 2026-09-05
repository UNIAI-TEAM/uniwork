package internal

// Layering rules from CLAUDE.md § Project Shape / § Backend ID Rules, pinned.
// Before this file they were prose: true on the day they were written and
// nothing stopped the next handler from opening a pool. `go list` sees the
// same import graph the compiler does, so a violation fails `make test-go`
// with the offending package named.

import (
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

const module = "github.com/unicomhub/uniwork/server/"

// directImports returns pkg -> direct (non-test) imports for every package.
func directImports(t *testing.T) map[string][]string {
	t.Helper()
	cmd := exec.Command("go", "list", "-f", "{{.ImportPath}} {{join .Imports \" \"}}", "./...")
	cmd.Dir = ".."
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("go list: %v", err)
	}
	graph := map[string][]string{}
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		f := strings.Fields(line)
		graph[strings.TrimPrefix(f[0], module)] = f[1:]
	}
	return graph
}

func TestLayering(t *testing.T) {
	graph := directImports(t)
	rules := []struct {
		from, forbidden, why string
	}{
		// Handlers hand ids to services and map results to SDOs. They may
		// import the generated row types; they may not hold a connection.
		{"internal/handler", "github.com/jackc/pgx/v5/pgxpool", "handlers never query the database"},
		{"internal/handler", module + "pkg/db/queries", "handlers never query the database"},
		{"internal/service", module + "internal/handler", "service → handler inverts the layers"},
		{"pkg/db", module + "internal", "pkg/db is the bottom layer"},
	}
	for pkg, imports := range graph {
		for _, r := range rules {
			if !strings.HasPrefix(pkg, r.from) {
				continue
			}
			for _, imp := range imports {
				if strings.HasPrefix(imp, r.forbidden) {
					t.Errorf("%s imports %s: %s", pkg, imp, r.why)
				}
			}
		}
	}
}

// Membership is decided in WorkspaceService.RequireMember and nowhere else
// (CLAUDE.md § Database and Migration Rules). The two sqlc queries that read
// workspace_members for a decision may only be called from that file.
func TestMembershipDecidedInOnePlace(t *testing.T) {
	decision := regexp.MustCompile(`\.(GetWorkspaceMember|GetWorkspaceAccess|GetWorkspaceAgentMember)\(`)
	err := filepath.WalkDir("..", func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return err
		}
		if strings.Contains(filepath.ToSlash(path), "pkg/db/generated") ||
			strings.HasSuffix(filepath.ToSlash(path), "internal/service/workspace.go") {
			return nil
		}
		src, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if decision.Match(src) {
			t.Errorf("%s reads workspace_members directly; go through WorkspaceService.RequireMember", path)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

// An actor's kind is decided by the service layer (ADR 0007). A handler only
// ever holds a signed-in person, so the only constructor it may call is
// service.Human; building an agent or system actor anywhere else would let a
// request claim to be an agent. Tests are exempt: they set up both kinds.
func TestActorConstructedOnlyInService(t *testing.T) {
	construct := regexp.MustCompile(`audit\.(Actor\{|System\(|KindAgent|KindSystem)`)
	err := filepath.WalkDir("..", func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return err
		}
		slash := filepath.ToSlash(path)
		if strings.Contains(slash, "internal/service/") || strings.Contains(slash, "internal/audit/") {
			return nil
		}
		src, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if construct.Match(src) {
			t.Errorf("%s constructs an actor kind directly; only internal/service decides who an actor is", path)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

// Audit rows and domain events are written in exactly one place. The rule
// "every command writes audit and outbox in the same transaction" (ADR 0009)
// is only worth stating if it cannot be worked around, and the way it gets
// worked around is a service reaching for the insert directly — at which point
// nothing decides the correlation id, the actor kind or the event version.
//
// internal/audit is the only caller; everything else goes through
// audit.Recorder.Record or, for infrastructure topics, Recorder.Emit.
func TestAuditAndOutboxWritesGoThroughTheAuditPackage(t *testing.T) {
	writes := regexp.MustCompile(`\.(InsertAuditEvent|InsertDomainOutboxEvent)\(`)
	err := filepath.WalkDir("..", func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return err
		}
		slash := filepath.ToSlash(path)
		if strings.Contains(slash, "pkg/db/generated") || strings.Contains(slash, "internal/audit/") {
			return nil
		}
		src, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if writes.Match(src) {
			t.Errorf("%s writes audit_events or outbox_events directly; go through internal/audit", path)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}
