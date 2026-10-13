package service

import (
	"context"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/util"
)

// Every path that answers from the ledger counts one replay: the peek (in
// TestCommitIntentSyncWriteFlag), the post-claim race (the intent was
// committed between our peek and our claim) and the transaction's own replay
// (the ledger answer for a key whose intent row is gone - a commit from
// before the intents existed, or one whose intent was swept - lands between
// the attempt's peek and its transaction, so BeginIdempotent answers it).
// The in-tx phase drives the public path: the counter is incremented by
// commitFileVersion after the transaction (document_commit.go:298-299), so
// only a CommitFileVersion call runs the real increment site.
func TestCommitIntentReplayCounterEveryPath(t *testing.T) {
	env := newIntentEnv(t)
	member := human(env.tn.member)
	created := env.createFile(t, member, "replays.pdf", pdfBody("v1"))
	up := env.upload(t, member, created.Document.ID, "replays-v2.pdf", pdfBody("v2"))
	key := util.NewID()

	res, err := env.commit(member, created.Document.ID, up.UploadID, created.Document.Revision, key)
	mustf(t, err, "commit")

	// The post-claim race: another attempt committed the intent after this
	// attempt's peek, so the claim reports committed and the ledger answer is
	// re-read through replayCommittedIntent.
	opts := IdempotencyOptions{Fingerprint: commitFingerprint(created.Document.ID, created.Document.Revision, fileChecksum(t, env, up), DocumentEngineInfo{}), RequireFingerprint: true}
	doc := env.doc(t, created.Document.ID)
	_, committed, err := env.svc.claimCommitIntent(context.Background(), member, doc, key, opts.Fingerprint)
	mustf(t, err, "claim a committed intent")
	if !committed {
		t.Fatal("a committed intent claimed as uncommitted")
	}
	race, err := env.svc.replayCommittedIntent(context.Background(), member, doc,
		CommitFileVersionInput{UploadID: up.UploadID, BaseRevision: created.Document.Revision, IdempotencyKey: key},
		opts, DocumentAccess{Level: DocumentLevelEdit})
	mustf(t, err, "post-claim replay")
	if race.Version.ID != res.Version.ID {
		t.Fatalf("post-claim replay = %s, want %s", race.Version.ID, res.Version.ID)
	}
	if env.m.replays != 1 {
		t.Fatalf("replays = %d, want 1 after the post-claim race", env.m.replays)
	}

	// The transaction's own replay, through the public path: the ledger
	// answer for this key lands after the retry's peek (which finds no row
	// yet) and its intent row is gone, so the retry claims fresh and the
	// transaction's BeginIdempotent - not the peek - answers from the ledger.
	key3 := util.NewID()
	up3 := env.upload(t, member, created.Document.ID, "replays-v3.pdf", pdfBody("v2"))
	env.claimFor(t, member, created.Document, up3, key3)

	conn, err := env.f.pool.Acquire(context.Background())
	mustf(t, err, "acquire the holder connection")
	defer conn.Release()
	tx, err := conn.Begin(context.Background())
	mustf(t, err, "begin the holder transaction")
	planted := false
	defer func() {
		if !planted {
			_ = tx.Rollback(context.Background())
		}
	}()
	if _, err := tx.Exec(context.Background(),
		`SELECT 1 FROM document_commit_intents WHERE idempotency_key = $1 FOR UPDATE`, key3); err != nil {
		t.Fatal(err)
	}

	// The retry parks on the intent row, between its peek and its claim, so
	// the ledger answer below lands in between.
	type answer struct {
		res DocumentFileResult
		err error
	}
	retry := make(chan answer, 1)
	go func() {
		res, err := env.commit(member, created.Document.ID, up3.UploadID, created.Document.Revision, key3)
		retry <- answer{res: res, err: err}
	}()
	waitForIntentLockWait(t, env)

	// The ledger answer the committed key stored, under this key, and the
	// intent row dropped (the swept shape): the retry's transaction must
	// answer from the ledger instead of committing a second version.
	if _, err := tx.Exec(context.Background(), `
		INSERT INTO idempotency_keys (id, organization_id, workspace_id, scope, key, actor_id, payload_fingerprint, response_status, response_body)
		SELECT $1, organization_id, workspace_id, scope, $2, actor_id, payload_fingerprint, response_status, response_body
		FROM idempotency_keys
		WHERE organization_id = $3 AND workspace_id = $4 AND scope = $5 AND key = $6`,
		util.NewID(), key3, created.Document.OrganizationID, created.Document.WorkspaceID,
		idempotencyScopeDocumentVersionCommit, key); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(context.Background(),
		`DELETE FROM document_commit_intents WHERE idempotency_key = $1`, key3); err != nil {
		t.Fatal(err)
	}
	mustf(t, tx.Commit(context.Background()), "plant the ledger answer and drop the intent")
	planted = true

	got := <-retry
	mustf(t, got.err, "the retry whose transaction replayed the ledger")
	if got.res.Version.ID != res.Version.ID {
		t.Fatalf("in-tx replay = %s, want %s", got.res.Version.ID, res.Version.ID)
	}
	if env.m.replays != 2 {
		t.Fatalf("replays = %d, want 2 after the in-tx replay", env.m.replays)
	}
	// The peek path never claims an intent, so the committed intent row
	// proves the answer came from inside the transaction.
	settled, err := env.lookup(member, created.Document.ID, key3)
	mustf(t, err, "lookup after the in-tx replay")
	if settled.Outcome != CommitIntentCommitted || settled.VersionID != res.Version.ID {
		t.Fatalf("intent after the in-tx replay = %+v, want committed %s", settled, res.Version.ID)
	}

	if vs := env.versions(t, env.doc(t, created.Document.ID)); len(vs) != 2 {
		t.Fatalf("versions = %d, want 2", len(vs))
	}
}

// fileChecksum reads the staged upload's verified checksum the way the
// commit's fingerprint does.
func fileChecksum(t *testing.T, e *intentEnv, up DocumentUpload) string {
	t.Helper()
	file, err := resolveUpload(context.Background(), e.fs, documentScope(e.tn.orgID, e.tn.wsA), up.UploadID)
	mustf(t, err, "resolve upload")
	return file.ChecksumSHA256
}
