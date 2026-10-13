package migrations

// G8-03 (UNI-1398): document_comments_collab must convert every pre-G8 row to
// a discussion while the old CHECK is gone and add the widened CHECK after -
// doing it in the other order would either fail the migration or leave rows
// the new allowlist refuses. The reverse migration mirrors it.

import (
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
