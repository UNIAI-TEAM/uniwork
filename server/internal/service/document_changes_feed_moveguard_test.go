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
//     statement that updates documents.workspace_id (matched over the WHOLE
//     statement, never a line, so the repo's own multi-line layout is seen -
//     BE-G4-2);
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

// The SQL half of the write detector. A statement writes a document's
// workspace_id when an UPDATE documents assigns it in its SET clause, or an
// INSERT INTO documents names workspace_id anywhere - its column list, an
// INSERT ... SELECT that projects or filters the column, or an ON CONFLICT
// ... DO UPDATE SET workspace_id (the upsert spelling of the same). Either is a
// hand-written or newly added way to move a document between workspaces and
// must be registered in docWorkspaceWrites.
//
// The match runs over a WHOLE statement, never a line (BE-G4-2): the repo lays
// its queries out with UPDATE documents on one line and SET workspace_id = ...
// on the next, so a line-at-a-time scan silently misses exactly the write this
// guard exists to catch. Go's regexp is RE2 (no lookahead), so "the assignment
// before WHERE" is decided by scanning, not by one pattern.
var (
	// updateDocuments finds the start of an UPDATE of the documents table.
	updateDocuments = regexp.MustCompile(`(?i)\bupdate\s+documents\b`)
	// setClause and whereClause bound the assignments: workspace_id must be
	// assigned before the statement's top-level WHERE (a WHERE workspace_id =
	// ... is a tenant filter, not a write; a WHERE inside a SET subquery does
	// not end the region - BE-G6-1, topLevelWhereIndex).
	setClause   = regexp.MustCompile(`(?i)\bset\b`)
	whereClause = regexp.MustCompile(`(?i)\bwhere\b`)
	// workspaceAssignment is the write itself.
	workspaceAssignment = regexp.MustCompile(`(?i)\bworkspace_id\s*=`)
	// insertDocuments finds an INSERT INTO documents statement (unanchored, as
	// the r4 regex was, so a leading CTE does not hide it). The schema
	// qualifier is optional: `insert into public.documents` is the same write
	// (BE-G6-2).
	insertDocuments = regexp.MustCompile(`(?i)\binsert\s+into\s+(?:\w+\.)?documents\b`)
	// workspaceColumn is the workspace_id column named anywhere in a statement.
	workspaceColumn = regexp.MustCompile(`(?i)\bworkspace_id\b`)
)

// topLevelWhereIndex returns the offset of the first `where` keyword at
// parenthesis depth 0, or -1. A SET assignment may carry its own subquery with
// a WHERE (`SET title = (SELECT ... WHERE ...), workspace_id = ...`), and only
// the statement's own WHERE ends the assignment region (BE-G6-1): bounding at
// the first `where` token would stop before the workspace_id assignment and let
// that spelling through.
//
// Single-quoted string contents are skipped, including doubled-quote escapes
// (R2-D-1): a literal parenthesis is not SQL nesting (`SET title = '('`), and a
// literal `where` is not the statement's WHERE.
func topLevelWhereIndex(body string) int {
	matches := whereClause.FindAllStringIndex(body, -1)
	if len(matches) == 0 {
		return -1
	}
	depth, next, quoted := 0, 0, false
	for i := range len(body) {
		// Drop a match that started inside a string literal so it cannot stall
		// the scan in front of the real WHERE.
		for next < len(matches) && matches[next][0] < i {
			next++
		}
		c := body[i]
		if quoted {
			if c == '\'' {
				if i+1 < len(body) && body[i+1] == '\'' {
					i++ // a doubled quote is an escape, not the closing quote
				} else {
					quoted = false
				}
			}
			continue
		}
		if next < len(matches) && matches[next][0] == i {
			if depth == 0 {
				return i
			}
			next++
		}
		switch c {
		case '\'':
			quoted = true
		case '(':
			depth++
		case ')':
			if depth > 0 {
				depth--
			}
		}
	}
	return -1
}

// writesDocumentWorkspace answers whether one normalized SQL statement writes a
// document's workspace_id.
func writesDocumentWorkspace(stmt string) bool {
	if loc := updateDocuments.FindStringIndex(stmt); loc != nil {
		rest := stmt[loc[1]:]
		if set := setClause.FindStringIndex(rest); set != nil {
			body := rest[set[1]:]
			if w := topLevelWhereIndex(body); w >= 0 {
				body = body[:w]
			}
			if workspaceAssignment.MatchString(body) {
				return true
			}
		}
	}
	// The INSERT leg is deliberately fail-closed: any INSERT INTO documents
	// that names workspace_id at all is treated as a write of it, whatever the
	// spelling - the column list, an INSERT ... SELECT that projects or filters
	// the column, or an ON CONFLICT ... DO UPDATE SET workspace_id (the upsert
	// spelling). The r4 regex had this reach and the column-list-only match lost
	// it (BE-G5-1): a false positive only asks the author to register the query
	// in docWorkspaceWrites, while a miss lets a workspace write through.
	return insertDocuments.MatchString(stmt) && workspaceColumn.MatchString(stmt)
}

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
			if writesDocumentWorkspace(s) {
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
//
// A query is matched STATEMENT by STATEMENT, never line by line (BE-G4-2): the
// file is split on its `-- name:` blocks and each block's SQL is joined into one
// whitespace-collapsed string, so a write the repo lays out with
// `UPDATE documents` and `SET workspace_id = ...` on separate lines is seen.
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
		for _, q := range sqlcQueries(string(body)) {
			if writesDocumentWorkspace(q.statement) {
				out = append(out, q.name)
			}
		}
	}
	return out
}

