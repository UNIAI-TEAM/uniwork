package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/storage"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// These are the T3 negative cases of plan section 4 that the contract suite
// does not reach, on the real service, the test database and the local
// adapter. The contract suite itself runs in file_service_contract_test.go.

const (
	t3Org   = "01J8ZQ0K7V9W1Y2X3Z4A5B6C7D"
	t3OrgB  = "01J8ZQ0K7V9W1Y2X3Z4A5B6C7E"
	t3WS    = "01J8ZQ0K7V9W1Y2X3Z4A5B6C7F"
	t3User  = "01J8ZQ0K7V9W1Y2X3Z4A5B6C7H"
	t3UserB = "01J8ZQ0K7V9W1Y2X3Z4A5B6C7J"
)

var (
	t3PNG   = append([]byte("\x89PNG\r\n\x1a\n"), make([]byte, 48)...)
	t3Scope = files.Scope{OrganizationID: t3Org, WorkspaceID: t3WS}
	t3Actor = audit.User(t3User)
)

// forbiddenReader fails the test if anyone reads it: a refusal before the
// body, or a replay, must not touch the stream.
type forbiddenReader struct{ t *testing.T }

func (r forbiddenReader) Read([]byte) (int, error) {
	r.t.Error("the body was read")
	return 0, errors.New("forbidden read")
}

func t3Upload(t *testing.T, h *fileHarness, purpose files.UploadPurpose, scope files.Scope, key, name string, body []byte) (files.Upload, error) {
	t.Helper()
	return h.svc.Upload(context.Background(), files.UploadInput{
		Actor: t3Actor, Purpose: purpose, Scope: scope, IdempotencyKey: key, Filename: name, Body: bytes.NewReader(body),
	})
}

func t3UploadOK(t *testing.T, h *fileHarness, key string) files.Upload {
	t.Helper()
	up, err := t3Upload(t, h, files.TaskAttachment, t3Scope, key, "note.png", t3PNG)
	if err != nil {
		t.Fatalf("upload %s: %v", key, err)
	}
	return up
}

func t3Claim(t *testing.T, h *fileHarness, ids ...files.FileID) ([]files.File, error) {
	t.Helper()
	var out []files.File
	err := h.inTx(t, func(q *db.Queries) error {
		var err error
		out, err = h.svc.ClaimInTx(context.Background(), q, files.ClaimInput{
			Actor: t3Actor, Purpose: files.TaskAttachment, Scope: t3Scope, FileIDs: ids,
		})
		return err
	})
	return out, err
}

func t3Code(t *testing.T, err error, code string) {
	t.Helper()
	var fe *files.Error
	if !errors.As(err, &fe) || fe.Code != code {
		t.Fatalf("error = %v, want %s", err, code)
	}
}

func fileCountRows(t *testing.T, pool *pgxpool.Pool, sql string, args ...any) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		t.Fatalf("count %q: %v", sql, err)
	}
	return n
}

func pipelineRowCounts(t *testing.T, pool *pgxpool.Pool) (int, int, int) {
	t.Helper()
	return fileCountRows(t, pool, `SELECT count(*) FROM files`),
		fileCountRows(t, pool, `SELECT count(*) FROM file_upload_sessions`),
		fileCountRows(t, pool, `SELECT count(*) FROM file_jobs`)
}

func TestNewFileServiceRefusesBadWiring(t *testing.T) {
	local := buildStore(t, storage.Config{Backend: storage.BackendLocal, Local: &storage.LocalConfig{Root: t.TempDir()}}, storage.BackendLocal)
	var typedNil *switchStore
	cases := []struct {
		name string
		opts FileServiceOptions
	}{
		{"no pool", FileServiceOptions{Store: local}},
		{"no store", FileServiceOptions{Pool: &pgxpool.Pool{}}},
		{"typed nil store", FileServiceOptions{Pool: &pgxpool.Pool{}, Store: typedNil}},
		{"local with a bucket", FileServiceOptions{Pool: &pgxpool.Pool{}, Store: local, Bucket: "b"}},
	}
	for _, tc := range cases {
		if _, err := NewFileService(tc.opts); err == nil {
			t.Errorf("%s: NewFileService accepted it", tc.name)
		}
	}
}

