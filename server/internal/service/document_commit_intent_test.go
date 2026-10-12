package service

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// countingIntentMetrics records the G5-07 counters.
type countingIntentMetrics struct {
	mu      sync.Mutex
	lookups map[string]int
	replays int
	swept   int
}

func newCountingIntentMetrics() *countingIntentMetrics {
	return &countingIntentMetrics{lookups: map[string]int{}}
}

func (c *countingIntentMetrics) IncOfficeIntentLookup(outcome string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.lookups[outcome]++
}

func (c *countingIntentMetrics) IncOfficeIdempotentReplay() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.replays++
}

func (c *countingIntentMetrics) AddOfficeCommitIntentsSwept(n int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.swept += n
}

// staticDocFlags answers every key with one value.
type staticDocFlags map[string]bool

func (f staticDocFlags) IsEnabled(_ context.Context, key string, def bool) bool {
	if v, ok := f[key]; ok {
		return v
	}
	return def
}

// intentEnv is a file document env with the intent counters wired.
type intentEnv struct {
	*docStorageEnv
	m *countingIntentMetrics
}

func newIntentEnv(t *testing.T) *intentEnv {
	t.Helper()
	env := newFakeDocStorageEnv(t)
	m := newCountingIntentMetrics()
	env.svc.SetIntentMetrics(m)
	// A retry on a live claim waits briefly before in_flight; keep it short.
	env.svc.SetCommitIntentPolicy(CommitIntentPolicy{Await: 100 * time.Millisecond})
	return &intentEnv{docStorageEnv: env, m: m}
}

func (e *intentEnv) lookup(actor Actor, docID, key string) (CommitIntentResult, error) {
	return e.svc.LookupCommitIntent(context.Background(), actor, docID, key)
}

// expireClaim moves the intent's claim into the past on the database clock,
// the way a stalled attempt outlives its TTL.
func (e *intentEnv) expireClaim(t *testing.T, key string) {
	t.Helper()
	if _, err := e.f.pool.Exec(context.Background(),
		`UPDATE document_commit_intents SET claim_expires_at = clock_timestamp() - interval '1 second' WHERE idempotency_key = $1`, key); err != nil {
		t.Fatal(err)
	}
}

// claimFor claims key for a staged upload without committing, the first half
// of an attempt.
func (e *intentEnv) claimFor(t *testing.T, actor Actor, d db.Document, up DocumentUpload, key string) (commitIntentClaim, files.File, IdempotencyOptions) {
	t.Helper()
	file, err := resolveUpload(context.Background(), e.fs, documentScope(d.OrganizationID, d.WorkspaceID), up.UploadID)
	mustf(t, err, "resolve upload")
	opts := IdempotencyOptions{Fingerprint: commitFingerprint(d.ID, d.Revision, file.ChecksumSHA256, DocumentEngineInfo{}), RequireFingerprint: true}
	claim, committed, err := e.svc.claimCommitIntent(context.Background(), actor, d, key, opts.Fingerprint)
	mustf(t, err, "claim")
	if committed {
		t.Fatal("a fresh key claimed as committed")
	}
	return claim, file, opts
}

// finishAttempt runs the second half of an attempt (format check + the commit
// transaction with its fence) for a claim taken earlier.
func (e *intentEnv) finishAttempt(d db.Document, file files.File, up DocumentUpload, key string, opts IdempotencyOptions, claim commitIntentClaim, actor Actor) error {
	_, _, err := e.svc.commitClaimedFileVersion(context.Background(), actor, d, documentScope(d.OrganizationID, d.WorkspaceID), file,
		CommitFileVersionInput{UploadID: up.UploadID, BaseRevision: d.Revision, IdempotencyKey: key}, opts, &claim)
	return err
}

