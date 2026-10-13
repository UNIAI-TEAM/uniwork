package service

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

// The G5-01b residual guard (BE-G1-4, addendum B; rewritten for BE-G3-2).
//
// No command on this root moves a document ACROSS workspaces: MoveDocument is
// the tree move inside one workspace, so the change feed has no arrival upsert
// for the target workspace's feed. This DB-free test parses the package source
// and fails the moment a command that writes a document's workspace_id from a
// destination the CALLER named appears, pointing its author at the residual and
// the fix: implement the arrival upsert together with the new command. Handlers
// never query the database (CLAUDE.md Backend ID Rules), so a route can only
// move a document through a service method - scanning the service covers the
// route.
//
// The r2 guard matched destination SPELLINGS (targetWorkspaceID, toWorkspaceID,
// ...) and missed the ordinary shapes the fix contract names: workspaceID,
// toWorkspace, WorkspaceID on an Input. This version correlates a destination
// with an actual WRITE instead, so the name only has to look like a workspace
// and the body has to write one:
//
//   - a WRITE is a params literal of a registered document-workspace writer
//     (docWorkspaceWrites) whose destination field is set, or a raw SQL
//     statement that updates documents.workspace_id;
//   - a DESTINATION is caller input when the written value is a parameter of
//     the method or a field of one (in.WorkspaceID, toWorkspace); a value read
//     off a loaded row (locked.WorkspaceID, src.WorkspaceID) is the document's
//     OWN tenant and is not a destination - that is what keeps the real
//     CopyDocument (a copy into the source's own workspace) green;
//   - the method must also NAME a workspace: a parameter or a field of one of
//     its input structs.
//
// Today's package has no such command, so the scan stays green; the dummy
// snippets below prove each half of the detector can fail.

// crossWorkspaceMoveResidual is the message every failure carries.
const crossWorkspaceMoveResidual = "G5-01b residual: the change feed has no arrival upsert for cross-workspace moves - implement it with the new move command (packet-G5-01b BE-G1-4/BE-G3-2)"

// docWorkspaceWrite is one sqlc query that writes a document's workspace_id.
// paramsType is the params struct the query takes, destField the field that
// carries the destination workspace, and copyMarker - when set - a field the
// literal must also set for the write to be a copy of an existing document
// (InsertDocument creates a brand-new document otherwise, which is a create in
// its own workspace, never a cross-workspace move).
type docWorkspaceWrite struct {
	paramsType string
	destField  string
	copyMarker string
}

// docWorkspaceWrites is the closed set of sqlc queries that write a document's
// workspace_id, found by reading server/pkg/db/queries/*.sql (the guard's own
// SQL half, sqlQueriesWritingDocumentWorkspace, fails when a query writes
// documents.workspace_id and is missing here, so a new one cannot slip in
// unnoticed). Today the only writer is InsertDocument: no UPDATE documents
// statement sets workspace_id, and InsertDocument copies an existing document
// (SourceDocumentID) into a workspace.
var docWorkspaceWrites = map[string]docWorkspaceWrite{
	"InsertDocument": {paramsType: "InsertDocumentParams", destField: "WorkspaceID", copyMarker: "SourceDocumentID"},
}

// docWorkspaceWriteByParams indexes docWorkspaceWrites by the params struct a
// method body actually names in its composite literal.
var docWorkspaceWriteByParams = func() map[string]docWorkspaceWrite {
	out := make(map[string]docWorkspaceWrite, len(docWorkspaceWrites))
	for _, w := range docWorkspaceWrites {
		out[w.paramsType] = w
	}
	return out
}()

// documentWorkspaceWritesSQL matches a statement that writes a document's
// workspace_id: an UPDATE (or upsert) that SETs it, or an INSERT INTO documents
// that names the column. Either is a hand-written or newly added way to move a
// document between workspaces and must be registered in docWorkspaceWrites.
var documentWorkspaceWritesSQL = regexp.MustCompile(`(?is)(update\s+documents\b[^;]*\bset\b[^;]*\bworkspace_id\b|insert\s+into\s+documents\b[^;]*\bworkspace_id\b)`)