// A refused purpose or scope leaves no row, no job and no object, and never
// reads the body (plan T3: no side effect on a bad purpose).
func TestUploadRefusalsBeforeTheBodyHaveNoSideEffect(t *testing.T) {
	h := newFileHarness(t, localFileBackend(), nil)
	ctx := context.Background()
	refusals := []struct {
		purpose files.UploadPurpose
		scope   files.Scope
		code    string
	}{
		{"", t3Scope, files.CodePurposeUnknown},
		{"not_a_purpose", t3Scope, files.CodePurposeUnknown},
		{files.DocumentFile, t3Scope, files.CodePurposeDisabled},
		{files.TaskAttachment, files.Scope{OrganizationID: t3Org}, files.CodeScopeInvalid},
		{files.UserAvatar, files.Scope{UserID: t3User, OrganizationID: t3Org}, files.CodeScopeInvalid},
		{files.TaskAttachment, files.Scope{OrganizationID: "../" + t3Org, WorkspaceID: t3WS}, files.CodeScopeInvalid},
	}
	for i, tc := range refusals {
		_, err := h.svc.Upload(ctx, files.UploadInput{
			Actor: t3Actor, Purpose: tc.purpose, Scope: tc.scope,
			IdempotencyKey: "refused-" + string(rune('a'+i)), Filename: "x.png", Body: forbiddenReader{t},
		})
		t3Code(t, err, tc.code)
	}
	if f, s, j := pipelineRowCounts(t, h.pool); f+s+j != 0 {
		t.Errorf("refusals left rows: files=%d sessions=%d jobs=%d", f, s, j)
	}
	if puts, _ := h.store.counts(); puts != 0 {
		t.Errorf("refusals stored %d objects", puts)
	}
}

// Size and MIME fraud: the cap is measured on the stream and the type comes
// from the bytes, so a lying filename changes nothing, nothing is stored, and
// the refusal is the key's recorded result.
func TestUploadFraudIsRefusedWithoutStoringBytes(t *testing.T) {
	h := newFileHarness(t, localFileBackend(), nil)

	_, err := t3Upload(t, h, files.TaskDescriptionImage, t3Scope, "fraud-type", "photo.png", []byte("%PDF-1.7\n just a pdf"))
	t3Code(t, err, files.CodeTypeRejected)

	big := append(append([]byte{}, t3PNG...), make([]byte, 2<<20)...)
	_, err = t3Upload(t, h, files.UserAvatar, files.Scope{UserID: t3User}, "fraud-size", "tiny.png", big)
	t3Code(t, err, files.CodeTooLarge)

	if puts, _ := h.store.counts(); puts != 0 {
		t.Errorf("a refused upload stored %d objects", puts)
	}
	if n := fileCountRows(t, h.pool, `SELECT count(*) FROM file_upload_sessions WHERE status = 'canceled' AND failure_code IS NOT NULL`); n != 2 {
		t.Errorf("%d sessions carry their refusal, want 2", n)
	}
	if n := fileCountRows(t, h.pool, `SELECT count(*) FROM files WHERE status = 'failed'`); n != 2 {
		t.Errorf("%d refused files failed, want 2", n)
	}
	if n := fileCountRows(t, h.pool, `SELECT count(*) FROM file_jobs WHERE status = 'pending'`); n != 0 {
		t.Errorf("%d jobs left pending for files that never stored a byte", n)
	}

	// Replays answer from the record without reading a body.
	_, err = h.svc.Upload(context.Background(), files.UploadInput{
		Actor: t3Actor, Purpose: files.TaskDescriptionImage, Scope: t3Scope,
		IdempotencyKey: "fraud-type", Filename: "photo.png", Body: forbiddenReader{t},
	})
	t3Code(t, err, files.CodeTypeRejected)
}

