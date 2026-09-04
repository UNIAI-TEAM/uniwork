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
	decision := regexp.MustCompile(`\.(GetWorkspaceMember|GetWorkspaceAccess)\(`)
	err := filepath.WalkDir("..", func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return err
		}
		if strings.Contains(path, "pkg/db/generated") || strings.HasSuffix(path, "internal/service/workspace.go") {
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
