package service

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/files/filescontract"
	"github.com/unicomhub/uniwork/server/internal/storage"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// fileTestClock is the controllable clock of a FileService under test. It
// starts on a whole second so the database round trip (microseconds) never
// changes an instant.
type fileTestClock struct {
	mu  sync.Mutex
	now time.Time
}

func newFileTestClock() *fileTestClock {
	return &fileTestClock{now: time.Date(2026, 9, 26, 8, 0, 0, 0, time.UTC)}
}

func (c *fileTestClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *fileTestClock) Advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(d)
}

var errTestStorageDown = errors.New("test: storage adapter is down")

// switchStore wraps a real T2 ObjectStore with a failure switch, counters, a
// hook after a stored Put, and a record of every key it wrote or signed, so a
// MinIO case can remove exactly its own objects from the shared bucket.
type switchStore struct {
	storage.ObjectStore
	mu        sync.Mutex
	down      bool
	puts      int
	fullReads int
	afterPut  func(key string)
	written   map[string]storage.ObjectLocator
}

func newSwitchStore(inner storage.ObjectStore) *switchStore {
	return &switchStore{ObjectStore: inner, written: map[string]storage.ObjectLocator{}}
}

func (s *switchStore) isDown() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.down
}

func (s *switchStore) setDown(down bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.down = down
}

func (s *switchStore) setAfterPut(hook func(key string)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.afterPut = hook
}

func (s *switchStore) counts() (puts, fullReads int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.puts, s.fullReads
}

func (s *switchStore) remember(loc storage.ObjectLocator) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.written[loc.Key] = loc
}

func (s *switchStore) Put(ctx context.Context, loc storage.ObjectLocator, body io.Reader, info storage.WriteInfo) (storage.PutResult, error) {
	if s.isDown() {
		return storage.PutResult{}, errTestStorageDown
	}
	s.remember(loc)
	res, err := s.ObjectStore.Put(ctx, loc, body, info)
	if err != nil {
		return res, err
	}
	s.mu.Lock()
	s.puts++
	hook := s.afterPut
	s.mu.Unlock()
	if hook != nil {
		hook(loc.Key)
	}
	return res, nil
}

func (s *switchStore) Open(ctx context.Context, loc storage.ObjectLocator, opts storage.ReadOptions) (*storage.Object, error) {
	if s.isDown() {
		return nil, errTestStorageDown
	}
	if opts.Offset == 0 && (opts.Length <= 0 || opts.Length > files.DetectHeadBytes) {
		s.mu.Lock()
		s.fullReads++
		s.mu.Unlock()
	}
	return s.ObjectStore.Open(ctx, loc, opts)
}

func (s *switchStore) Stat(ctx context.Context, loc storage.ObjectLocator) (storage.ObjectInfo, error) {
	if s.isDown() {
		return storage.ObjectInfo{}, errTestStorageDown
	}
	return s.ObjectStore.Stat(ctx, loc)
}

func (s *switchStore) SignRead(ctx context.Context, loc storage.ObjectLocator, opts storage.SignOptions) (storage.SignedURL, error) {
	if s.isDown() {
		return storage.SignedURL{}, errTestStorageDown
	}
	return s.ObjectStore.SignRead(ctx, loc, opts)
}

func (s *switchStore) SignWrite(ctx context.Context, loc storage.ObjectLocator, opts storage.SignOptions) (storage.SignedURL, error) {
	if s.isDown() {
		return storage.SignedURL{}, errTestStorageDown
	}
	s.remember(loc)
	return s.ObjectStore.SignWrite(ctx, loc, opts)
}

// localTestSigner stands in for presigning on the local adapter, which has no
// such capability (T2): reads get an opaque test URL, and writes get an
// httptest route that stores exactly the signed key through the adapter and
// refuses once the deadline passed on the service clock. It exercises the
// FileObjectSigner seam; the MinIO run uses the adapter's real signatures.
type localTestSigner struct {
	srv   *httptest.Server
	store *switchStore
	clock *fileTestClock
}