// A successful replay returns the stored result and never reads the body.
func TestUploadReplayNeverReadsTheBody(t *testing.T) {
	h := newFileHarness(t, localFileBackend(), nil)
	first := t3UploadOK(t, h, "replay-body")
	again, err := h.svc.Upload(context.Background(), files.UploadInput{
		Actor: t3Actor, Purpose: files.TaskAttachment, Scope: t3Scope,
		IdempotencyKey: "replay-body", Filename: "note.png", Body: forbiddenReader{t},
	})
	if err != nil || again.File.ID != first.File.ID {
		t.Fatalf("replay = %+v, %v; want file %s", again, err, first.File.ID)
	}
	if puts, _ := h.store.counts(); puts != 1 {
		t.Errorf("stored %d objects for one logical upload", puts)
	}
	// Claiming, and attaching the same file again (T1-Q3 reuse), never
	// reserves its bytes a second time (T1-Q9).
	for i := 0; i < 2; i++ {
		if _, err := t3Claim(t, h, first.File.ID); err != nil {
			t.Fatalf("claim %d: %v", i, err)
		}
	}
	if n := h.quota.reservations(); n != 1 {
		t.Errorf("%d quota reservations for one file claimed twice, want 1", n)
	}
	// Another organization may use the same key for its own upload.
	other, err := t3Upload(t, h, files.TaskAttachment, files.Scope{OrganizationID: t3OrgB, WorkspaceID: t3WS}, "replay-body", "note.png", t3PNG)
	if err != nil || other.File.ID == first.File.ID {
		t.Fatalf("another tenant's upload under the same key = %+v, %v", other, err)
	}
}

// Fail before Put: nothing is published, the key stays retryable with a fresh
// file (new id, new key, next generation) and the dead attempt is queued for
// cleanup. Put succeeded but finalize never ran: the intent's reconcile job is
// pending while the bytes are stored, which is what recovers them.
func TestUploadFailureBeforeAndAfterPut(t *testing.T) {
	h := newFileHarness(t, localFileBackend(), nil)
	ctx := context.Background()

	h.store.setDown(true)
	_, err := t3Upload(t, h, files.TaskAttachment, t3Scope, "fail-put", "note.png", t3PNG)
	t3Code(t, err, files.CodeStorageUnavailable)
	h.store.setDown(false)
	if n := fileCountRows(t, h.pool, `SELECT count(*) FROM file_upload_sessions WHERE status = 'receiving' AND lease_owner IS NULL`); n != 1 {
		t.Fatalf("the failed attempt left %d released receiving sessions, want 1", n)
	}
	if n := fileCountRows(t, h.pool, `SELECT count(*) FROM file_jobs j JOIN files f ON f.id = j.file_id WHERE f.status = 'failed' AND j.operation = 'cleanup' AND j.status = 'pending'`); n != 1 {
		t.Errorf("the failed attempt has %d cleanup jobs, want 1", n)
	}

	var reconcileDuringPut int
	h.store.setAfterPut(func(string) {
		reconcileDuringPut = fileCountRows(t, h.pool, `SELECT count(*) FROM file_jobs WHERE operation = 'reconcile' AND status = 'pending'`)
	})
	up := t3UploadOK(t, h, "fail-put")
	h.store.setAfterPut(nil)
	if reconcileDuringPut != 1 {
		t.Errorf("while the bytes were stored and not yet finalized, %d reconcile jobs were pending, want 1", reconcileDuringPut)
	}
	if n := fileCountRows(t, h.pool, `SELECT count(*) FROM file_jobs WHERE operation = 'reconcile' AND status = 'pending'`); n != 0 {
		t.Errorf("a finalized upload left %d reconcile jobs pending", n)
	}
	if n := fileCountRows(t, h.pool, `SELECT generation FROM file_upload_sessions WHERE idempotency_key = 'fail-put'`); n != 2 {
		t.Errorf("session generation = %d after one retry, want 2", n)
	}
	var keys int
	_ = h.pool.QueryRow(ctx, `SELECT count(DISTINCT object_key) FROM files`).Scan(&keys)
	if keys != 2 {
		t.Errorf("the retry reused an object key (%d distinct keys for 2 attempts)", keys)
	}
	if _, err := t3Claim(t, h, up.File.ID); err != nil {
		t.Fatalf("claim after retry: %v", err)
	}
}

