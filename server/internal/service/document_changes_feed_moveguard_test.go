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

// targetWorkspaceNames is the closed set of parameter/field names that name a
// workspace as a DESTINATION. A cross-workspace move is exactly "a workspace
// named as a target"; a workspace-naming parameter that is the document's own
// (workspaceID, the tenant a command acts inside) is not one - today's package
// has many of those and none is a cross-workspace move.
func targetWorkspaceNames() map[string]bool {
	return map[string]bool{
		"targetworkspaceid":    true,
		"toworkspaceid":        true,
		"destworkspaceid":      true,
		"destinationworkspace": true,
		"newworkspaceid":       true,
		"targetworkspace":      true,
	}
}

// isTargetWorkspaceName answers whether one workspace-naming identifier is a
// destination: its lower-cased name is in the closed set, or it contains
// "workspace" AND "target"/"dest".
func isTargetWorkspaceName(name string) bool {
	lower := strings.ToLower(name)
	if targetWorkspaceNames()[lower] {
		return true
	}
	return strings.Contains(lower, "workspace") &&
		(strings.Contains(lower, "target") || strings.Contains(lower, "dest"))
}

// moveMethodViolation answers the method name when fn is a DocumentService
// method that moves a document across workspaces, whatever the method's NAME:
//   - it takes a parameter that names a workspace as a TARGET
//     (RelocateDocument(ctx, actor, documentID, targetWorkspaceID string),
//     CopyDocumentToWorkspace(..., toWorkspaceID string));
//   - or its name says move/transfer AND also names a workspace/across;
//   - or its signature takes two or more distinct workspace-naming parameters
//     (a source and a target).
func moveMethodViolation(fn *ast.FuncDecl) string {
	if fn.Recv == nil || len(fn.Recv.List) != 1 {
		return ""
	}
	recv := receiverName(fn.Recv.List[0].Type)
	if !strings.Contains(recv, "DocumentService") {
		return ""
	}
	name := strings.ToLower(fn.Name.Name)
	seen := map[string]bool{}
	if fn.Type.Params != nil {
		for _, field := range fn.Type.Params.List {
			for _, id := range field.Names {
				lower := strings.ToLower(id.Name)
				if !strings.Contains(lower, "workspace") {
					continue
				}
				seen[lower] = true
				if isTargetWorkspaceName(id.Name) {
					return fn.Name.Name
				}
			}
		}
	}
	if (strings.Contains(name, "move") || strings.Contains(name, "transfer")) &&
		(strings.Contains(name, "workspace") || strings.Contains(name, "across")) {
		return fn.Name.Name
	}
	if len(seen) >= 2 {
		return fn.Name.Name
	}
	return ""
}

// moveInputViolation answers the type name when an *Input struct passed to a
// DocumentService method carries a workspace-naming field that is a TARGET: the
// sneaky half of a cross-workspace move (a destination workspace threaded
// through the input). The name filter is gone (BE-G2-3) - the field decides,
// not the struct's name - but a workspace field that is a source (the tenant a
// command acts inside, e.g. OfficeJobInput.WorkspaceID) is not a move.
func moveInputViolation(ts *ast.TypeSpec) string {
	if !strings.HasSuffix(ts.Name.Name, "Input") {
		return ""
	}
	st, ok := ts.Type.(*ast.StructType)
	if !ok {
		return ""
	}
	for _, field := range st.Fields.List {
		for _, id := range field.Names {
			if strings.Contains(strings.ToLower(id.Name), "workspace") && isTargetWorkspaceName(id.Name) {
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
// the detector flags dummy cross-workspace moves (so the guard would fail today
// if such a method were added), then runs it over every product file of this
// package and fails on any hit.
func TestDocumentChangesFeedCrossWorkspaceMoveGuard(t *testing.T) {
	const dummy = `package service

func (s *DocumentService) MoveDocumentToWorkspace(ctx context.Context, actor Actor, documentID, targetWorkspaceID string) {
}

func (s *DocumentService) RelocateDocument(ctx context.Context, actor Actor, documentID, targetWorkspaceID string) {
}

func (s *DocumentService) CopyDocumentToWorkspace(ctx context.Context, actor Actor, documentID, targetWorkspaceID string) {
}
`
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, "dummy.go", dummy, 0)
	if err != nil {
		t.Fatalf("parse the dummy methods: %v", err)
	}
	flagged := 0
	for _, decl := range file.Decls {
		if fn, ok := decl.(*ast.FuncDecl); ok && moveMethodViolation(fn) != "" {
			flagged++
		}
	}
	if flagged < 3 {
		t.Fatalf("the guard flags %d of 3 dummy cross-workspace moves; it cannot fail when the real one appears", flagged)
	}

	// The input-struct half: a workspace-naming field on any *Input struct.
	const dummyInput = `package service

type RelocateDocumentInput struct {
	TargetWorkspaceID string
}
`
	inFile, err := parser.ParseFile(token.NewFileSet(), "dummy_input.go", dummyInput, 0)
	if err != nil {
		t.Fatalf("parse the dummy input: %v", err)
	}
	inputFlagged := false
	for _, decl := range inFile.Decls {
		gd, ok := decl.(*ast.GenDecl)
		if !ok {
			continue
		}
		for _, spec := range gd.Specs {
			if ts, ok := spec.(*ast.TypeSpec); ok && moveInputViolation(ts) != "" {
				inputFlagged = true
			}
		}
	}
	if !inputFlagged {
		t.Fatal("the guard does not flag a dummy input struct with a workspace field; it cannot fail when the real one appears")
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