// isWorkspaceName answers whether one identifier names a workspace, whatever
// the spelling (workspaceID, toWorkspace, WorkspaceID, targetWorkspaceID,
// destWorkspace, ...).
func isWorkspaceName(name string) bool {
	return strings.Contains(strings.ToLower(name), "workspace")
}

// litTypeName answers the bare type name of a composite literal or a parameter
// type: db.InsertDocumentParams -> InsertDocumentParams, *Foo -> Foo.
func litTypeName(expr ast.Expr) string {
	switch t := expr.(type) {
	case *ast.Ident:
		return t.Name
	case *ast.SelectorExpr:
		return t.Sel.Name
	case *ast.StarExpr:
		return litTypeName(t.X)
	case *ast.ArrayType:
		return litTypeName(t.Elt)
	}
	return ""
}

// paramNames is the set of one method's parameter names, receiver excluded:
// the identifiers whose value came from the caller.
func paramNames(fn *ast.FuncDecl) map[string]bool {
	out := map[string]bool{}
	if fn.Type.Params == nil {
		return out
	}
	for _, field := range fn.Type.Params.List {
		for _, id := range field.Names {
			out[id.Name] = true
		}
	}
	return out
}

// workspaceDestinations collects, in one method body, every expression written
// into a document's workspace_id: the value of a registered writer's
// destination field (the params literal may be inline or in a variable), or a
// raw SQL statement that updates documents.workspace_id.
func workspaceDestinations(fn *ast.FuncDecl) []ast.Expr {
	if fn.Body == nil {
		return nil
	}
	var out []ast.Expr
	ast.Inspect(fn.Body, func(n ast.Node) bool {
		switch node := n.(type) {
		case *ast.CompositeLit:
			w, ok := docWorkspaceWriteByParams[litTypeName(node.Type)]
			if !ok {
				return true
			}
			fields := map[string]ast.Expr{}
			for _, el := range node.Elts {
				kv, ok := el.(*ast.KeyValueExpr)
				if !ok {
					continue
				}
				key, ok := kv.Key.(*ast.Ident)
				if !ok {
					continue
				}
				fields[key.Name] = kv.Value
			}
			if w.copyMarker != "" {
				if _, ok := fields[w.copyMarker]; !ok {
					// A plain create in its own workspace, not a copy.
					return true
				}
			}
			if v, ok := fields[w.destField]; ok {
				out = append(out, v)
			}
		case *ast.BasicLit:
			if node.Kind != token.STRING {
				return true
			}
			s, err := strconv.Unquote(node.Value)
			if err != nil {
				s = node.Value
			}
			if documentWorkspaceWritesSQL.MatchString(s) {
				out = append(out, node)
			}
		}
		return true
	})
	return out
}

// destinationIsCallerInput answers whether a value written into workspace_id
// came from the caller: a parameter of the method, or a field of one
// (in.WorkspaceID). Anything else - locked.WorkspaceID, src.WorkspaceID, a
// literal - is the document's own tenant read off a loaded row. A raw SQL
// statement has no visible value expression, so it counts as caller input
// (conservative: the method's own workspace-naming parameter decides).
func destinationIsCallerInput(v ast.Expr, params map[string]bool) bool {
	switch e := v.(type) {
	case *ast.Ident:
		return params[e.Name]
	case *ast.SelectorExpr:
		if id, ok := e.X.(*ast.Ident); ok {
			return params[id.Name]
		}
	case *ast.BasicLit:
		return true
	}
	return false
}

// methodWorkspaceName answers whether the method names a workspace at all: a
// parameter, or a field of one of its input structs (types indexes the
// package's struct types by name).
func methodWorkspaceName(fn *ast.FuncDecl, types map[string]*ast.StructType) bool {
	if fn.Type.Params == nil {
		return false
	}
	for _, field := range fn.Type.Params.List {
		for _, id := range field.Names {
			if isWorkspaceName(id.Name) {
				return true
			}
		}
		st, ok := types[litTypeName(field.Type)]
		if !ok {
			continue
		}
		for _, f := range st.Fields.List {
			for _, id := range f.Names {
				if isWorkspaceName(id.Name) {
					return true
				}
			}
		}
	}
	return false
}