// A second writer never joins a live one: while the first holds the lease the
// same key answers conflict; once the lease has expired, the key retries.
func TestUploadDoesNotOpenASecondWriter(t *testing.T) {
	h := newFileHarness(t, localFileBackend(), nil)
	release := make(chan struct{})
	entered := make(chan struct{})
	h.store.setAfterPut(func(string) {
		close(entered)
		<-release
	})
	done := make(chan error, 1)
	go func() {
		_, err := t3Upload(t, h, files.TaskAttachment, t3Scope, "one-writer", "note.png", t3PNG)
		done <- err
	}()
	<-entered
	h.store.setAfterPut(nil)
	_, err := h.svc.Upload(context.Background(), files.UploadInput{
		Actor: t3Actor, Purpose: files.TaskAttachment, Scope: t3Scope,
		IdempotencyKey: "one-writer", Filename: "note.png", Body: forbiddenReader{t},
	})
	t3Code(t, err, files.CodeIdempotencyConflict)
	close(release)
	if err := <-done; err != nil {
		t.Fatalf("first writer: %v", err)
	}
}

// Save-cancel race: a cancel that lands while the body is being stored wins.
// The upload answers upload_canceled, the file is never published, and the
// stored object is queued for cleanup.
func TestCancelDuringUploadWins(t *testing.T) {
	h := newFileHarness(t, localFileBackend(), nil)
	ctx := context.Background()
	h.store.setAfterPut(func(key string) {
		var id string
		if err := h.pool.QueryRow(ctx, `SELECT id FROM files WHERE object_key = $1`, key).Scan(&id); err != nil {
			t.Errorf("find intent: %v", err)
			return
		}
		if err := h.svc.CancelUpload(ctx, files.CancelInput{Actor: t3Actor, Scope: t3Scope, FileID: files.FileID(id)}); err != nil {
			t.Errorf("cancel while storing: %v", err)
		}
	})
	_, err := t3Upload(t, h, files.TaskAttachment, t3Scope, "save-cancel", "note.png", t3PNG)
	t3Code(t, err, files.CodeUploadCanceled)
	if n := fileCountRows(t, h.pool, `SELECT count(*) FROM files WHERE status = 'ready'`); n != 0 {
		t.Errorf("%d files were published after the cancel won", n)
	}
	if n := fileCountRows(t, h.pool, `SELECT count(*) FROM file_jobs WHERE operation = 'cleanup' AND status = 'pending'`); n != 1 {
		t.Errorf("%d cleanup jobs for the canceled bytes, want 1", n)
	}
}

// Claim and cancel racing on the same staged file: exactly one wins, and the
// loser answers the matching refusal.
func TestClaimAndCancelRace(t *testing.T) {
	h := newFileHarness(t, localFileBackend(), nil)
	ctx := context.Background()
	for i := 0; i < 5; i++ {
		up := t3UploadOK(t, h, "race-"+string(rune('a'+i)))
		var wg sync.WaitGroup
		var claimErr, cancelErr error
		wg.Add(2)
		go func() {
			defer wg.Done()
			_, claimErr = t3Claim(t, h, up.File.ID)
		}()
		go func() {
			defer wg.Done()
			cancelErr = h.svc.CancelUpload(ctx, files.CancelInput{Actor: t3Actor, Scope: t3Scope, FileID: up.File.ID})
		}()
		wg.Wait()
		switch {
		case claimErr == nil:
			t3Code(t, cancelErr, files.CodeAlreadyClaimed)
		case cancelErr == nil:
			t3Code(t, claimErr, files.CodeUploadCanceled)
		default:
			t.Fatalf("both lost: claim %v, cancel %v", claimErr, cancelErr)
		}
	}
}

// A multi-file save is all or nothing: one refused id consumes no session.
func TestMultiFileClaimIsAllOrNothing(t *testing.T) {
	h := newFileHarness(t, localFileBackend(), nil)
	a := t3UploadOK(t, h, "multi-a")
	b := t3UploadOK(t, h, "multi-b")
	c := t3UploadOK(t, h, "multi-c")
	if err := h.svc.CancelUpload(context.Background(), files.CancelInput{Actor: t3Actor, Scope: t3Scope, FileID: c.File.ID}); err != nil {
		t.Fatalf("cancel: %v", err)
	}
	_, err := t3Claim(t, h, a.File.ID, b.File.ID, c.File.ID)
	t3Code(t, err, files.CodeUploadCanceled)
	if n := fileCountRows(t, h.pool, `SELECT count(*) FROM file_upload_sessions WHERE status = 'staged'`); n != 2 {
		t.Errorf("%d sessions still staged after the refused batch, want 2", n)
	}
	if got, err := t3Claim(t, h, a.File.ID, b.File.ID); err != nil || len(got) != 2 {
		t.Fatalf("claim of the good pair = %v, %v", got, err)
	}
}

