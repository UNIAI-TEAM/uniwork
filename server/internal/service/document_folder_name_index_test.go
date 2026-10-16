package service

// E6 FD-02 (UNI-1462 PR 2): the real 23505 safety net. PR 1 mapped the unique
// violation of idx_documents_folder_name_uidx onto 409 folder_name_taken, but
// until PR 2 created the index only the titleWriteErr seam could produce one.
// This test forces a real violation from PostgreSQL, with no seam: a
// conflicting row is held uncommitted by another session while the create
// runs, so the pre-check cannot see it and the insert waits on it until it
// commits.

import (
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

func TestDocumentFolderNameCreateMapsARealUniqueViolation(t *testing.T) {
	env := newFolderNamesEnv(t)
	watch, err := pgx.ConnectConfig(env.ctx, env.f.pool.Config().ConnConfig.Copy())
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = watch.Close(env.ctx) }()

	holder, err := env.f.pool.Begin(env.ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = holder.Rollback(env.ctx) }()
	if _, err := holder.Exec(env.ctx, `
		INSERT INTO documents (id, organization_id, workspace_id, kind, title, visibility,
		  created_by, created_by_kind, updated_by, updated_by_kind)
		VALUES ('01DOCFOLDERIDXHOLDER00000001', $1, $2, 'folder', 'Hợp đồng', 'workspace', $3, 'human', $3, 'human')`,
		env.tn.orgID, env.tn.wsA, env.tn.member.ID); err != nil {
		t.Fatal(err)
	}

	created := make(chan error, 1)
	go func() { created <- env.createFolder(t, "", "HỢP ĐỒNG") }()
	// A waiter proves the create passed the pre-check (which cannot see the
	// uncommitted twin) and reached the insert, where the index holds it.
	waitForLockWaitersOn(t, watch, 1)
	if err := holder.Commit(env.ctx); err != nil {
		t.Fatal(err)
	}

	select {
	case err := <-created:
		ce := wantCode(t, err, "folder_name_taken")
		if ce.Status != 409 {
			t.Fatalf("status = %d, want 409", ce.Status)
		}
	case <-time.After(30 * time.Second):
		t.Fatal("the create did not return after the holder committed")
	}

	var live int
	if err := env.f.pool.QueryRow(env.ctx, `
		SELECT count(*) FROM documents
		WHERE organization_id = $1 AND workspace_id = $2 AND kind = 'folder'
		  AND archived_at IS NULL AND owner_id IS NULL AND parent_id IS NULL
		  AND lower(title COLLATE "und-x-icu") = lower('Hợp đồng' COLLATE "und-x-icu")`,
		env.tn.orgID, env.tn.wsA).Scan(&live); err != nil {
		t.Fatal(err)
	}
	if live != 1 {
		t.Fatalf("live root folders holding the name = %d, want 1", live)
	}
}