// moveMethodViolation answers the method name when fn writes a document's
// workspace_id from a destination the caller named, whatever the method's name
// and whichever service type it belongs to (BE-G3-2: the receiver filter is
// gone - only the write decides).
func moveMethodViolation(fn *ast.FuncDecl, types map[string]*ast.StructType) string {
	if !methodWorkspaceName(fn, types) {
		return ""
	}
	params := paramNames(fn)
	for _, dest := range workspaceDestinations(fn) {
		if destinationIsCallerInput(dest, params) {
			return fn.Name.Name
		}
	}
	return ""
}

// structWorkspaceFields is the type index the method scan needs: every struct
// type in the package by bare name.
func structWorkspaceFields(files []*ast.File) map[string]*ast.StructType {
	out := map[string]*ast.StructType{}
	for _, file := range files {
		for _, decl := range file.Decls {
			gd, ok := decl.(*ast.GenDecl)
			if !ok || gd.Tok != token.TYPE {
				continue
			}
			for _, spec := range gd.Specs {
				ts, ok := spec.(*ast.TypeSpec)
				if !ok {
					continue
				}
				if st, ok := ts.Type.(*ast.StructType); ok {
					out[ts.Name.Name] = st
				}
			}
		}
	}
	return out
}

// packageFiles parses every non-test .go file of this package, one file set
// shared with the returned file names.
func packageFiles(t *testing.T) ([]*ast.File, []string) {
	t.Helper()
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatalf("read the package dir: %v", err)
	}
	fset := token.NewFileSet()
	var files []*ast.File
	var names []string
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		parsed, err := parser.ParseFile(fset, name, nil, 0)
		if err != nil {
			t.Fatalf("parse %s: %v", name, err)
		}
		files = append(files, parsed)
		names = append(names, name)
	}
	return files, names
}

// sqlQueriesWritingDocumentWorkspace reads the sqlc query files and returns the
// name of every query whose statement writes documents.workspace_id. Each must
// be registered in docWorkspaceWrites, or the guard fails: a new way to write a
// document's workspace_id cannot pass unnoticed.
func sqlQueriesWritingDocumentWorkspace(t *testing.T) []string {
	t.Helper()
	dir := filepath.Join("..", "..", "pkg", "db", "queries")
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("read the sqlc query dir %s: %v", dir, err)
	}
	var out []string
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}
		body, err := os.ReadFile(filepath.Join(dir, entry.Name()))
		if err != nil {
			t.Fatalf("read %s: %v", entry.Name(), err)
		}
		name := ""
		for _, line := range strings.Split(string(body), "\n") {
			if strings.HasPrefix(line, "-- name: ") {
				name = strings.TrimSpace(strings.TrimPrefix(line, "-- name: "))
				if i := strings.Index(name, " "); i >= 0 {
					name = name[:i]
				}
				continue
			}
			if name != "" && documentWorkspaceWritesSQL.MatchString(line) {
				out = append(out, name)
			}
		}
	}
	return out
}