// A module transaction that fails after ClaimInTx rolls the claim back: the
// session is staged again in the database, not just in the answer.
func TestClaimRollbackRestoresTheSession(t *testing.T) {
	h := newFileHarness(t, localFileBackend(), nil)
	up := t3UploadOK(t, h, "rollback")
	boom := errors.New("module failed")
	err := h.inTx(t, func(q *db.Queries) error {
		if _, err := h.svc.ClaimInTx(context.Background(), q, files.ClaimInput{
			Actor: t3Actor, Purpose: files.TaskAttachment, Scope: t3Scope, FileIDs: []files.FileID{up.File.ID},
		}); err != nil {
			return err
		}
		return boom
	})
	if !errors.Is(err, boom) {
		t.Fatalf("tx = %v", err)
	}
	if n := fileCountRows(t, h.pool, `SELECT count(*) FROM file_upload_sessions WHERE status = 'staged' AND closed_at IS NULL`); n != 1 {
		t.Errorf("the rolled-back claim left %d staged sessions, want 1", n)
	}
}

// The window is exclusive at 24 hours on the service clock: one microsecond
// before it the file claims, at the deadline it does not (T1-Q5). Release
// and re-claim void the cleanup the release queued.
func TestClaimWindowEdgeAndReclaim(t *testing.T) {
	h := newFileHarness(t, localFileBackend(), nil)
	before := t3UploadOK(t, h, "edge-before")
	at := t3UploadOK(t, h, "edge-at")
	h.clock.Advance(files.ClaimTTL - time.Microsecond)
	if _, err := t3Claim(t, h, before.File.ID); err != nil {
		t.Fatalf("claim just before the deadline: %v", err)
	}
	h.clock.Advance(time.Microsecond)
	_, err := t3Claim(t, h, at.File.ID)
	t3Code(t, err, files.CodeClaimExpired)

	if err := h.inTx(t, func(q *db.Queries) error {
		return h.svc.ReleaseInTx(context.Background(), q, []files.FileID{before.File.ID})
	}); err != nil {
		t.Fatalf("release: %v", err)
	}
	if n := fileCountRows(t, h.pool, `SELECT count(*) FROM file_jobs WHERE file_id = $1 AND operation = 'cleanup' AND status = 'pending'`, string(before.File.ID)); n != 1 {
		t.Fatalf("release queued %d cleanup jobs, want 1", n)
	}
	if _, err := t3Claim(t, h, before.File.ID); err != nil {
		t.Fatalf("re-claim: %v", err)
	}
	if n := fileCountRows(t, h.pool, `SELECT count(*) FROM file_jobs WHERE file_id = $1 AND operation = 'cleanup' AND status = 'pending'`, string(before.File.ID)); n != 0 {
		t.Errorf("re-claim left %d cleanup jobs pending", n)
	}
	// A cancel keeps the file's age: its cleanup is due when the window
	// would have closed, not 24 hours after the cancel.
	late := t3UploadOK(t, h, "cancel-age")
	h.clock.Advance(time.Hour)
	if err := h.svc.CancelUpload(context.Background(), files.CancelInput{Actor: t3Actor, Scope: t3Scope, FileID: late.File.ID}); err != nil {
		t.Fatalf("cancel: %v", err)
	}
	var due time.Time
	if err := h.pool.QueryRow(context.Background(), `SELECT next_attempt_at FROM file_jobs WHERE file_id = $1 AND operation = 'cleanup'`, string(late.File.ID)).Scan(&due); err != nil {
		t.Fatalf("cleanup job: %v", err)
	}
	if !due.Equal(late.ClaimExpiresAt) {
		t.Errorf("cleanup due %s, want the original claim deadline %s", due, late.ClaimExpiresAt)
	}
}

