package service

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/storage"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// memProvider is a ReferenceProvider whose holds the test sets by hand. The
// real module providers are registered beside it, so the catalogue coverage
// is the production one; memProvider stands in for any module whose hold
// reason (version history, soft delete, retention, legal hold) the test needs
// to choose.
type memProvider struct {
	name     string
	purposes []files.UploadPurpose
	mu       sync.Mutex
	holds    map[files.FileID]files.HoldReason
	err      error
}

func newMemProvider(name string, purposes ...files.UploadPurpose) *memProvider {
	if len(purposes) == 0 {
		purposes = files.Purposes()
	}
	return &memProvider{name: name, purposes: purposes, holds: map[files.FileID]files.HoldReason{}}
}

func (p *memProvider) Name() string                    { return p.name }
func (p *memProvider) Purposes() []files.UploadPurpose { return p.purposes }

func (p *memProvider) HeldBy(_ context.Context, _ *db.Queries, ids []files.FileID) (map[files.FileID]files.HoldReason, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.err != nil {
		return nil, p.err
	}
	out := map[files.FileID]files.HoldReason{}
	for _, id := range ids {
		if r, ok := p.holds[id]; ok {
			out[id] = r
		}
	}
	return out, nil
}

func (p *memProvider) hold(id files.FileID, r files.HoldReason) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.holds[id] = r
}

func (p *memProvider) release(id files.FileID) {
	p.mu.Lock()
	defer p.mu.Unlock()
	delete(p.holds, id)
}

func (p *memProvider) fail(err error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.err = err
}

// gcStore puts delete failures in front of the harness store: a Delete that
// errors (timeout, permission) and a Delete that answers nil but keeps the
// bytes (an Object Lock hold, a delete marker). versioned makes it report a
// versioned bucket - the capability the collector must honour by deleting
// only a recorded version - with statVersion as the version Stat reports.
type gcStore struct {
	*switchStore
	mu          sync.Mutex
	deleteErr   error
	phantom     bool
	deletes     int
	versioned   bool
	statVersion string
	deleted     []string // the Version of every Delete that reached storage
}

func (s *gcStore) Capabilities() storage.Capabilities {
	caps := s.switchStore.Capabilities()
	s.mu.Lock()
	defer s.mu.Unlock()
	caps.VersionedObjects = s.versioned
	return caps
}

// Stat and Delete strip the version before the local adapter, which has no
// versions and refuses a locator that names one: the versioned bucket is
// simulated here, and what the collector asked for is recorded.
func (s *gcStore) Stat(ctx context.Context, loc storage.ObjectLocator) (storage.ObjectInfo, error) {
	loc.Version = ""
	info, err := s.switchStore.Stat(ctx, loc)
	s.mu.Lock()
	defer s.mu.Unlock()
	if err == nil && s.versioned {
		info.VersionID = s.statVersion
	}
	return info, err
}

func (s *gcStore) setVersioned(versioned bool, statVersion string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.versioned, s.statVersion = versioned, statVersion
}

func (s *gcStore) deletedVersions() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.deleted...)
}

func (s *gcStore) Delete(ctx context.Context, loc storage.ObjectLocator) error {
	s.mu.Lock()
	err, phantom := s.deleteErr, s.phantom
	if err == nil {
		s.deletes++
		s.deleted = append(s.deleted, loc.Version)
	}
	s.mu.Unlock()
	if err != nil {
		return err
	}
	if phantom {
		return nil
	}
	loc.Version = ""
	return s.switchStore.ObjectStore.Delete(ctx, loc)
}

func (s *gcStore) setDelete(err error, phantom bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.deleteErr, s.phantom = err, phantom
}

// gcHarness is a FileService with the collector wired: the production
// provider set plus memProvider, on the local adapter and the test database.
type gcHarness struct {
	*fileHarness
	mem *memProvider
	gcs *gcStore
}

type gcOption func(*FileServiceOptions)

func withProviders(ps ...files.ReferenceProvider) gcOption {
	return func(o *FileServiceOptions) { o.ReferenceProviders = ps }
}

func productionProviders() []files.ReferenceProvider {
	return []files.ReferenceProvider{
		NewTaskAttachmentProvider(), NewUserAvatarProvider(), chatFileReferenceProvider{},
		chatVoiceRecordingProvider{}, MeetingRecordingProvider{}, AuditExportReferenceProvider(),
		DocumentVersionReferenceProvider{}, DocumentAssetReferenceProvider{},
	}
}

func newGCHarness(t *testing.T, mode FileGCMode, opts ...gcOption) *gcHarness {
	t.Helper()
	base := newFileHarness(t, localFileBackend(), nil)
	mem := newMemProvider("test.holds")
	gcs := &gcStore{switchStore: base.store}
	o := FileServiceOptions{
		Pool: base.pool, Store: gcs, Signer: base.svc.signer, Clock: base.clock.Now, SpoolDir: t.TempDir(),
		ReferenceProviders: append(productionProviders(), mem),
		GC:                 FileGCConfig{Mode: mode},
	}
	for _, opt := range opts {
		opt(&o)
	}
	svc, err := NewFileService(o)
	if err != nil {
		t.Fatalf("NewFileService: %v", err)
	}
	base.svc = svc
	return &gcHarness{fileHarness: base, mem: mem, gcs: gcs}
}

