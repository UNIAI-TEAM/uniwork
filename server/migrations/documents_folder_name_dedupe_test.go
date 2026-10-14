package migrations

// E6 FD-02 (UNI-1462 PR 1) data migration: compose every live folder title,
// then give the later member of every duplicate group under one parent a
// "Tên (n)" name, skipping the numbers that parent already uses. The
// exercise runs the file over rows it seeds and runs it again: a second run
// changes nothing.

import (
	"context"
	"os"
	"path/filepath"
	"sort"
	"strings"
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

	// PR 2's idx_documents_folder_name_uidx refuses the duplicate live
	// siblings this exercise exists to dedupe, so the whole run happens in a
	// transaction with the index dropped: the rollback restores it. The
	// email-hub dedupe test drops its index for the same reason. The seed
	// cleanup above runs before the transaction on purpose - DROP INDEX holds
	// ACCESS EXCLUSIVE on documents, so a later pool statement would wait.
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `DROP INDEX IF EXISTS idx_documents_folder_name_uidx`); err != nil {
		t.Fatal(err)
	}

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
		if _, err := tx.Exec(ctx, `
			INSERT INTO documents (id, organization_id, workspace_id, kind, title, visibility,
			  parent_id, created_by, created_by_kind, updated_by, updated_by_kind, created_at)
			VALUES ($1, '01ORGDEDUPE0000000000000001', $2, $3, $4, 'workspace', nullif($5, ''),
			  '01USERDEDUPE00000000000001', 'human', '01USERDEDUPE00000000000001', 'human', now() - $6::interval)`,
			s.id, ws, s.kind, s.title, s.parent, s.createdAgo); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := tx.Exec(ctx, `
		UPDATE documents SET archived_at = now(), purge_after = now() + interval '30 days'
		WHERE id = '01DOCDEDUPEAR100000000000009'`); err != nil {
		t.Fatal(err)
	}

	run := func() {
		t.Helper()
		if _, err := tx.Exec(ctx, dedupe); err != nil {
			t.Fatalf("%s: %v", matches[0], err)
		}
	}
	titles := func() map[string]string {
		t.Helper()
		rows, err := tx.Query(ctx, `SELECT id, title FROM documents WHERE workspace_id = $1`, ws)
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
	if err := tx.QueryRow(ctx,
		`SELECT count(*) FROM audit_events WHERE resource_id LIKE '01DOCDEDUPE%'`).Scan(&audits); err != nil {
		t.Fatal(err)
	}
	if audits != 0 {
		t.Fatalf("the migration wrote %d audit rows", audits)
	}
}

// TestFolderNameDedupeMigrationICULowerKey seeds groups whose key differs
// between the cluster's default collation and the explicit ICU one, the case
// the first version of the migration got wrong: it compared the numbers it
// handed out with the default-locale lower while the keys it read back were
// the ICU lower, so an existing "İstanbul (2)" was invisible and the run left
// two rows on one key - the state PR 2's unique index cannot be built over.
// "İstanbul" lowercases to "istanbul" under en_US.utf8 but to "i̇stanbul"
// under und-x-icu (an extra combining dot), and a final sigma ("ΑΣ") keeps its
// final form only under ICU. Both groups must leave one row per ICU key, a
// second run must change nothing, and PR 2's exact index expression must build
// over the result.
func TestFolderNameDedupeMigrationICULowerKey(t *testing.T) {
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

	const ws = "01WSPCDEDUPEICU0000000000001"
	cleanup := func() { _, _ = pool.Exec(ctx, `DELETE FROM documents WHERE workspace_id = $1`, ws) }
	cleanup()
	t.Cleanup(cleanup)

	// PR 2's idx_documents_folder_name_uidx refuses the duplicate live
	// siblings this exercise seeds, so the whole run happens in a transaction
	// with the index dropped: the rollback restores it. The probe at the end
	// builds the index's exact expression inside that same transaction, over
	// the rows the migration just cleaned. The cleanup above runs before the
	// transaction on purpose - DROP INDEX holds ACCESS EXCLUSIVE on documents,
	// so a later pool statement would wait.
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `DROP INDEX IF EXISTS idx_documents_folder_name_uidx`); err != nil {
		t.Fatal(err)
	}

	// Two groups at the root, each "base", "base", "base (2)" - the shape the
	// buggy probe turns into two rows on one key.
	seed := []struct {
		id, title, createdAgo string
	}{
		{id: "01DOCDEDUPEICU100000000001", title: "İstanbul", createdAgo: "3 hours"},
		{id: "01DOCDEDUPEICU200000000002", title: "İstanbul", createdAgo: "2 hours"},
		{id: "01DOCDEDUPEICU300000000003", title: "İstanbul (2)", createdAgo: "30 minutes"},
		{id: "01DOCDEDUPEICU400000000004", title: "ΑΣ", createdAgo: "3 hours"},
		{id: "01DOCDEDUPEICU500000000005", title: "ΑΣ", createdAgo: "2 hours"},
		{id: "01DOCDEDUPEICU600000000006", title: "ΑΣ (2)", createdAgo: "30 minutes"},
	}
	for _, s := range seed {
		if _, err := tx.Exec(ctx, `
			INSERT INTO documents (id, organization_id, workspace_id, kind, title, visibility,
			  created_by, created_by_kind, updated_by, updated_by_kind, created_at)
			VALUES ($1, '01ORGDEDUPEICU000000000001', $2, 'folder', $3, 'workspace',
			  '01USERDEDUPE00000000000001', 'human', '01USERDEDUPE00000000000001', 'human', now() - $4::interval)`,
			s.id, ws, s.title, s.createdAgo); err != nil {
			t.Fatal(err)
		}
	}

	run := func() {
		t.Helper()
		if _, err := tx.Exec(ctx, dedupe); err != nil {
			t.Fatalf("%s: %v", matches[0], err)
		}
	}
	titles := func() map[string]string {
		t.Helper()
		rows, err := tx.Query(ctx, `SELECT id, title FROM documents WHERE workspace_id = $1`, ws)
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
	// duplicateKeys reports every ICU key two live folders of the workspace
	// share, the exact state the unique index of PR 2 rejects.
	duplicateKeys := func() []string {
		t.Helper()
		rows, err := tx.Query(ctx, `
			SELECT lower(title COLLATE "und-x-icu") AS k, count(*)
			FROM documents
			WHERE workspace_id = $1 AND kind = 'folder' AND archived_at IS NULL AND owner_id IS NULL
			GROUP BY 1 HAVING count(*) > 1 ORDER BY 1`, ws)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		var out []string
		for rows.Next() {
			var k string
			var n int
			if err := rows.Scan(&k, &n); err != nil {
				t.Fatal(err)
			}
			out = append(out, k)
		}
		if err := rows.Err(); err != nil {
			t.Fatal(err)
		}
		return out
	}

	run()
	got := titles()
	// "İstanbul (2)" is taken by the third row, so the later duplicate skips to
	// 3; the same for the final-sigma group.
	want := map[string]string{
		"01DOCDEDUPEICU100000000001": "İstanbul",
		"01DOCDEDUPEICU200000000002": "İstanbul (3)",
		"01DOCDEDUPEICU300000000003": "İstanbul (2)",
		"01DOCDEDUPEICU400000000004": "ΑΣ",
		"01DOCDEDUPEICU500000000005": "ΑΣ (3)",
		"01DOCDEDUPEICU600000000006": "ΑΣ (2)",
	}
	for id, title := range want {
		if got[id] != title {
			t.Errorf("migration[%s] = %q, want %q", id, got[id], title)
		}
	}
	if dup := duplicateKeys(); len(dup) > 0 {
		t.Errorf("the migration left %d key(s) shared by two live folders: %q", len(dup), dup)
	}

	// Idempotent: a second run finds single-row groups and composed titles.
	run()
	again := titles()
	for id, title := range got {
		if again[id] != title {
			t.Errorf("second run changed %s: %q -> %q", id, title, again[id])
		}
	}

	// PR 2's exact key expression must build over the result, inside the
	// transaction that dropped the real index: the rollback leaves the schema
	// as it found it.
	if _, err := tx.Exec(ctx, `CREATE UNIQUE INDEX fd02_dedupe_probe_uidx ON documents
		(workspace_id, COALESCE(parent_id, ''), lower(title COLLATE "und-x-icu"))
		WHERE kind = 'folder' AND archived_at IS NULL AND owner_id IS NULL`); err != nil {
		t.Errorf("PR 2's unique index does not build over the migration's result: %v", err)
	}
}

