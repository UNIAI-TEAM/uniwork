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

const (
	folderNameUniqueIndex = "idx_documents_folder_name_user_uidx"
	legacyFolderNameIndex = "idx_documents_folder_name_uidx"
	myFolderUniqueIndex   = "idx_documents_my_folder_uidx"
)

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
		"system_kind IS NULL",
	} {
		if !strings.Contains(definition, fragment) {
			t.Errorf("%s misses %q in its definition:\n%s", folderNameUniqueIndex, fragment, definition)
		}
	}
	var legacyExists bool
	if err := pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM pg_class WHERE relname = $1)`, legacyFolderNameIndex).Scan(&legacyExists); err != nil {
		t.Fatal(err)
	}
	if legacyExists {
		t.Fatalf("%s should have been dropped after %s was built", legacyFolderNameIndex, folderNameUniqueIndex)
	}
}

func TestDocumentsMyFolderSchemaAndIndexes(t *testing.T) {
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
		WHERE c.relname = $1`, myFolderUniqueIndex).Scan(&valid, &ready, &definition); err != nil {
		t.Fatalf("%s is not in pg_index: %v", myFolderUniqueIndex, err)
	}
	if !valid || !ready {
		t.Fatalf("%s: indisvalid=%v indisready=%v, want both true", myFolderUniqueIndex, valid, ready)
	}
	for _, fragment := range []string{"workspace_id", "acl_owner_id", "system_kind = 'my_folder'"} {
		if !strings.Contains(definition, fragment) {
			t.Errorf("%s misses %q in its definition:\n%s", myFolderUniqueIndex, fragment, definition)
		}
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	const (
		org   = "01ORGMYFOLDERIDX0000000001"
		ws    = "01WSPMYFOLDERIDX0000000001"
		userA = "01USRMYFOLDERIDX0000000001"
		userB = "01USRMYFOLDERIDX0000000002"
	)
	insertMyFolder := func(id, owner string) error {
		_, err := tx.Exec(ctx, `
			INSERT INTO documents (id, organization_id, workspace_id, kind, system_kind, title, visibility,
			  workspace_level, acl_owner_id, created_by, created_by_kind, updated_by, updated_by_kind)
			VALUES ($1, $2, $3, 'folder', 'my_folder', 'My Folder', 'restricted', 'view', $4, $4, 'human', $4, 'human')`,
			id, org, ws, owner)
		return err
	}
	// Two members each get their own My Folder at root, and a user-created root folder named "My Folder" coexists.
	if err := insertMyFolder("01DOCMYFOLDERIDXA000000001", userA); err != nil {
		t.Fatalf("insert userA My Folder: %v", err)
	}
	if err := insertMyFolder("01DOCMYFOLDERIDXB000000001", userB); err != nil {
		t.Fatalf("insert userB My Folder: %v", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO documents (id, organization_id, workspace_id, kind, title, visibility,
		  acl_owner_id, created_by, created_by_kind, updated_by, updated_by_kind)
		VALUES ('01DOCMYFOLDERIDXUSER000001', $1, $2, 'folder', 'My Folder', 'restricted', $3, $3, 'human', $3, 'human')`,
		org, ws, userA); err != nil {
		t.Fatalf("insert user-owned root folder named 'My Folder': %v", err)
	}

	// Duplicate My Folder for the same (workspace, acl_owner_id) is refused by idx_documents_my_folder_uidx.
	sp, err := tx.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	err = insertMyFolder("01DOCMYFOLDERIDXDUP0000001", userA)
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "23505" || pgErr.ConstraintName != myFolderUniqueIndex {
		t.Fatalf("second My Folder for userA: err = %v, want 23505 on %s", err, myFolderUniqueIndex)
	}
	if err := sp.Rollback(ctx); err != nil {
		t.Fatal(err)
	}

	// CHECK constraints refuse invalid system_kind values or non-root/non-folder/owned rows.
	for _, tc := range []struct {
		name string
		sql  string
	}{
		{
			name: "unknown system_kind",
			sql: `INSERT INTO documents (id, organization_id, workspace_id, kind, system_kind, title, visibility, created_by, created_by_kind, updated_by, updated_by_kind)
				VALUES ('01DOCMYFOLDERCHK0000000001', '01ORG', '01WS', 'folder', 'other', 'My Folder', 'restricted', '01U', 'human', '01U', 'human')`,
		},
		{
			name: "system_kind on page",
			sql: `INSERT INTO documents (id, organization_id, workspace_id, kind, system_kind, title, visibility, created_by, created_by_kind, updated_by, updated_by_kind)
				VALUES ('01DOCMYFOLDERCHK0000000002', '01ORG', '01WS', 'page', 'my_folder', 'My Folder', 'restricted', '01U', 'human', '01U', 'human')`,
		},
		{
			name: "system_kind with parent_id",
			sql: `INSERT INTO documents (id, organization_id, workspace_id, kind, system_kind, parent_id, title, visibility, created_by, created_by_kind, updated_by, updated_by_kind)
				VALUES ('01DOCMYFOLDERCHK0000000003', '01ORG', '01WS', 'folder', 'my_folder', '01PARENT', 'My Folder', 'restricted', '01U', 'human', '01U', 'human')`,
		},
		{
			name: "system_kind with owner_kind",
			sql: `INSERT INTO documents (id, organization_id, workspace_id, kind, system_kind, owner_kind, owner_id, title, visibility, created_by, created_by_kind, updated_by, updated_by_kind)
				VALUES ('01DOCMYFOLDERCHK0000000004', '01ORG', '01WS', 'folder', 'my_folder', 'work_product', '01WP', 'My Folder', 'restricted', '01U', 'human', '01U', 'human')`,
		},
	} {
		sp, err := tx.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		_, err = sp.Exec(ctx, tc.sql)
		if !errors.As(err, &pgErr) || pgErr.Code != "23514" {
			t.Fatalf("%s: err = %v, want 23514 check_violation", tc.name, err)
		}
		if err := sp.Rollback(ctx); err != nil {
			t.Fatal(err)
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