// Checksums follow the policy (T1-Q2): none by default, the verified SHA-256
// when a purpose requires it, and a provider output is not re-read in full
// when neither the policy nor the provider asks.
func TestChecksumFollowsThePolicy(t *testing.T) {
	specs := files.DefaultSpecs()
	for i := range specs {
		if specs[i].Purpose == files.DocumentAsset {
			specs[i].Disabled = false
		}
	}
	registry, err := files.NewRegistry(specs...)
	if err != nil {
		t.Fatal(err)
	}
	h := newFileHarness(t, localFileBackend(), &registry)

	plain := t3UploadOK(t, h, "sum-plain")
	if plain.File.ChecksumSHA256 != "" {
		t.Errorf("default policy stored checksum %q", plain.File.ChecksumSHA256)
	}
	withSum, err := t3Upload(t, h, files.DocumentAsset, t3Scope, "sum-required", "a.png", t3PNG)
	if err != nil {
		t.Fatalf("upload: %v", err)
	}
	pngSum := sha256.Sum256(t3PNG)
	if want := hex.EncodeToString(pngSum[:]); withSum.File.ChecksumSHA256 != want {
		t.Errorf("required checksum = %q, want the SHA-256 of the bytes %q", withSum.File.ChecksumSHA256, want)
	}

	ctx := context.Background()
	out, err := h.svc.RegisterProviderOutput(ctx, files.ProviderOutputInput{
		Actor: t3Actor, Purpose: files.TaskAttachment, Scope: t3Scope, OperationID: "op-no-sum", Deadline: h.clock.Now().Add(time.Hour),
	})
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	putWriteTarget(t, out.WriteTarget, append(append([]byte{}, t3PNG...), make([]byte, 128<<10)...), "image/png")
	_, before := h.store.counts()
	file, err := h.svc.CompleteProviderOutput(ctx, files.CompleteOutputInput{Actor: t3Actor, Scope: t3Scope, FileID: out.FileID, OperationID: "op-no-sum"})
	if err != nil {
		t.Fatalf("complete: %v", err)
	}
	if _, after := h.store.counts(); after != before {
		t.Errorf("completing without a checksum policy read the whole object %d times", after-before)
	}
	if file.ChecksumSHA256 != "" {
		t.Errorf("provider output stored an unrequested checksum %q", file.ChecksumSHA256)
	}

	// A required-checksum purpose on the provider path: the digest is
	// computed from the stored object, not taken from the provider.
	req, err := h.svc.RegisterProviderOutput(ctx, files.ProviderOutputInput{
		Actor: t3Actor, Purpose: files.DocumentAsset, Scope: t3Scope, OperationID: "op-sum-required", Deadline: h.clock.Now().Add(time.Hour),
	})
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	putWriteTarget(t, req.WriteTarget, t3PNG, "image/png")
	summed, err := h.svc.CompleteProviderOutput(ctx, files.CompleteOutputInput{Actor: t3Actor, Scope: t3Scope, FileID: req.FileID, OperationID: "op-sum-required"})
	if err != nil {
		t.Fatalf("complete: %v", err)
	}
	if want := hex.EncodeToString(pngSum[:]); summed.ChecksumSHA256 != want {
		t.Errorf("provider checksum = %q, want %q", summed.ChecksumSHA256, want)
	}
}