// TestFolderNameKeyExpressionIsOneShape guards the shared duplicate key: the
// pre-check query (document_names.sql), the dedupe migration of PR 1 and the
// unique index of PR 2 must write the collation INSIDE lower(), never after
// it. Applied to the result, the outside form resolves lower() under the
// cluster's default collation while every key read back is the ICU one, so the
// two disagree about which strings are the same name - the drift the appendix
// forbids. Every file holding the key expression is listed here, so a fourth
// copy cannot appear unnoticed.
func TestFolderNameKeyExpressionIsOneShape(t *testing.T) {
	var sources []string
	for _, glob := range []string{
		"*_documents_folder_name_dedupe.up.sql",
		"*_documents_folder_name_uidx.up.sql",
	} {
		matches, err := filepath.Glob(glob)
		if err != nil || len(matches) != 1 {
			t.Fatalf("want one %s, found %v (%v)", glob, matches, err)
		}
		sources = append(sources, matches[0])
	}
	sources = append(sources, filepath.Join("..", "pkg", "db", "queries", "document_names.sql"))

	const key = `COLLATE "und-x-icu"`
	for _, name := range sources {
		raw, err := os.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		sql := stripSQLComments(string(raw))
		occurrences := 0
		for i := 0; ; {
			at := strings.Index(sql[i:], key)
			if at < 0 {
				break
			}
			at += i
			occurrences++
			i = at + len(key)
			if !insideLowerCall(sql, at) {
				t.Errorf("%s:%d: COLLATE %q is outside its lower() call; write lower(x COLLATE %q)",
					name, strings.Count(sql[:at], "\n")+1, "und-x-icu", "und-x-icu")
			}
		}
		if occurrences == 0 {
			t.Errorf("%s carries no lower(... COLLATE \"und-x-icu\") key expression", name)
		}
	}
}

// insideLowerCall reports whether the innermost call open at offset at is
// lower - the shape that resolves the argument under the ICU collation.
// "lower(x) COLLATE \"und-x-icu\"" closes the call before the COLLATE, so its
// nesting is empty there and the check fails, which is the drift this guards.
// Single-quoted literals are skipped, so the "(" of the "(n)" suffix never
// counts as a call.
func insideLowerCall(sql string, at int) bool {
	var open []int
	for i := 0; i < at; i++ {
		switch sql[i] {
		case '\'':
			for i++; i < at && sql[i] != '\''; i++ {
			}
		case '(':
			open = append(open, i)
		case ')':
			if len(open) > 0 {
				open = open[:len(open)-1]
			}
		}
	}
	if len(open) == 0 {
		return false
	}
	start := open[len(open)-1]
	const callee = "lower"
	return start >= len(callee) && strings.EqualFold(sql[start-len(callee):start], callee)
}