// TestDocumentChangesFeedCrossWorkspaceMoveGuard is the guard. It first proves
// every half of the detector flags a dummy cross-workspace command and leaves a
// tenant-only one alone, then runs it over every product file of this package
// and over the sqlc query files.
func TestDocumentChangesFeedCrossWorkspaceMoveGuard(t *testing.T) {
	const dummy = `package service

type CopyDocumentInput struct {
	WorkspaceID string
}

type RelocateDocumentInput struct {
	Title string
}

// Flagged: an ordinary workspaceID parameter and a raw SQL workspace write.
func (s *DocumentService) RelocateDocument(ctx context.Context, actor Actor, documentID, workspaceID string) error {
	_, err := s.pool.Exec(ctx, "UPDATE documents SET workspace_id = $2 WHERE id = $1", documentID, workspaceID)
	return err
}

// Flagged: a toWorkspace parameter and a copying insert into it.
func (s *DocumentService) CopyDocument(ctx context.Context, actor Actor, documentID, toWorkspace string) error {
	_, err := s.q.InsertDocument(ctx, db.InsertDocumentParams{ID: documentID, WorkspaceID: toWorkspace, SourceDocumentID: pgtype.Text{Valid: true}})
	return err
}

// Flagged: the destination rides on an Input struct field.
func (s *DocumentService) RelocateDocumentInput(ctx context.Context, actor Actor, documentID string, in CopyDocumentInput) error {
	_, err := s.q.InsertDocument(ctx, db.InsertDocumentParams{ID: documentID, WorkspaceID: in.WorkspaceID, SourceDocumentID: pgtype.Text{Valid: true}})
	return err
}

// Not flagged: names a workspace but writes none (a tenant-only read).
func (s *DocumentService) ListDocuments(ctx context.Context, actor Actor, workspaceID string) error {
	_, err := s.q.ListDocumentsForChangeFeed(ctx, db.ListDocumentsForChangeFeedParams{WorkspaceID: workspaceID})
	return err
}

// Not flagged: names a workspace and inserts, but a plain create (no copy
// marker) - the document is new in its own workspace.
func (s *DocumentService) CreateFileDocument(ctx context.Context, actor Actor, workspaceID string) error {
	_, err := s.q.InsertDocument(ctx, db.InsertDocumentParams{WorkspaceID: workspaceID})
	return err
}

// Not flagged: an Input naming a workspace with a plain create too.
func (s *DocumentService) CreateOwnedDocumentInTx(ctx context.Context, actor Actor, in CopyDocumentInput) error {
	_, err := s.q.InsertDocument(ctx, db.InsertDocumentParams{WorkspaceID: in.WorkspaceID})
	return err
}

// Not flagged: a copy into the document's OWN workspace read off a loaded row.
func (s *DocumentService) CopyWithinWorkspace(ctx context.Context, actor Actor, documentID string) error {
	locked, err := s.q.GetDocumentByID(ctx, documentID)
	if err != nil {
		return err
	}
	_, err = s.q.InsertDocument(ctx, db.InsertDocumentParams{ID: documentID, WorkspaceID: locked.WorkspaceID, SourceDocumentID: pgtype.Text{Valid: true}})
	return err
}
`
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, "dummy.go", dummy, 0)
	if err != nil {
		t.Fatalf("parse the dummy methods: %v", err)
	}
	types := structWorkspaceFields([]*ast.File{file})
	flagged := map[string]bool{}
	for _, decl := range file.Decls {
		if fn, ok := decl.(*ast.FuncDecl); ok && moveMethodViolation(fn, types) != "" {
			flagged[fn.Name.Name] = true
		}
	}
	for _, want := range []string{"RelocateDocument", "CopyDocument", "RelocateDocumentInput"} {
		if !flagged[want] {
			t.Fatalf("the guard does not flag the dummy cross-workspace command %s; it cannot fail when the real one appears", want)
		}
	}
	for _, notWant := range []string{"ListDocuments", "CreateFileDocument", "CreateOwnedDocumentInTx", "CopyWithinWorkspace"} {
		if flagged[notWant] {
			t.Fatalf("the guard flags %s, which writes no document workspace_id from a caller destination (a tenant-only or own-workspace command)", notWant)
		}
	}

	// The SQL half: a query that writes documents.workspace_id must be
	// registered, so a new one cannot slip past the body scan.
	for _, name := range sqlQueriesWritingDocumentWorkspace(t) {
		if _, ok := docWorkspaceWrites[name]; !ok {
			t.Fatalf("sqlc query %s writes documents.workspace_id but is not registered in docWorkspaceWrites: %s", name, crossWorkspaceMoveResidual)
		}
	}

	// The real package: every method of every service type.
	files, names := packageFiles(t)
	pkgTypes := structWorkspaceFields(files)
	for i, parsed := range files {
		name := names[i]
		for _, decl := range parsed.Decls {
			fn, ok := decl.(*ast.FuncDecl)
			if !ok {
				continue
			}
			if method := moveMethodViolation(fn, pkgTypes); method != "" {
				t.Fatalf("%s: %s %s", name, method, crossWorkspaceMoveResidual)
			}
		}
	}
}
