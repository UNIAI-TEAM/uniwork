package migrations

// E6 FD-02 (UNI-1462 PR 1) data migration: compose every live folder title,
// then give the later member of every duplicate group under one parent a
// "Tên (n)" name, skipping the numbers that parent already uses. The
// exercise runs the file over rows it seeds and runs it again: a second run
// changes nothing.

import (
	"context"
	"path/filepath"
	"sort"
	"testing"

	"golang.org/x/text/unicode/norm"
)

func TestFolderNameDedupeMigration(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	lock, err := pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := WaitAdvisoryLock(ctx, lock, 727273); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = lock.Exec(ctx, "SELECT pg_advisory_unlock($1)", 727273); lock.Release() })
	if err := Up(ctx, pool); err != nil {
		t.Fatal(err)
	}

	matches, err := filepath.Glob("*_documents_folder_name_dedupe.up.sql")
	if err != nil || len(matches) != 1 {
		t.Fatalf("want one folder-name dedupe migration, found %v (%v)", matches, err)
	}
	dedupe := readMigration(t, matches[0])

	const ws = "01WSPCDEDUPE0000000000000001"
	cleanup := func() { _, _ = pool.Exec(ctx, `DELETE FROM documents WHERE workspace_id = $1`, ws) }
	cleanup()
	t.Cleanup(cleanup)

	seed := []struct {
		id, kind, title, parent string
		archived                bool
		createdAgo              string
	}{
		{id: "01DOCDEDUPEA100000000000001", kind: "folder", title: "A", createdAgo: "3 hours"},
		{id: "01DOCDEDUPEA200000000000002", kind: "folder", title: "a", createdAgo: "2 hours"},
		{id: "01DOCDEDUPEA300000000000003", kind: "folder", title: "A", createdAgo: "1 hour"},
		{id: "01DOCDEDUPEA2X0000000000004", kind: "folder", title: "A (2)", createdAgo: "30 minutes"},
		{id: "01DOCDEDUPEN100000000000005", kind: "folder", title: "Hợp đồng", createdAgo: "3 hours"},
		{id: "01DOCDEDUPEN200000000000006", kind: "folder", title: norm.NFD.String("Hợp đồng"), createdAgo: "2 hours"},
		{id: "01DOCDEDUPEMA100000000000007", kind: "folder", title: "Ma", createdAgo: "3 hours"},
		{id: "01DOCDEDUPEMA200000000000008", kind: "folder", title: "Mã", createdAgo: "2 hours"},
		{id: "01DOCDEDUPEAR100000000000009", kind: "folder", title: "Cũ", createdAgo: "4 hours", archived: true},
		{id: "01DOCDEDUPEAR200000000000010", kind: "folder", title: "Cũ", createdAgo: "2 hours"},
		{id: "01DOCDEDUPEPA100000000000011", kind: "page", title: "A", createdAgo: "3 hours"},
		{id: "01DOCDEDUPEPR000000000000012", kind: "folder", title: "Cha", createdAgo: "3 hours"},
		{id: "01DOCDEDUPECO000000000000013", kind: "folder", title: "Con", parent: "01DOCDEDUPEPR000000000000012", createdAgo: "2 hours"},
	}
	for _, s := range seed {
		if _, err := pool.Exec(ctx, `
			INSERT INTO documents (id, organization_id, workspace_id, kind, title, visibility,
			  parent_id, created_by, created_by_kind, updated_by, updated_by_kind, created_at)
			VALUES ($1, '01ORGDEDUPE0000000000000001', $2, $3, $4, 'workspace', nullif($5, ''),
			  '01USERDEDUPE00000000000001', 'human', '01USERDEDUPE00000000000001', 'human', now() - $6::interval)`,
			s.id, ws, s.kind, s.title, s.parent, s.createdAgo); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := pool.Exec(ctx, `
		UPDATE documents SET archived_at = now(), purge_after = now() + interval '30 days'
		WHERE id = '01DOCDEDUPEAR100000000000009'`); err != nil {
		t.Fatal(err)
	}

	run := func() {
		t.Helper()
		if _, err := pool.Exec(ctx, dedupe); err != nil {
			t.Fatalf("%s: %v", matches[0], err)
		}
	}
	titles := func() map[string]string {
		t.Helper()
		rows, err := pool.Query(ctx, `SELECT id, title FROM documents WHERE workspace_id = $1`, ws)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		out := map[string]string{}
		for rows.Next() {
			var id, title string
			if err := rows.Scan(&id, &title); err != nil {
				t.Fatal(err)
			}
			out[id] = title
		}
		if err := rows.Err(); err != nil {
			t.Fatal(err)
		}
		return out
	}

	run()
	got := titles()
	want := map[string]string{
		"01DOCDEDUPEA100000000000001":  "A",     // the oldest keeps the name
		"01DOCDEDUPEA200000000000002":  "a (3)", // "A (2)" is taken, so the group skips to 3
		"01DOCDEDUPEA300000000000003":  "A (4)",
		"01DOCDEDUPEA2X0000000000004":  "A (2)", // already numbered: untouched
		"01DOCDEDUPEN100000000000005":  "Hợp đồng",
		"01DOCDEDUPEN200000000000006":  "Hợp đồng (2)", // composed, then renamed
		"01DOCDEDUPEMA100000000000007": "Ma",           // accents stay significant
		"01DOCDEDUPEMA200000000000008": "Mã",
		"01DOCDEDUPEAR100000000000009": "Cũ", // archived rows are not cleaned
		"01DOCDEDUPEAR200000000000010": "Cũ",
		"01DOCDEDUPEPA100000000000011": "A", // a page is not a folder
		"01DOCDEDUPEPR000000000000012": "Cha",
		"01DOCDEDUPECO000000000000013": "Con",
	}
	ids := make([]string, 0, len(want))
	for id := range want {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		if got[id] != want[id] {
			t.Errorf("migration[%s] = %q, want %q", id, got[id], want[id])
		}
	}

	// Idempotent: the second run finds single-row groups and composed titles.
	run()
	again := titles()
	for id, title := range got {
		if again[id] != title {
			t.Errorf("second run changed %s: %q -> %q", id, title, again[id])
		}
	}

	// No audit row: a data fix is not a user command.
	var audits int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM audit_events WHERE resource_id LIKE '01DOCDEDUPE%'`).Scan(&audits); err != nil {
		t.Fatal(err)
	}
	if audits != 0 {
		t.Fatalf("the migration wrote %d audit rows", audits)
	}
}