func (e *intentEnv) intentCount(t *testing.T, key string) int {
	t.Helper()
	var n int
	if err := e.f.pool.QueryRow(context.Background(),
		`SELECT count(*) FROM document_commit_intents WHERE idempotency_key = $1`, key).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestCommitIntentLookupCommitted(t *testing.T) {
	env := newIntentEnv(t)
	member := human(env.tn.member)
	created := env.createFile(t, member, "intent.pdf", pdfBody("v1"))
	up := env.upload(t, member, created.Document.ID, "intent-v2.pdf", pdfBody("v2"))
	key := util.NewID()

	// Timeout after commit: the client never read the answer and asks.
	res, err := env.commit(member, created.Document.ID, up.UploadID, created.Document.Revision, key)
	mustf(t, err, "commit")
	got, err := env.lookup(member, created.Document.ID, key)
	mustf(t, err, "lookup")
	if got.Outcome != CommitIntentCommitted || got.VersionID != res.Version.ID ||
		got.Version != res.Version.Version || got.Revision != res.Document.Revision {
		t.Fatalf("lookup = %+v, want committed v%d rev %d", got, res.Version.Version, res.Document.Revision)
	}
	if env.m.lookups[CommitIntentCommitted] != 1 {
		t.Fatalf("lookups = %v, want committed=1", env.m.lookups)
	}
}

func TestCommitIntentLookupInFlightAndExpiredClaim(t *testing.T) {
	env := newIntentEnv(t)
	member := human(env.tn.member)
	created := env.createFile(t, member, "flight.pdf", pdfBody("v1"))
	up := env.upload(t, member, created.Document.ID, "flight-v2.pdf", pdfBody("v2"))
	key := util.NewID()
	env.claimFor(t, member, created.Document, up, key)

	got, err := env.lookup(member, created.Document.ID, key)
	mustf(t, err, "lookup in flight")
	if got.Outcome != CommitIntentInFlight {
		t.Fatalf("lookup = %+v, want in_flight while the claim is live", got)
	}
	// A retry of the same key while the claim is live waits for it.
	_, err = env.commit(member, created.Document.ID, up.UploadID, created.Document.Revision, key)
	wantCode(t, err, "idempotency_in_flight")

	env.expireClaim(t, key)
	got, err = env.lookup(member, created.Document.ID, key)
	mustf(t, err, "lookup expired")
	if got.Outcome != CommitIntentNotCommitted {
		t.Fatalf("lookup = %+v, want not_committed after the claim expired", got)
	}
	if env.m.lookups[CommitIntentInFlight] != 1 || env.m.lookups[CommitIntentNotCommitted] != 1 {
		t.Fatalf("lookups = %v", env.m.lookups)
	}
}

// An attempt whose claim expired cannot late-commit, whether a newer attempt
// renewed the intent or nobody did.
func TestCommitIntentFenceRefusesLateCommit(t *testing.T) {
	t.Run("expired, not renewed", func(t *testing.T) {
		env := newIntentEnv(t)
		member := human(env.tn.member)
		created := env.createFile(t, member, "late.pdf", pdfBody("v1"))
		up := env.upload(t, member, created.Document.ID, "late-v2.pdf", pdfBody("v2"))
		key := util.NewID()
		claim, file, opts := env.claimFor(t, member, created.Document, up, key)
		env.expireClaim(t, key)

		got, err := env.lookup(member, created.Document.ID, key)
		mustf(t, err, "lookup")
		if got.Outcome != CommitIntentNotCommitted {
			t.Fatalf("lookup = %+v, want not_committed", got)
		}
		err = env.finishAttempt(created.Document, file, up, key, opts, claim, member)
		wantCode(t, err, "idempotency_in_flight")
		if vs := env.versions(t, env.doc(t, created.Document.ID)); len(vs) != 1 {
			t.Fatalf("versions = %d, want 1: the fenced attempt committed", len(vs))
		}
		got, err = env.lookup(member, created.Document.ID, key)
		mustf(t, err, "lookup after the refused late commit")
		if got.Outcome != CommitIntentNotCommitted {
			t.Fatalf("lookup = %+v, want still not_committed", got)
		}
	})

	t.Run("renewed by a newer attempt", func(t *testing.T) {
		env := newIntentEnv(t)
		member := human(env.tn.member)
		created := env.createFile(t, member, "renew.pdf", pdfBody("v1"))
		up := env.upload(t, member, created.Document.ID, "renew-v2.pdf", pdfBody("v2"))
		key := util.NewID()
		stale, file, opts := env.claimFor(t, member, created.Document, up, key)
		env.expireClaim(t, key)

		// The newer attempt takes the intent over and commits.
		res, err := env.commit(member, created.Document.ID, up.UploadID, created.Document.Revision, key)
		mustf(t, err, "newer attempt")
		if n := env.countAudit(t, audit.ActionDocumentCommitIntentRenewed, created.Document.ID); n != 1 {
			t.Fatalf("renewal audit rows = %d, want 1", n)
		}
		// The stale attempt wakes up: the ledger already holds the answer, so
		// it replays instead of committing a second version.
		_ = env.finishAttempt(created.Document, file, up, key, opts, stale, member)
		if vs := env.versions(t, env.doc(t, created.Document.ID)); len(vs) != 2 {
			t.Fatalf("versions = %d, want 2", len(vs))
		}
		got, err := env.lookup(member, created.Document.ID, key)
		mustf(t, err, "lookup")
		if got.Outcome != CommitIntentCommitted || got.VersionID != res.Version.ID {
			t.Fatalf("lookup = %+v, want committed %s", got, res.Version.ID)
		}
	})
}

// A retry after a restart (a new service on the same database) replays the
// stored answer and never commits twice.
func TestCommitIntentRetryAfterRestartReplays(t *testing.T) {
	env := newIntentEnv(t)
	member := human(env.tn.member)
	created := env.createFile(t, member, "restart.pdf", pdfBody("v1"))
	up := env.upload(t, member, created.Document.ID, "restart-v2.pdf", pdfBody("v2"))
	key := util.NewID()
	first, err := env.commit(member, created.Document.ID, up.UploadID, created.Document.Revision, key)
	mustf(t, err, "commit")

	restarted := newDocumentServiceForTest(env.f.pool, env.f.q)
	restarted.SetFiles(env.fs)
	restarted.SetEntitlements(env.ent)
	m := newCountingIntentMetrics()
	restarted.SetIntentMetrics(m)
	again, err := restarted.CommitFileVersion(context.Background(), member, created.Document.ID, CommitFileVersionInput{
		UploadID: up.UploadID, BaseRevision: created.Document.Revision, IdempotencyKey: key,
	})
	mustf(t, err, "retry after restart")
	if again.Version.ID != first.Version.ID {
		t.Fatalf("retry version %s, want the first %s", again.Version.ID, first.Version.ID)
	}
	if vs := env.versions(t, env.doc(t, created.Document.ID)); len(vs) != 2 {
		t.Fatalf("versions = %d, want 2", len(vs))
	}
	if m.replays != 1 {
		t.Fatalf("replays = %d, want 1", m.replays)
	}
}

// A swept intent answers 410 commit_intent_unknown, never not_committed; a
// retry of the key still replays from the idempotency ledger.
func TestCommitIntentSweptAnswersUnknown(t *testing.T) {
	env := newIntentEnv(t)
	member := human(env.tn.member)
	created := env.createFile(t, member, "swept.pdf", pdfBody("v1"))
	up := env.upload(t, member, created.Document.ID, "swept-v2.pdf", pdfBody("v2"))
	key := util.NewID()
	first, err := env.commit(member, created.Document.ID, up.UploadID, created.Document.Revision, key)
	mustf(t, err, "commit")
	if _, err := env.f.pool.Exec(context.Background(),
		`UPDATE document_commit_intents SET retain_until = clock_timestamp() - interval '1 second' WHERE idempotency_key = $1`, key); err != nil {
		t.Fatal(err)
	}
	n, err := env.svc.SweepCommitIntents(context.Background())
	mustf(t, err, "sweep")
	if n < 1 || env.intentCount(t, key) != 0 {
		t.Fatalf("swept %d, intent rows left %d", n, env.intentCount(t, key))
	}
	if env.m.swept < 1 {
		t.Fatalf("swept metric = %d", env.m.swept)
	}
	_, err = env.lookup(member, created.Document.ID, key)
	ce := wantCode(t, err, "commit_intent_unknown")
	if ce.Status != 410 || ce.Fields["outcome"] != CommitIntentUnknown {
		t.Fatalf("unknown = %+v", ce)
	}
	if env.m.lookups[CommitIntentUnknown] != 1 || env.m.lookups[CommitIntentNotCommitted] != 0 {
		t.Fatalf("lookups = %v", env.m.lookups)
	}
	again, err := env.commit(member, created.Document.ID, up.UploadID, created.Document.Revision, key)
	mustf(t, err, "retry after the sweep")
	if again.Version.ID != first.Version.ID {
		t.Fatalf("retry after the sweep committed again: %s, want %s", again.Version.ID, first.Version.ID)
	}
}

// A live claim and a committed intent within the window survive the sweep.
func TestCommitIntentSweepKeepsLiveRows(t *testing.T) {
	env := newIntentEnv(t)
	member := human(env.tn.member)
	created := env.createFile(t, member, "keep.pdf", pdfBody("v1"))
	up := env.upload(t, member, created.Document.ID, "keep-v2.pdf", pdfBody("v2"))
	live := util.NewID()
	env.claimFor(t, member, created.Document, up, live)
	if _, err := env.f.pool.Exec(context.Background(),
		`UPDATE document_commit_intents SET retain_until = clock_timestamp() - interval '1 second' WHERE idempotency_key = $1`, live); err != nil {
		t.Fatal(err)
	}
	_, err := env.svc.SweepCommitIntents(context.Background())
	mustf(t, err, "sweep")
	if env.intentCount(t, live) != 1 {
		t.Fatal("the sweep deleted an intent whose claim is live")
	}
}

// office_sync_write gates the desktop sync commit only (G5-07, X-03): with
// the flag off a sync commit is office_capability_off while a web commit keeps
// saving, and a replay and the lookup keep answering.
func TestCommitIntentSyncWriteFlag(t *testing.T) {
	env := newIntentEnv(t)
	member := human(env.tn.member)
	created := env.createFile(t, member, "flag.pdf", pdfBody("v1"))
	up := env.upload(t, member, created.Document.ID, "flag-v2.pdf", pdfBody("v2"))
	key := util.NewID()

	// No override: office_sync_write defaults on, the sync commit runs.
	env.svc.SetFlags(staticDocFlags{})
	res, err := env.commitSync(member, created.Document.ID, up.UploadID, created.Document.Revision, key, true)
	mustf(t, err, "sync commit with the default flag")

	env.svc.SetFlags(staticDocFlags{officeSyncWriteFlag: false})
	// The web path is never gated.
	up2 := env.upload(t, member, created.Document.ID, "flag-v3.pdf", pdfBody("v3"))
	web, err := env.commitSync(member, created.Document.ID, up2.UploadID, res.Document.Revision, util.NewID(), false)
	mustf(t, err, "web commit with the flag off")
	// A new sync commit is refused.
	up3 := env.upload(t, member, created.Document.ID, "flag-v4.pdf", pdfBody("v4"))
	_, err = env.commitSync(member, created.Document.ID, up3.UploadID, web.Document.Revision, util.NewID(), true)
	ce := wantCode(t, err, "office_capability_off")
	if ce.Status != 403 || ce.Fields["capability"] != "sync_write" {
		t.Fatalf("refusal = %+v", ce)
	}
	if !errors.Is(err, ErrForbidden) {
		t.Fatalf("office_capability_off must unwrap to ErrForbidden: %v", err)
	}
	// The committed result is still readable, by lookup and by replay; the
	// replay path is counted.
	got, err := env.lookup(member, created.Document.ID, key)
	mustf(t, err, "lookup with the flag off")
	if got.Outcome != CommitIntentCommitted || got.VersionID != res.Version.ID {
		t.Fatalf("lookup = %+v", got)
	}
	again, err := env.commitSync(member, created.Document.ID, up.UploadID, created.Document.Revision, key, true)
	mustf(t, err, "replay with the flag off")
	if again.Version.ID != res.Version.ID {
		t.Fatalf("replay = %s, want %s", again.Version.ID, res.Version.ID)
	}
	if env.m.replays != 1 {
		t.Fatalf("replays = %d, want 1 (the flag-off replay)", env.m.replays)
	}
	if vs := env.versions(t, env.doc(t, created.Document.ID)); len(vs) != 3 {
		t.Fatalf("versions = %d, want 3", len(vs))
	}
}

// A refused commit releases its claim at once: the lookup answers
// not_committed and the same key can be retried without waiting out the TTL.
func TestCommitIntentConflictReleasesClaim(t *testing.T) {
	env := newIntentEnv(t)
	docMetrics := &countingDocMetrics{}
	env.svc.SetMetrics(docMetrics)
	member := human(env.tn.member)
	created := env.createFile(t, member, "conflict.pdf", pdfBody("v1"))
	a := env.upload(t, member, created.Document.ID, "conflict-a.pdf", pdfBody("a"))
	_, err := env.commit(member, created.Document.ID, a.UploadID, created.Document.Revision, util.NewID())
	mustf(t, err, "first save")

	b := env.upload(t, member, created.Document.ID, "conflict-b.pdf", pdfBody("b"))
	key := util.NewID()
	_, err = env.commit(member, created.Document.ID, b.UploadID, created.Document.Revision, key)
	wantCode(t, err, "document_version_conflict")
	// The 409 at commit is the existing conflict counter (reuse, G5-07).
	if len(docMetrics.conflicts) != 1 || docMetrics.conflicts[0] != "file/document_version_conflict" {
		t.Fatalf("conflicts = %v", docMetrics.conflicts)
	}
	got, err := env.lookup(member, created.Document.ID, key)
	mustf(t, err, "lookup")
	if got.Outcome != CommitIntentNotCommitted {
		t.Fatalf("lookup = %+v, want not_committed after the refusal", got)
	}
	_, err = env.commit(member, created.Document.ID, b.UploadID, created.Document.Revision, key)
	wantCode(t, err, "document_version_conflict")
}

// Another member's key and a stranger learn nothing.
func TestCommitIntentLookupIsTheCallersOwn(t *testing.T) {
	env := newIntentEnv(t)
	member := human(env.tn.member)
	created := env.createFile(t, member, "own.pdf", pdfBody("v1"))
	up := env.upload(t, member, created.Document.ID, "own-v2.pdf", pdfBody("v2"))
	key := util.NewID()
	_, err := env.commit(member, created.Document.ID, up.UploadID, created.Document.Revision, key)
	mustf(t, err, "commit")

	_, err = env.lookup(human(env.tn.owner), created.Document.ID, key)
	wantCode(t, err, "commit_intent_unknown")

	_, err = env.lookup(human(env.tn.bMember), created.Document.ID, key)
	var ce CodedError
	if errors.As(err, &ce) || !errors.Is(err, ErrNotFound) {
		t.Fatalf("stranger lookup = %v, want plain not_found", err)
	}

	other := env.createFile(t, member, "other.pdf", pdfBody("o1"))
	_, err = env.lookup(member, other.Document.ID, key)
	wantCode(t, err, "commit_intent_unknown")

	_, err = env.lookup(member, created.Document.ID, "")
	var ve ValidationError
	if !errors.As(err, &ve) {
		t.Fatalf("empty key = %v, want a validation error", err)
	}
}

// Commits without a key keep the legacy path and leave no intent.
func TestCommitIntentNotCreatedWithoutKey(t *testing.T) {
	env := newIntentEnv(t)
	member := human(env.tn.member)
	created := env.createFile(t, member, "nokey.pdf", pdfBody("v1"))
	up := env.upload(t, member, created.Document.ID, "nokey-v2.pdf", pdfBody("v2"))
	_, err := env.commit(member, created.Document.ID, up.UploadID, created.Document.Revision, "")
	mustf(t, err, "commit")
	var n int
	if err := env.f.pool.QueryRow(context.Background(),
		`SELECT count(*) FROM document_commit_intents WHERE document_id = $1`, created.Document.ID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("intent rows = %d, want 0", n)
	}
}
