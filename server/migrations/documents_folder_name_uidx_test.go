package migrations

// E6 FD-02 (UNI-1462 PR 2): idx_documents_folder_name_uidx. One live folder
// (kind='folder', archived_at IS NULL, owner_id IS NULL) of one workspace
// holds one name under one parent; the key is the one expression of
// document_names.sql - lower(title COLLATE "und-x-icu") over the NFC title -
// so "Hợp đồng" and "HỢP ĐỒNG" are one name while "Ma" and "Mã" are two. The
// index is the safety net behind the service pre-check of PR 1, so this file
// pins both halves: the index a migrated database must carry, and the insert
// it refuses.

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

const folderNameUniqueIndex = "idx_documents_folder_name_uidx"

func TestDocumentsFolderNameIndexIsValid(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	lockTestDB(t, pool)
	if err := Up(ctx, pool); err != nil {
		t.Fatal(err)
	}
	var valid, ready bool
	var definition string
	if err := pool.QueryRow(ctx, `
		SELECT i.indisvalid, i.indisready, pg_get_indexdef(i.indexrelid)
		FROM pg_index i
		JOIN pg_class c ON c.oid = i.indexrelid
		WHERE c.relname = $1`, folderNameUniqueIndex).Scan(&valid, &ready, &definition); err != nil {
		t.Fatalf("%s is not in pg_index: %v", folderNameUniqueIndex, err)
	}
	if !valid || !ready {
		t.Fatalf("%s: indisvalid=%v indisready=%v, want both true", folderNameUniqueIndex, valid, ready)
	}
	for _, fragment := range []string{
		"workspace_id",
		"COALESCE(parent_id",
		"lower((",
		`title COLLATE "und-x-icu"`,
		"kind = 'folder'",
		"archived_at IS NULL",
		"owner_id IS NULL",
	} {
		if !strings.Contains(definition, fragment) {
			t.Errorf("%s misses %q in its definition:\n%s", folderNameUniqueIndex, fragment, definition)
		}
	}
}

func TestDocumentsFolderNameIndexRefusesALiveDuplicate(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	lockTestDB(t, pool)
	if err := Up(ctx, pool); err != nil {
		t.Fatal(err)
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	const (
		org     = "01ORGFOLDERIDX000000000001"
		ws      = "01WSPFOLDERIDX000000000001"
		otherWS = "01WSPFOLDERIDX000000000002"
		parent  = "01DOCFOLDERIDXPARENT0000001"
		user    = "01USERFOLDERIDX00000000001"
	)
	insert := `
		INSERT INTO documents (id, organization_id, workspace_id, kind, title, visibility,
		  parent_id, created_by, created_by_kind, updated_by, updated_by_kind)
		VALUES ($1, $2, $3, $4, $5, 'workspace', nullif($6, ''), $7, 'human', $7, 'human')`
	insertDoc := func(id, workspace, kind, title, parentID string) {
		t.Helper()
		if _, err := tx.Exec(ctx, insert, id, org, workspace, kind, title, parentID, user); err != nil {
			t.Fatalf("insert %s %q: %v", kind, title, err)
		}
	}

	insertDoc(parent, ws, "folder", "Cha", "")
	insertDoc("01DOCFOLDERIDXLIVE0000000001", ws, "folder", "Hợp đồng", "")
	// The name stays free for a folder that is archived, a page, a folder
	// under another parent and a folder of another workspace (§3.3). The
	// archived row enters archived: a live insert would (rightly) be refused.
	if _, err := tx.Exec(ctx, `
		INSERT INTO documents (id, organization_id, workspace_id, kind, title, visibility,
		  created_by, created_by_kind, updated_by, updated_by_kind, archived_at, purge_after)
		VALUES ('01DOCFOLDERIDXARCH0000000001', $1, $2, 'folder', 'Hợp đồng', 'workspace',
		  $3, 'human', $3, 'human', now(), now() + interval '30 days')`, org, ws, user); err != nil {
		t.Fatalf("insert archived folder: %v", err)
	}
	insertDoc("01DOCFOLDERIDXPAGE0000000001", ws, "page", "Hợp đồng", "")
	insertDoc("01DOCFOLDERIDXOTHER0000000001", ws, "folder", "Hợp đồng", parent)
	insertDoc("01DOCFOLDERIDXWS20000000001", otherWS, "folder", "Hợp đồng", "")

	// The second live sibling, case-different: its own savepoint, so the
	// refused insert does not abort the transaction the assertions run in.
	sp, err := tx.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	_, err = sp.Exec(ctx, insert, "01DOCFOLDERIDXDUP00000000001", org, ws, "folder", "HỢP ĐỒNG", "", user)
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "23505" || pgErr.ConstraintName != folderNameUniqueIndex {
		t.Fatalf("second live sibling: err = %v, want 23505 on %s", err, folderNameUniqueIndex)
	}
	if err := sp.Rollback(ctx); err != nil {
		t.Fatal(err)
	}

	var live int
	if err := tx.QueryRow(ctx, `
		SELECT count(*) FROM documents
		WHERE organization_id = $1 AND workspace_id = $2 AND kind = 'folder'
		  AND archived_at IS NULL AND owner_id IS NULL AND COALESCE(parent_id, '') = ''
		  AND lower(title COLLATE "und-x-icu") = lower('Hợp đồng' COLLATE "und-x-icu")`,
		org, ws).Scan(&live); err != nil {
		t.Fatal(err)
	}
	if live != 1 {
		t.Fatalf("live root folders holding the name = %d, want 1", live)
	}
}
