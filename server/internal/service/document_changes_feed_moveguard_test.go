package service

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"strings"
	"testing"
)

// The G5-01b residual guard (BE-G1-4, addendum B). No command on this root
// moves a document ACROSS workspaces: MoveDocument is the tree move inside one
// workspace, so the change feed has no arrival upsert for the target
// workspace's feed. This DB-free test parses the package source and fails the
// moment a DocumentService method (or a Move*Input type) that moves a document
// between workspaces appears, pointing its author at the residual and the fix:
// implement the arrival upsert together with the new command. Handlers never
// query the database (CLAUDE.md Backend ID Rules), so a route can only move a
// document through a service method - scanning the service covers the route.

// crossWorkspaceMoveResidual is the message every failure carries.
const crossWorkspaceMoveResidual = "G5-01b residual: the change feed has no arrival upsert for cross-workspace moves - implement it with the new move command (packet-G5-01b BE-G1-4)"

// moveMethodViolation answers the method name when fn is a DocumentService
// method that moves a document across workspaces: its name says move AND
// workspace/across, or its signature takes two or more distinct
// workspace-naming parameters (a source and a target).
func moveMethodViolation(fn *ast.FuncDecl) string {
	if fn.Recv == nil || len(fn.Recv.List) != 1 {
		return ""
	}
	recv := receiverName(fn.Recv.List[0].Type)
	if !strings.Contains(recv, "DocumentService") {
		return ""
	}
	name := strings.ToLower(fn.Name.Name)
	if !strings.Contains(name, "move") && !strings.Contains(name, "transfer") {
		return ""
	}
	if strings.Contains(name, "workspace") || strings.Contains(name, "across") {
		return fn.Name.Name
	}
	seen := map[string]bool{}
	count := 0
	if fn.Type.Params != nil {
		for _, field := range fn.Type.Params.List {
			for _, id := range field.Names {
				lower := strings.ToLower(id.Name)
				if strings.Contains(lower, "workspace") && !seen[lower] {
					seen[lower] = true
					count++
				}
			}
		}
	}
	if count >= 2 {
		return fn.Name.Name
	}
	return ""
}

// moveInputViolation answers the type name when a Move*/Transfer* input struct
// carries a workspace-naming field: the sneaky half of a cross-workspace move
// (a target workspace threaded through the existing command's input).
func moveInputViolation(ts *ast.TypeSpec) string {
	name := strings.ToLower(ts.Name.Name)
	if !strings.Contains(name, "move") && !strings.Contains(name, "transfer") {
		return ""
	}
	st, ok := ts.Type.(*ast.StructType)
	if !ok {
		return ""
	}
	for _, field := range st.Fields.List {
		for _, id := range field.Names {
			if strings.Contains(strings.ToLower(id.Name), "workspace") {
				return ts.Name.Name
			}
		}
	}
	return ""
}

func receiverName(expr ast.Expr) string {
	switch t := expr.(type) {
	case *ast.Ident:
		return t.Name
	case *ast.StarExpr:
		return receiverName(t.X)
	}
	return ""
}

// TestDocumentChangesFeedCrossWorkspaceMoveGuard is the guard. It first proves
// the detector flags a dummy cross-workspace move method (so the guard would
// fail today if such a method were added), then runs it over every product
// file of this package and fails on any hit.
func TestDocumentChangesFeedCrossWorkspaceMoveGuard(t *testing.T) {
	const dummy = `package service

func (s *DocumentService) MoveDocumentToWorkspace(ctx context.Context, actor Actor, documentID, targetWorkspaceID string) {
}
`
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, "dummy.go", dummy, 0)
	if err != nil {
		t.Fatalf("parse the dummy method: %v", err)
	}
	flagged := false
	for _, decl := range file.Decls {
		if fn, ok := decl.(*ast.FuncDecl); ok && moveMethodViolation(fn) != "" {
			flagged = true
		}
	}
	if !flagged {
		t.Fatal("the guard does not flag a dummy cross-workspace move method; it cannot fail when the real one appears")
	}

	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatalf("read the package dir: %v", err)
	}
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		fset := token.NewFileSet()
		parsed, err := parser.ParseFile(fset, name, nil, 0)
		if err != nil {
			t.Fatalf("parse %s: %v", name, err)
		}
		for _, decl := range parsed.Decls {
			switch d := decl.(type) {
			case *ast.FuncDecl:
				if method := moveMethodViolation(d); method != "" {
					t.Fatalf("%s: %s %s", name, method, crossWorkspaceMoveResidual)
				}
			case *ast.GenDecl:
				for _, spec := range d.Specs {
					ts, ok := spec.(*ast.TypeSpec)
					if !ok {
						continue
					}
					if typeName := moveInputViolation(ts); typeName != "" {
						t.Fatalf("%s: %s %s", name, typeName, crossWorkspaceMoveResidual)
					}
				}
			}
		}
	}
}