// Recording keys end in ".mp4" (LiveKit egress) and every key follows the
// spec 6.2 layout for its scope branch.
func TestObjectKeysFollowTheLayout(t *testing.T) {
	h := newFileHarness(t, localFileBackend(), nil)
	ctx := context.Background()
	out, err := h.svc.RegisterProviderOutput(ctx, files.ProviderOutputInput{
		Actor: audit.System("meetings.egress"), Purpose: files.MeetingRecording, Scope: t3Scope,
		OperationID: "EG_layout", Deadline: h.clock.Now().Add(time.Hour),
	})
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	t3UploadOK(t, h, "layout-task")
	if _, err := t3Upload(t, h, files.UserAvatar, files.Scope{UserID: t3User}, "layout-avatar", "me.png", t3PNG); err != nil {
		t.Fatalf("avatar: %v", err)
	}
	if _, err := t3Upload(t, h, files.AuditExport, files.Scope{OrganizationID: t3Org}, "layout-export", "export.csv", []byte("a,b\n1,2\n")); err != nil {
		t.Fatalf("export: %v", err)
	}
	rows, err := h.pool.Query(ctx, `SELECT f.object_key, s.purpose FROM files f JOIN file_upload_sessions s ON s.file_id = f.id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	want := map[string]string{
		"meeting_recording": "v1/orgs/" + t3Org + "/workspaces/" + t3WS + "/meetings/recordings/2026/09/" + string(out.FileID) + "/original.mp4",
		"task_attachment":   "v1/orgs/" + t3Org + "/workspaces/" + t3WS + "/tasks/attachments/2026/09/",
		"user_avatar":       "v1/users/" + t3User + "/avatars/2026/09/",
		"audit_export":      "v1/orgs/" + t3Org + "/audit/exports/2026/09/",
	}
	seen := 0
	for rows.Next() {
		var key, purpose string
		if err := rows.Scan(&key, &purpose); err != nil {
			t.Fatal(err)
		}
		seen++
		if !strings.HasPrefix(key, want[purpose]) {
			t.Errorf("%s key %q, want prefix %q", purpose, key, want[purpose])
		}
		if purpose != "meeting_recording" && !strings.HasSuffix(key, "/original") {
			t.Errorf("%s key %q has an extension", purpose, key)
		}
	}
	if seen != 4 {
		t.Errorf("saw %d keys, want 4", seen)
	}
}

// The avatar branch: NULL tenant, reachable only through the user scope; an
// organization scope or another user sees nothing.
func TestAvatarBranchIsUserBound(t *testing.T) {
	h := newFileHarness(t, localFileBackend(), nil)
	ctx := context.Background()
	up, err := t3Upload(t, h, files.UserAvatar, files.Scope{UserID: t3User}, "avatar", "me.png", t3PNG)
	if err != nil {
		t.Fatalf("upload: %v", err)
	}
	if up.File.OrganizationID != "" {
		t.Errorf("avatar organization = %q, want none", up.File.OrganizationID)
	}
	if n := fileCountRows(t, h.pool, `SELECT count(*) FROM files WHERE id = $1 AND organization_id IS NULL`, string(up.File.ID)); n != 1 {
		t.Fatal("avatar row does not carry the NULL tenant")
	}
	own, err := h.svc.ResolveMany(ctx, files.ResolveInput{Scope: files.Scope{UserID: t3User}, Mode: files.ReadPresign, FileIDs: []files.FileID{up.File.ID}})
	if err != nil || own[0].Err != nil || own[0].URL == "" {
		t.Fatalf("own avatar resolve = %+v, %v", own, err)
	}
	for _, scope := range []files.Scope{{UserID: t3UserB}, {OrganizationID: t3Org, WorkspaceID: t3WS}} {
		got, err := h.svc.ResolveMany(ctx, files.ResolveInput{Scope: scope, Mode: files.ReadPresign, FileIDs: []files.FileID{up.File.ID}})
		if err != nil {
			t.Fatalf("resolve: %v", err)
		}
		t3Code(t, got[0].Err, files.CodeNotFound)
	}
	if h.quota.reserved(up.File.ID) != 0 {
		t.Error("an account avatar was reserved against an organization quota")
	}
}

// The system actor seam (T10): a worker uploads under its own actor pair with
// the same purpose, scope and grant checks as a person, and cannot cancel
// through someone else's identity - nor can a person cancel its upload.
func TestSystemActorGoesThroughTheSameGrant(t *testing.T) {
	h := newFileHarness(t, localFileBackend(), nil)
	ctx := context.Background()
	worker := audit.System("audit.export")
	up, err := h.svc.Upload(ctx, files.UploadInput{
		Actor: worker, Purpose: files.AuditExport, Scope: files.Scope{OrganizationID: t3Org},
		IdempotencyKey: "export-1", Filename: "export.ndjson", Body: strings.NewReader("{\"a\":1}\n"),
	})
	if err != nil {
		t.Fatalf("system upload: %v", err)
	}
	if up.File.ContentType != "application/x-ndjson" {
		t.Errorf("content type = %q", up.File.ContentType)
	}
	if n := fileCountRows(t, h.pool, `SELECT count(*) FROM file_upload_sessions WHERE created_by_kind = 'system' AND created_by = 'audit.export'`); n != 1 {
		t.Error("the session does not record the system actor pair")
	}
	_, err = h.svc.Upload(ctx, files.UploadInput{
		Actor: worker, Purpose: files.AuditExport, Scope: files.Scope{OrganizationID: t3Org, WorkspaceID: t3WS},
		IdempotencyKey: "export-2", Filename: "export.ndjson", Body: strings.NewReader("{}\n"),
	})
	t3Code(t, err, files.CodeScopeInvalid)
	err = h.svc.CancelUpload(ctx, files.CancelInput{Actor: audit.User("audit.export"), Scope: files.Scope{OrganizationID: t3Org}, FileID: up.File.ID})
	t3Code(t, err, files.CodeNotFound)
	if h.quota.reserved(up.File.ID) != int64(len("{\"a\":1}\n")) {
		t.Errorf("quota reserved %d bytes for the export", h.quota.reserved(up.File.ID))
	}
}

// A quota refusal stops the upload before the bytes are stored and leaves the
// key retryable.
func TestQuotaRefusalIsRetryable(t *testing.T) {
	h := newFileHarness(t, localFileBackend(), nil)
	h.quota.err = CodedError{Code: "quota_exceeded", Status: http.StatusForbidden, Msg: "quota"}
	_, err := t3Upload(t, h, files.TaskAttachment, t3Scope, "quota", "note.png", t3PNG)
	var ce CodedError
	if !errors.As(err, &ce) || ce.Code != "quota_exceeded" {
		t.Fatalf("error = %v, want the hook's quota_exceeded", err)
	}
	if puts, _ := h.store.counts(); puts != 0 {
		t.Errorf("a refused reservation stored %d objects", puts)
	}
	h.quota.err = nil
	t3UploadOK(t, h, "quota")
}

// On an adapter that cannot sign (the local filesystem, with no Signer in
// front of it) RegisterProviderOutput answers storage_unavailable and records
// nothing (Advisor ruling D3); presign reads refuse per id the same way.
func TestProviderOutputNeedsASigner(t *testing.T) {
	h := newFileHarness(t, localFileBackend(), nil)
	h.svc.signer = h.store
	_, err := h.svc.RegisterProviderOutput(context.Background(), files.ProviderOutputInput{
		Actor: t3Actor, Purpose: files.MeetingRecording, Scope: t3Scope, OperationID: "EG_nosigner", Deadline: h.clock.Now().Add(time.Hour),
	})
	t3Code(t, err, files.CodeStorageUnavailable)
	if f, s, j := pipelineRowCounts(t, h.pool); f+s+j != 0 {
		t.Errorf("no-signer registration left rows: %d %d %d", f, s, j)
	}
}

// BE-1 (review r1): every path locks the file row before its session (FS-C1
// section 5.4). A module transaction that holds the file lock and then takes
// the session lock must not deadlock with a provider finalize on the same
// file: the finalize waits on the file, holds nothing, and completes after the
// module commits.
func TestFinalizeTakesTheFileLockFirst(t *testing.T) {
	h := newFileHarness(t, localFileBackend(), nil)
	ctx := context.Background()
	out, err := h.svc.RegisterProviderOutput(ctx, files.ProviderOutputInput{
		Actor: t3Actor, Purpose: files.TaskAttachment, Scope: t3Scope, OperationID: "op-lock-order", Deadline: h.clock.Now().Add(time.Hour),
	})
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	putWriteTarget(t, out.WriteTarget, t3PNG, "image/png")

	tx, err := h.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := db.New(h.pool).WithTx(tx)
	if _, err := q.LockFilesInIDOrder(ctx, []string{string(out.FileID)}); err != nil {
		t.Fatalf("module lock on the file: %v", err)
	}

	done := make(chan error, 1)
	go func() {
		_, err := h.svc.CompleteProviderOutput(ctx, files.CompleteOutputInput{
			Actor: t3Actor, Scope: t3Scope, FileID: out.FileID, OperationID: "op-lock-order",
		})
		done <- err
	}()
	// Give the finalize time to reach its locks; with the old order it would
	// now hold the session and wait on the file.
	time.Sleep(700 * time.Millisecond)
	if _, err := q.LockUploadSessionsByFileIDs(ctx, []string{string(out.FileID)}); err != nil {
		t.Fatalf("module lock on the session after the file: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("module commit: %v", err)
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("finalize after the module committed: %v", err)
		}
	case <-time.After(30 * time.Second):
		t.Fatal("finalize did not finish after the module released its locks")
	}
}
