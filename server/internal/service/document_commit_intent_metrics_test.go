package service

import (
	"context"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/util"
)

// Every path that answers from the ledger counts one replay: the peek (in
// TestCommitIntentSyncWriteFlag), the post-claim race (the intent was
// committed between our peek and our claim) and the transaction's own replay.
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

	// The transaction's own replay: BeginIdempotent finds the row when the
	// claim is absent (the legacy caller shape).
	file, err := resolveUpload(context.Background(), env.fs, documentScope(doc.OrganizationID, doc.WorkspaceID), up.UploadID)
	mustf(t, err, "resolve upload")
	inTx, replayed, err := env.svc.commitClaimedFileVersion(context.Background(), member, doc,
		documentScope(doc.OrganizationID, doc.WorkspaceID), file,
		CommitFileVersionInput{UploadID: up.UploadID, BaseRevision: created.Document.Revision, IdempotencyKey: key}, opts, nil)
	mustf(t, err, "in-tx replay")
	if !replayed || inTx.Version.ID != res.Version.ID {
		t.Fatalf("in-tx replay = %+v replayed=%v, want %s", inTx, replayed, res.Version.ID)
	}
	if env.m.replays != 2 {
		t.Fatalf("replays = %d, want 2 after the in-tx replay", env.m.replays)
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
