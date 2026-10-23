package office

import (
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

const module = "github.com/unicomhub/uniwork/server/"

// ADR 0021 guard (G2-02): internal/office is the engine transport and nothing
// else. It reaches no database, storage, FileService or service tier, and
// only the service tier (plus the composition root) calls it, so the engine
// can never be driven around the authorization and job ledger in
// internal/service.
func TestOfficeTransportStaysALeaf(t *testing.T) {
	root := filepath.Join("..", "..")
	forbidden := []string{"internal/service", "internal/handler", "internal/files", "internal/storage", "pkg/db", "internal/audit"}
	seenOffice := false
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if path != root && (d.Name() == "vendor" || strings.HasPrefix(d.Name(), ".")) {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, ".go") {
			return nil
		}
		f, err := parser.ParseFile(token.NewFileSet(), path, nil, parser.ImportsOnly)
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(root, path)
		rel = filepath.ToSlash(rel)
		inOffice := strings.HasPrefix(rel, "internal/office/")
		seenOffice = seenOffice || inOffice
		for _, imp := range f.Imports {
			p, _ := strconv.Unquote(imp.Path.Value)
			if inOffice {
				for _, bad := range forbidden {
					if strings.HasPrefix(p, module+bad) {
						t.Errorf("%s imports %s: internal/office must stay a transport leaf", rel, p)
					}
				}
				continue
			}
			if p == module+"internal/office" && !strings.HasPrefix(rel, "internal/service/") && !strings.HasPrefix(rel, "cmd/server/") {
				t.Errorf("%s imports internal/office: only internal/service and cmd/server may reach the engine", rel)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if !seenOffice {
		t.Fatal("walk never reached internal/office: the guard is not looking at the tree")
	}
}
