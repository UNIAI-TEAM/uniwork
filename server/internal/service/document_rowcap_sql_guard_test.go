package service

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The archive walk stops after max_rows live rows only while Postgres may stop
// the recursive CTE early: an ORDER BY forces it to evaluate the whole subtree
// before LIMIT can take its rows, which is exactly what FD-03 removed.
// TestFD03RowCapEvidence proves the early stop with EXPLAIN but is gated behind
// FD03_EXPLAIN, so this guard watches the generated statement in the default
// suite instead. It needs no database.
func TestListLiveDocumentSubtreeIDsHasNoOrderByBeforeLimit(t *testing.T) {
	path := filepath.Join("..", "..", "pkg", "db", "generated", "document_tree.sql.go")
	src, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read the generated statement: %v", err)
	}

	const decl = "const listLiveDocumentSubtreeIDs = `"
	at := strings.Index(string(src), decl)
	if at < 0 {
		t.Fatalf("%s no longer declares %s, so this guard watches nothing", path, decl)
	}
	rest := string(src)[at+len(decl):]
	end := strings.Index(rest, "`")
	if end < 0 {
		t.Fatalf("%s: the statement is unterminated", path)
	}
	stmt := rest[:end]

	limit := strings.Index(stmt, "LIMIT")
	if limit < 0 {
		t.Fatalf("ListLiveDocumentSubtreeIDs has no LIMIT, so the walk never stops:\n%s", stmt)
	}
	if before := stmt[:limit]; strings.Contains(strings.ToUpper(before), "ORDER BY") {
		t.Fatalf("ListLiveDocumentSubtreeIDs orders its rows before the LIMIT, so the whole subtree is evaluated before the walk can stop; drop the ORDER BY and sort in Go:\n%s", stmt)
	}
}