func newLocalTestSigner(t *testing.T, store *switchStore, clock *fileTestClock) *localTestSigner {
	sg := &localTestSigner{store: store, clock: clock}
	sg.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut {
			http.Error(w, "method", http.StatusMethodNotAllowed)
			return
		}
		exp, err := time.Parse(time.RFC3339Nano, r.URL.Query().Get("exp"))
		if err != nil || !clock.Now().Before(exp) {
			http.Error(w, "expired", http.StatusForbidden)
			return
		}
		loc := storage.ObjectLocator{Storage: storage.BackendLocal, Key: strings.TrimPrefix(r.URL.Path, "/")}
		if _, err := store.ObjectStore.Put(r.Context(), loc, r.Body, storage.WriteInfo{SizeBytes: r.ContentLength}); err != nil {
			http.Error(w, "store", http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(sg.srv.Close)
	return sg
}

func (sg *localTestSigner) SignRead(_ context.Context, loc storage.ObjectLocator, opts storage.SignOptions) (storage.SignedURL, error) {
	if sg.store.isDown() {
		return storage.SignedURL{}, errTestStorageDown
	}
	return storage.SignedURL{URL: "http://local.test/read/" + loc.Key, Method: http.MethodGet, ExpiresAt: sg.clock.Now().Add(opts.TTL)}, nil
}

func (sg *localTestSigner) SignWrite(_ context.Context, loc storage.ObjectLocator, opts storage.SignOptions) (storage.SignedURL, error) {
	if sg.store.isDown() {
		return storage.SignedURL{}, errTestStorageDown
	}
	exp := sg.clock.Now().Add(opts.TTL)
	return storage.SignedURL{
		URL:    sg.srv.URL + "/" + loc.Key + "?exp=" + exp.UTC().Format(time.RFC3339Nano),
		Method: http.MethodPut, ExpiresAt: exp,
	}, nil
}

// fileHarness is one FileService on the test database plus its controls.
type fileHarness struct {
	svc   *FileService
	pool  *pgxpool.Pool
	store *switchStore
	clock *fileTestClock
	quota *countingQuota
}

type fileBackend struct {
	name   string
	bucket string
	// build returns the T2 adapter for one case.
	build func(t *testing.T) storage.ObjectStore
	// local backends need the test signer in front of the adapter.
	local bool
}

func localFileBackend() fileBackend {
	return fileBackend{
		name:  "local",
		local: true,
		build: func(t *testing.T) storage.ObjectStore {
			return buildStore(t, storage.Config{Backend: storage.BackendLocal, Local: &storage.LocalConfig{Root: t.TempDir()}}, storage.BackendLocal)
		},
	}
}

// minioFileBackend runs against the MinIO of docker-compose.minio.yml when the
// MINIO_* variables are set (the same gate as the storage integration test).
func minioFileBackend() (fileBackend, bool) {
	for _, key := range []string{"MINIO_ENDPOINT", "MINIO_BUCKET", "MINIO_ACCESS_KEY_ID", "MINIO_SECRET_ACCESS_KEY", "MINIO_REGION"} {
		if strings.TrimSpace(os.Getenv(key)) == "" {
			return fileBackend{}, false
		}
	}
	cfg := storage.Config{Backend: storage.BackendMinIO, MinIO: &storage.MinIOConfig{
		Endpoint: os.Getenv("MINIO_ENDPOINT"), Bucket: os.Getenv("MINIO_BUCKET"), Region: os.Getenv("MINIO_REGION"),
		AccessKeyID: os.Getenv("MINIO_ACCESS_KEY_ID"), SecretAccessKey: os.Getenv("MINIO_SECRET_ACCESS_KEY"),
	}}
	return fileBackend{
		name:   "minio",
		bucket: cfg.MinIO.Bucket,
		build:  func(t *testing.T) storage.ObjectStore { return buildStore(t, cfg, storage.BackendMinIO) },
	}, true
}

func buildStore(t *testing.T, cfg storage.Config, backend storage.Backend) storage.ObjectStore {
	t.Helper()
	stores, err := storage.BuildStores(context.Background(), cfg, storage.NewDefaultRegistry())
	if err != nil {
		t.Fatalf("build %s store: %v", backend, err)
	}
	return stores[backend]
}

type countingQuota struct {
	mu    sync.Mutex
	calls map[files.FileID]int64
	total int
	err   error
}

func (c *countingQuota) ReserveFileBytes(_ context.Context, org string, id files.FileID, size int64) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.err != nil {
		return c.err
	}
	if org == "" {
		return errors.New("quota reserved for an empty organization")
	}
	c.calls[id] = size
	c.total++
	return nil
}

func (c *countingQuota) reservations() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.total
}

func (c *countingQuota) reserved(id files.FileID) int64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.calls[id]
}

func newFileHarness(t *testing.T, backend fileBackend, registry *files.Registry) *fileHarness {
	t.Helper()
	return newFileHarnessUnder(t, backend, registry, "")
}