// sqlcQuery is one `-- name: X :one` block of a query file: its name and its
// statement, with the block's lines joined and every run of whitespace
// collapsed to one space so the write test reads the whole statement.
type sqlcQuery struct {
	name      string
	statement string
}

// sqlcQueries splits one query file into its `-- name:` blocks. Comment lines
// (a leading `--`) are dropped and the SQL lines are joined; a statement spread
// over several lines therefore reads as one string. A file's leading comment
// block, before the first `-- name:`, is skipped.
func sqlcQueries(body string) []sqlcQuery {
	var out []sqlcQuery
	var name string
	var lines []string
	flush := func() {
		if name == "" {
			return
		}
		out = append(out, sqlcQuery{name: name, statement: strings.Join(strings.Fields(strings.Join(lines, " ")), " ")})
	}
	for _, line := range strings.Split(body, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "-- name: ") {
			flush()
			name = strings.TrimSpace(strings.TrimPrefix(trimmed, "-- name: "))
			if i := strings.Index(name, " "); i >= 0 {
				name = name[:i]
			}
			lines = nil
			continue
		}
		if name == "" || strings.HasPrefix(trimmed, "--") {
			continue
		}
		lines = append(lines, trimmed)
	}
	flush()
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

	// The SQL half's detector, self-checked on parsed statements (BE-G4-2): the
	// multi-line layout the repo itself uses must be flagged, and a tenant-only
	// filter must not be. This is what the line-at-a-time version missed.
	for _, tc := range []struct {
		name string
		file string
		want []string
	}{
		{"multi-line UPDATE ... SET workspace_id is flagged", `-- name: MoveDocumentToWorkspace :one
UPDATE documents
SET workspace_id = sqlc.arg(workspace_id)
WHERE id = sqlc.arg(id)`, []string{"MoveDocumentToWorkspace"}},
		{"single-line UPDATE ... SET workspace_id is flagged", `-- name: Relocate :one
UPDATE documents SET workspace_id = sqlc.arg(workspace_id) WHERE id = sqlc.arg(id)`, []string{"Relocate"}},
		{"INSERT copying into another workspace is flagged", `-- name: CopyDocument :one
INSERT INTO documents (id, workspace_id, source_document_id)
VALUES (sqlc.arg(id), sqlc.arg(workspace_id), sqlc.arg(source_document_id))`, []string{"CopyDocument"}},
		{"INSERT ... ON CONFLICT DO UPDATE SET workspace_id is flagged", `-- name: UpsertDocument :one
INSERT INTO documents (id, title)
VALUES (sqlc.arg(id), sqlc.arg(title))
ON CONFLICT (id) DO UPDATE SET workspace_id = sqlc.arg(workspace_id)`, []string{"UpsertDocument"}},
		{"INSERT ... SELECT naming workspace_id outside its column list is flagged", `-- name: CopyDocumentsInto :one
INSERT INTO documents (id, title)
SELECT id, title FROM documents WHERE workspace_id = sqlc.arg(workspace_id)`, []string{"CopyDocumentsInto"}},
		{"a SET subquery's WHERE does not end the assignment region", `-- name: MoveDocumentWithSourceTitle :one
UPDATE documents
SET title = (SELECT t.title FROM documents t WHERE t.id = sqlc.arg(source_id)), workspace_id = sqlc.arg(workspace_id)
WHERE id = sqlc.arg(id)`, []string{"MoveDocumentWithSourceTitle"}},
		{"a quoted parenthesis in a SET value is not nesting", `-- name: RenameDocumentWithParenTitle :one
UPDATE documents
SET title = '('
WHERE workspace_id = sqlc.arg(workspace_id)`, nil},
		{"a quoted closing parenthesis in a SET subquery does not hide the assignment", `-- name: MoveDocumentWithQuotedParen :one
UPDATE documents
SET title = (SELECT ')' FROM documents t WHERE t.id = sqlc.arg(source_id)), workspace_id = sqlc.arg(workspace_id)
WHERE id = sqlc.arg(id)`, []string{"MoveDocumentWithQuotedParen"}},
		{"a schema-qualified INSERT is flagged", `-- name: CopyDocumentQualified :one
INSERT INTO public.documents (id, workspace_id, source_document_id)
VALUES (sqlc.arg(id), sqlc.arg(workspace_id), sqlc.arg(source_document_id))`, []string{"CopyDocumentQualified"}},
		{"an UPDATE that only filters on workspace_id is not flagged", `-- name: RenameDocument :one
UPDATE documents
SET title = sqlc.arg(title)
WHERE id = sqlc.arg(id) AND workspace_id = sqlc.arg(workspace_id)`, nil},
		{"an INSERT that does not name workspace_id is not flagged", `-- name: Touch :one
INSERT INTO documents (id, title) VALUES (sqlc.arg(id), sqlc.arg(title))`, nil},
	} {
		got := make([]string, 0, 1)
		for _, q := range sqlcQueries(tc.file) {
			if writesDocumentWorkspace(q.statement) {
				got = append(got, q.name)
			}
		}
		if strings.Join(got, ",") != strings.Join(tc.want, ",") {
			t.Fatalf("%s: detected %v, want %v", tc.name, got, tc.want)
		}
	}

	// The real scan: a query that writes documents.workspace_id must be
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
