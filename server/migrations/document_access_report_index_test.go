package migrations

import (
	"context"
	"strings"
	"testing"
)

// UNI-2039 fx1 (r1 F1): access_changed_at reads every share and link of a
// document, revoked rows included. The live-only partial indexes cannot serve
// that read; the two (organization_id, workspace_id, document_id) INCLUDE
// indexes must, or each candidate document costs a sequential scan.
func TestAccessChangedReadsUseTheirIndexes(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	lockTestDB(t, pool)
	if err := Up(ctx, pool); err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct{ table, index string }{
		{"document_shares", "idx_document_shares_doc_changed"},
		{"document_share_links", "idx_document_share_links_doc_changed"},
	} {
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := tx.Exec(ctx, "SET LOCAL enable_seqscan = off"); err != nil {
			_ = tx.Rollback(ctx)
			t.Fatal(err)
		}
		rows, err := tx.Query(ctx, `EXPLAIN SELECT max(GREATEST(created_at, revoked_at)) FROM `+c.table+
			` WHERE organization_id = 'o' AND workspace_id = 'w' AND document_id = 'd'`)
		if err != nil {
			_ = tx.Rollback(ctx)
			t.Fatal(err)
		}
		var plan strings.Builder
		for rows.Next() {
			var line string
			if err := rows.Scan(&line); err != nil {
				t.Fatal(err)
			}
			plan.WriteString(line + "\n")
		}
		rows.Close()
		_ = tx.Rollback(ctx)
		if !strings.Contains(plan.String(), c.index) {
			t.Errorf("%s: the all-rows read does not use %s:\n%s", c.table, c.index, plan.String())
		}
	}
}

// UNI-2039 fx1 (r1 F4): document_shares keeps full history, so the origin
// CHECK is added NOT VALID (no scan under ACCESS EXCLUSIVE) and a later file
// validates it holding only SHARE UPDATE EXCLUSIVE.
func TestShareOriginCheckIsAddedNotValidAndValidatedLater(t *testing.T) {
	up, err := fsys.ReadFile("9991792521101187_document_shares_origin.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(up), "NOT VALID") {
		t.Fatalf("the origin CHECK is not added NOT VALID:\n%s", up)
	}
	pool := testPool(t)
	ctx := context.Background()
	lockTestDB(t, pool)
	if err := Up(ctx, pool); err != nil {
		t.Fatal(err)
	}
	var validated bool
	if err := pool.QueryRow(ctx, `SELECT convalidated FROM pg_constraint WHERE conname = 'document_shares_origin_check'`).Scan(&validated); err != nil {
		t.Fatal(err)
	}
	if !validated {
		t.Fatal("document_shares_origin_check is still NOT VALID after every migration ran")
	}
}