// newFileHarnessUnder mints every key under the given environment root
// (S3_KEY_PREFIX in the "x/" form).
func newFileHarnessUnder(t *testing.T, backend fileBackend, registry *files.Registry, keyRoot string) *fileHarness {
	t.Helper()
	pool := testutil.DB(t)
	clock := newFileTestClock()
	store := newSwitchStore(backend.build(t))
	if !backend.local {
		// Remove exactly the objects this case wrote from the shared bucket.
		t.Cleanup(func() {
			store.mu.Lock()
			locs := make([]storage.ObjectLocator, 0, len(store.written))
			for _, loc := range store.written {
				locs = append(locs, loc)
			}
			store.mu.Unlock()
			for _, loc := range locs {
				if err := store.ObjectStore.Delete(context.Background(), loc); err != nil {
					t.Logf("cleanup: %v", err)
				}
			}
		})
	}
	var signer FileObjectSigner
	if backend.local {
		signer = newLocalTestSigner(t, store, clock)
	}
	quota := &countingQuota{calls: map[files.FileID]int64{}}
	svc, err := NewFileService(FileServiceOptions{
		Pool: pool, Store: store, Bucket: backend.bucket, KeyRoot: keyRoot,
		Registry: registry, Signer: signer, Quota: quota, Clock: clock.Now, SpoolDir: t.TempDir(),
	})
	if err != nil {
		t.Fatalf("NewFileService: %v", err)
	}
	return &fileHarness{svc: svc, pool: pool, store: store, clock: clock, quota: quota}
}

func (h *fileHarness) inTx(t *testing.T, fn func(q *db.Queries) error) error {
	t.Helper()
	ctx := context.Background()
	tx, err := h.pool.Begin(ctx)
	if err != nil {
		return err
	}
	if err := fn(db.New(h.pool).WithTx(tx)); err != nil {
		_ = tx.Rollback(ctx)
		return err
	}
	return tx.Commit(ctx)
}

func (h *fileHarness) contract() filescontract.Harness {
	return filescontract.Harness{
		Service:  h.svc,
		Registry: h.svc.Registry(),
		InTx:     h.inTx,
		Now:      h.clock.Now,
		Advance:  h.clock.Advance,
		WriteProviderOutput: func(t *testing.T, out files.ProviderOutput, body []byte, contentType string) {
			t.Helper()
			putWriteTarget(t, out.WriteTarget, body, contentType)
		},
		DisabledPurpose: firstDisabledPurpose(h.svc.Registry()),
		SimulateGC: func(t *testing.T, ids ...files.FileID) {
			t.Helper()
			want := make([]string, 0, len(ids))
			for _, id := range ids {
				want = append(want, string(id))
			}
			// The collector's barrier (T5) in one statement: the fake models
			// it the same way, by naming the files it would have chosen.
			if _, err := h.pool.Exec(context.Background(),
				`UPDATE files SET status = 'deleting', updated_at = now() WHERE id = ANY($1) AND status <> 'deleted'`, want); err != nil {
				t.Fatalf("simulate gc: %v", err)
			}
		},
		SetStorageDown: func(_ *testing.T, down bool) { h.store.setDown(down) },
	}
}

func putWriteTarget(t *testing.T, target files.WriteTarget, body []byte, _ string) {
	t.Helper()
	req, err := http.NewRequest(target.Method, target.URL, bytes.NewReader(body))
	if err != nil {
		t.Fatalf("provider request: %v", err)
	}
	for name, value := range target.Headers {
		req.Header.Set(name, value)
	}
	// SignWrite presigns the object key only; Content-Type is not in the
	// signature and MinIO answers 400 when it is sent anyway.
	req.ContentLength = int64(len(body))
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("provider PUT: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		// Keep the signed target out of the failure, but preserve the provider's
		// bounded response body so MinIO/setup errors are diagnosable in CI.
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<10))
		t.Fatalf("provider PUT answered %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
}

// firstDisabledPurpose names a purpose the registry refuses, or "" when every
// purpose is open (the disabled-purpose case then skips, as on filesfake).
func firstDisabledPurpose(r files.Registry) files.UploadPurpose {
	for _, spec := range r.Specs() {
		if spec.Disabled {
			return spec.Purpose
		}
	}
	return ""
}

// registryWithDisabled is DefaultSpecs with the named purposes closed.
func registryWithDisabled(t *testing.T, closed ...files.UploadPurpose) *files.Registry {
	t.Helper()
	specs := files.DefaultSpecs()
	for i := range specs {
		for _, p := range closed {
			if specs[i].Purpose == p {
				specs[i].Disabled = true
			}
		}
	}
	reg, err := files.NewRegistry(specs...)
	if err != nil {
		t.Fatal(err)
	}
	return &reg
}