func (h *gcHarness) sweep(t *testing.T) *FileGCReport {
	t.Helper()
	rep, err := h.svc.SweepFiles(context.Background())
	if err != nil {
		t.Fatalf("sweep: %v", err)
	}
	return rep
}

// toNextSlot moves the clock to the next schedule slot, where the daily
// sweep would run.
func (h *gcHarness) toNextSlot() {
	now := h.clock.Now()
	h.clock.Advance(h.svc.gc.nextRun(now).Sub(now))
}

// until moves the clock to at, if at is later.
func (h *gcHarness) until(at time.Time) {
	if d := at.Sub(h.clock.Now()); d > 0 {
		h.clock.Advance(d)
	}
}

func (h *gcHarness) file(t *testing.T, id files.FileID) db.File {
	t.Helper()
	row, err := h.svc.q.GetFileByID(context.Background(), string(id))
	if err != nil {
		t.Fatalf("file %s: %v", id, err)
	}
	return row
}

func (h *gcHarness) jobs(t *testing.T, id files.FileID, op string) []db.FileJob {
	t.Helper()
	all, err := h.svc.q.ListFileJobsByFile(context.Background(), string(id))
	if err != nil {
		t.Fatalf("jobs %s: %v", id, err)
	}
	var out []db.FileJob
	for _, j := range all {
		if j.Operation == op {
			out = append(out, j)
		}
	}
	return out
}

// liveJob is the one pending or leased job of op for the file.
func (h *gcHarness) liveJob(t *testing.T, id files.FileID, op string) db.FileJob {
	t.Helper()
	for _, j := range h.jobs(t, id, op) {
		if j.Status == "pending" || j.Status == "leased" {
			return j
		}
	}
	t.Fatalf("file %s has no live %s job", id, op)
	return db.FileJob{}
}

func (h *gcHarness) objectExists(t *testing.T, row db.File) bool {
	t.Helper()
	loc := locator(row)
	loc.Version = "" // the local adapter has no versions (see gcStore)
	_, err := h.store.ObjectStore.Stat(context.Background(), loc)
	if errors.Is(err, storage.ErrNotFound) {
		return false
	}
	if err != nil {
		t.Fatalf("stat %s: %v", row.ID, err)
	}
	return true
}

func (h *gcHarness) wantStatus(t *testing.T, id files.FileID, want files.Status) db.File {
	t.Helper()
	row := h.file(t, id)
	if files.Status(row.Status) != want {
		t.Fatalf("file %s status = %s, want %s", id, row.Status, want)
	}
	return row
}

// tx runs fn in a transaction that fn may also use for raw SQL.
func (h *gcHarness) tx(t *testing.T, fn func(tx pgx.Tx, q *db.Queries) error) error {
	t.Helper()
	ctx := context.Background()
	tx, err := h.pool.Begin(ctx)
	if err != nil {
		return err
	}
	if err := fn(tx, db.New(h.pool).WithTx(tx)); err != nil {
		_ = tx.Rollback(ctx)
		return err
	}
	return tx.Commit(ctx)
}

// releaseT3 releases files through the pipeline's own ReleaseInTx.
func (h *gcHarness) releaseT3(t *testing.T, ids ...files.FileID) {
	t.Helper()
	if err := h.inTx(t, func(q *db.Queries) error { return h.svc.ReleaseInTx(context.Background(), q, ids) }); err != nil {
		t.Fatalf("release: %v", err)
	}
}

// claimedAndReleased is the common setup: an uploaded task file, claimed and
// held by memProvider, then released at the given offset from ready.
func (h *gcHarness) claimedAndReleased(t *testing.T, key string, after time.Duration) files.FileID {
	t.Helper()
	up := t3UploadOK(t, h.fileHarness, key)
	if _, err := t3Claim(t, h.fileHarness, up.File.ID); err != nil {
		t.Fatalf("claim: %v", err)
	}
	h.mem.hold(up.File.ID, files.HoldActive)
	h.clock.Advance(after)
	h.mem.release(up.File.ID)
	h.releaseT3(t, up.File.ID)
	return up.File.ID
}

// entry finds the report line for a file.
func entry(t *testing.T, rep *FileGCReport, id files.FileID, op string) FileGCEntry {
	t.Helper()
	for i := len(rep.Entries) - 1; i >= 0; i-- {
		e := rep.Entries[i]
		if e.FileID == id && e.Operation == op {
			return e
		}
	}
	t.Fatalf("report has no %s entry for %s: %+v", op, id, rep.Entries)
	return FileGCEntry{}
}

// waitForLockWaiter blocks until some backend waits on a row lock, so a
// barrier test knows its second actor is really parked behind the first.
// It watches on a connection of its own: at that moment the sweep and the
// open claim transaction already hold pool connections, and pgxpool sizes
// itself to max(4, NumCPU), so on a small CI runner borrowing from h.pool
// would wait forever behind the lock it is looking for.
func (h *gcHarness) waitForLockWaiter(t *testing.T) {
	t.Helper()
	ctx := context.Background()
	conn, err := pgx.ConnectConfig(ctx, h.pool.Config().ConnConfig.Copy())
	if err != nil {
		t.Fatalf("lock watcher connection: %v", err)
	}
	defer func() { _ = conn.Close(ctx) }()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		var n int
		if err := conn.QueryRow(ctx,
			`SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`).Scan(&n); err != nil {
			t.Fatalf("pg_stat_activity: %v", err)
		}
		if n > 0 {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("no backend ever waited on the lock")
}
