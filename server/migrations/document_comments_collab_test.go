package migrations

// G8-03 (UNI-1398): document_comments_collab must convert every pre-G8 row to
// a discussion while the old CHECK is gone and add the widened CHECK after -
// doing it in the other order would either fail the migration or leave rows
// the new allowlist refuses. The reverse migration mirrors it.

import (
	"context"
	"strings"
	"testing"
)

func TestDocumentCommentsCollabMigrationConvertsLegacyRows(t *testing.T) {
	const up = "9991791860000000_document_comments_collab.up.sql"
	sql := stripSQLComments(readMigration(t, up))
	drop := strings.Index(sql, "DROP CONSTRAINT document_comments_comment_type_check")
	convert := strings.Index(sql, "UPDATE document_comments SET comment_type = 'discussion'")
	widen := strings.Index(sql, "CHECK (comment_type IN ('comment', 'discussion'))")
	if drop < 0 || convert < 0 || widen < 0 {
		t.Fatalf("%s must drop the old CHECK, convert the rows and add the widened CHECK", up)
	}
	if !(drop < convert && convert < widen) {
		t.Fatalf("%s statement order drop=%d convert=%d widen=%d: rows convert while no CHECK constrains them", up, drop, convert, widen)
	}
	if !strings.Contains(sql, "ALTER COLUMN comment_type SET DEFAULT 'discussion'") {
		t.Errorf("%s must move the column default to discussion (the old client's create)", up)
	}
	if strings.Contains(sql, "thread_kind") {
		t.Errorf("%s must not add a thread_kind column: comment_type is the one thread kind", up)
	}
	for _, column := range []string{"anchor JSONB", "anchor_version_id TEXT", "anchor_state TEXT", "deleted_at TIMESTAMPTZ", "deleted_by_id TEXT", "deleted_by_kind TEXT"} {
		if !strings.Contains(sql, column) {
			t.Errorf("%s is missing column %q", up, column)
		}
	}

	const down = "9991791860000000_document_comments_collab.down.sql"
	dsql := stripSQLComments(readMigration(t, down))
	ddrop := strings.Index(dsql, "DROP CONSTRAINT document_comments_comment_type_check")
	convertBack := strings.Index(dsql, "UPDATE document_comments SET comment_type = 'comment'")
	narrow := strings.Index(dsql, "CHECK (comment_type IN ('comment'))")
	if ddrop < 0 || convertBack < 0 || narrow < 0 {
		t.Fatalf("%s must drop the widened CHECK, convert the rows back and restore the old CHECK", down)
	}
	if !(ddrop < convertBack && convertBack < narrow) {
		t.Fatalf("%s statement order drop=%d convert=%d narrow=%d", down, ddrop, convertBack, narrow)
	}
}

// The statement order above is the reasoning; this runs it. A pre-G8 row
// written under the old CHECK goes through the real migration and comes back a
// discussion, with its updated_at untouched (the conversion is not an edit),
// and the widened CHECK holds afterwards.
func TestDocumentCommentsCollabMigrationRunsOnLegacyRows(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	lockTestDB(t, pool)
	if err := Up(ctx, pool); err != nil {
		t.Fatal(err)
	}
	const collab = "9991791860000000_document_comments_collab"
	rollBackThrough(t, pool, collab)
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM document_comments WHERE id LIKE 'g803-legacy-%'`)
		if err := Up(ctx, pool); err != nil {
			t.Errorf("re-up in cleanup: %v", err)
		}
	})
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	exec(`DELETE FROM document_comments WHERE id LIKE 'g803-legacy-%'`)
	// The pre-G8 schema: no kind column choice but 'comment', its default.
	exec(`INSERT INTO document_comments (id, organization_id, workspace_id, document_id, author_id, author_kind, body, updated_at)
		VALUES ('g803-legacy-root', 'g803-org', 'g803-ws', 'g803-doc', 'g803-user', 'human', 'cũ', '2026-01-02T03:04:05Z')`)
	exec(`INSERT INTO document_comments (id, organization_id, workspace_id, document_id, parent_comment_id, author_id, author_kind, body, comment_type, updated_at)
		VALUES ('g803-legacy-reply', 'g803-org', 'g803-ws', 'g803-doc', 'g803-legacy-root', 'g803-user', 'human', 'trả lời', 'comment', '2026-01-02T03:04:06Z')`)

	if err := Up(ctx, pool); err != nil {
		t.Fatalf("the collab migration over legacy rows: %v", err)
	}
	rows, err := pool.Query(ctx, `SELECT id, comment_type, updated_at = $1::timestamptz OR updated_at = $2::timestamptz, deleted_at IS NULL AND anchor IS NULL
		FROM document_comments WHERE id LIKE 'g803-legacy-%' ORDER BY id`, "2026-01-02T03:04:05Z", "2026-01-02T03:04:06Z")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	n := 0
	for rows.Next() {
		var id, kind string
		var sameUpdatedAt, clean bool
		if err := rows.Scan(&id, &kind, &sameUpdatedAt, &clean); err != nil {
			t.Fatal(err)
		}
		n++
		if kind != "discussion" || !sameUpdatedAt || !clean {
			t.Errorf("%s after the migration: kind=%q updated_at kept=%v no anchor/delete=%v", id, kind, sameUpdatedAt, clean)
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if n != 2 {
		t.Fatalf("legacy rows after the migration = %d, want 2", n)
	}
	if _, err := pool.Exec(ctx, `UPDATE document_comments SET comment_type = 'system' WHERE id = 'g803-legacy-root'`); err == nil {
		t.Fatal("the widened CHECK accepted comment_type = system")
	}
}
