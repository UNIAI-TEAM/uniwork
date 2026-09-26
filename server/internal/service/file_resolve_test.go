package service

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/storage"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// T4 read path on the real service, the test database and the local adapter
// (the contract suite covers the shared resolve/open cases on Local, MinIO
// and filesfake; these are the plan section 4 T4 checks it does not reach).

// presignRegistry turns task description images into a presign purpose, so an
// organization file can exercise the presign caps without a recording.
func presignRegistry(t *testing.T) *files.Registry {
	t.Helper()
	specs := files.DefaultSpecs()
	for i := range specs {
		if specs[i].Purpose == files.TaskDescriptionImage {
			specs[i].Policy.ReadMode = files.ReadPresign
		}
	}
	reg, err := files.NewRegistry(specs...)
	if err != nil {
		t.Fatalf("registry: %v", err)
	}
	return &reg
}

func t4Upload(t *testing.T, h *fileHarness, purpose files.UploadPurpose, scope files.Scope, key string) files.Upload {
	t.Helper()
	up, err := t3Upload(t, h, purpose, scope, key, "anh.png", t3PNG)
	if err != nil {
		t.Fatalf("upload %s: %v", key, err)
	}
	return up
}

func t4ClaimAs(t *testing.T, h *fileHarness, purpose files.UploadPurpose, scope files.Scope, ids ...files.FileID) {
	t.Helper()
	if err := h.inTx(t, func(q *db.Queries) error {
		_, err := h.svc.ClaimInTx(context.Background(), q, files.ClaimInput{Actor: t3Actor, Purpose: purpose, Scope: scope, FileIDs: ids})
		return err
	}); err != nil {
		t.Fatalf("claim: %v", err)
	}
}

// capSigner reports a credential expiry of its own and can fail or sign to
// nothing, like an adapter with a temporary credential or none at all.
type capSigner struct {
	credential time.Time
	err        error
	empty      bool
	lastTTL    time.Duration
}

func (c *capSigner) SignRead(_ context.Context, loc storage.ObjectLocator, opts storage.SignOptions) (storage.SignedURL, error) {
	c.lastTTL = opts.TTL
	if c.err != nil {
		return storage.SignedURL{}, c.err
	}
	if c.empty {
		return storage.SignedURL{Method: "GET"}, nil
	}
	return storage.SignedURL{URL: "https://consumer.example/bucket/" + loc.Key + "?X-Sig=1", Method: "GET", ExpiresAt: c.credential}, nil
}

func (c *capSigner) SignWrite(context.Context, storage.ObjectLocator, storage.SignOptions) (storage.SignedURL, error) {
	return storage.SignedURL{}, errors.New("not used")
}

func TestResolveKeepsOrderDuplicatesAndPerIDErrors(t *testing.T) {
	h := newFileHarness(t, localFileBackend(), nil)
	ctx := context.Background()
	a := t3UploadOK(t, h, "order-a")
	b := t3UploadOK(t, h, "order-b")
	gone := t3UploadOK(t, h, "order-gone")
	h.contract().SimulateGC(t, gone.File.ID)

	ids := []files.FileID{b.File.ID, "01J8ZQMISSING0000000000000", a.File.ID, gone.File.ID, b.File.ID}
	got, err := h.svc.ResolveMany(ctx, files.ResolveInput{Scope: t3Scope, Mode: files.ReadProxy, FileIDs: ids})
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if len(got) != len(ids) {
		t.Fatalf("entries = %d, want one per requested id (%d)", len(got), len(ids))
	}
	if got[0].File.ID != b.File.ID || got[2].File.ID != a.File.ID || got[4].File.ID != b.File.ID {
		t.Fatalf("entries out of request order: %+v", got)
	}
	t3Code(t, got[1].Err, files.CodeNotFound)
	t3Code(t, got[3].Err, files.CodeDeleting)
	for i, r := range got {
		if r.URL != "" {
			t.Errorf("entry %d: proxy mode returned a URL", i)
		}
		if r.Err != nil && (r.File.ID != "" || r.URL != "") {
			t.Errorf("entry %d: a refused id still carries a view or URL", i)
		}
	}
	if got[0].File.Filename != "note.png" {
		t.Errorf("display name = %q, want the shared filename", got[0].File.Filename)
	}
}

func TestResolveIsolatesTenantsWorkspacesAndTheAvatarBranch(t *testing.T) {
	h := newFileHarness(t, localFileBackend(), nil)
	ctx := context.Background()
	orgFile := t3UploadOK(t, h, "iso-org")
	avatar := t4Upload(t, h, files.UserAvatar, files.Scope{UserID: t3User}, "iso-avatar")

	refused := []struct {
		name  string
		scope files.Scope
		mode  files.ReadMode
		id    files.FileID
	}{
		{"other organization guessing the id", files.Scope{OrganizationID: t3OrgB, WorkspaceID: t3WS}, files.ReadProxy, orgFile.File.ID},
		{"same organization, other workspace", files.Scope{OrganizationID: t3Org, WorkspaceID: "01J8ZQ0K7V9W1Y2X3Z4A5B6OTH"}, files.ReadProxy, orgFile.File.ID},
		{"tenant query never reaches a NULL-tenant avatar", t3Scope, files.ReadPresign, avatar.File.ID},
		{"org-only scope never reaches a NULL-tenant avatar", files.Scope{OrganizationID: t3Org}, files.ReadPresign, avatar.File.ID},
		{"identity branch never reaches a tenant file", files.Scope{UserID: t3User}, files.ReadProxy, orgFile.File.ID},
		{"another user's avatar", files.Scope{UserID: t3UserB}, files.ReadPresign, avatar.File.ID},
		{"an empty scope reaches nothing", files.Scope{}, files.ReadProxy, orgFile.File.ID},
	}
	for _, tc := range refused {
		got, err := h.svc.ResolveMany(ctx, files.ResolveInput{Scope: tc.scope, Mode: tc.mode, FileIDs: []files.FileID{tc.id}})
		if err != nil {
			t.Fatalf("%s: %v", tc.name, err)
		}
		t3Code(t, got[0].Err, files.CodeNotFound)
		if _, err := h.svc.Open(ctx, files.OpenInput{Scope: tc.scope, FileID: tc.id}); err == nil {
			t.Errorf("%s: Open served the file", tc.name)
		} else {
			t3Code(t, err, files.CodeNotFound)
		}
	}
}

func TestResolveSessionStatesAreRefusedPerID(t *testing.T) {
	h := newFileHarness(t, localFileBackend(), nil)
	ctx := context.Background()
	canceled := t3UploadOK(t, h, "state-canceled")
	if err := h.svc.CancelUpload(ctx, files.CancelInput{Actor: t3Actor, Scope: t3Scope, FileID: canceled.File.ID}); err != nil {
		t.Fatalf("cancel: %v", err)
	}
	staged := t3UploadOK(t, h, "state-staged")
	claimed := t3UploadOK(t, h, "state-claimed")
	t4ClaimAs(t, h, files.TaskAttachment, t3Scope, claimed.File.ID)

	h.clock.Advance(files.ClaimTTL)
	got, err := h.svc.ResolveMany(ctx, files.ResolveInput{Scope: t3Scope, Mode: files.ReadProxy,
		FileIDs: []files.FileID{canceled.File.ID, staged.File.ID, claimed.File.ID}})
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	t3Code(t, got[0].Err, files.CodeUploadCanceled)
	t3Code(t, got[1].Err, files.CodeClaimExpired)
	if got[2].Err != nil {
		t.Fatalf("a claimed file has no claim window: %v", got[2].Err)
	}
	if _, err := h.svc.Open(ctx, files.OpenInput{Scope: t3Scope, FileID: staged.File.ID}); err == nil {
		t.Fatal("Open served a file past its claim window")
	}
}

func TestResolveModeMismatchFailsTheWholeBatch(t *testing.T) {
	h := newFileHarness(t, localFileBackend(), nil)
	up := t3UploadOK(t, h, "mode")
	got, err := h.svc.ResolveMany(context.Background(), files.ResolveInput{Scope: t3Scope, Mode: files.ReadPresign, FileIDs: []files.FileID{up.File.ID}})
	if !errors.Is(err, files.ErrModeMismatch) || got != nil {
		t.Fatalf("resolve = %+v, %v; want ErrModeMismatch and no entries", got, err)
	}
}

func TestPresignTTLIsCappedByTwelveHoursClaimWindowAndCredential(t *testing.T) {
	h := newFileHarness(t, localFileBackend(), presignRegistry(t))
	ctx := context.Background()
	sg := &capSigner{}
	h.svc.signer = sg
	resolve := func(id files.FileID) files.Resolved {
		t.Helper()
		got, err := h.svc.ResolveMany(ctx, files.ResolveInput{Scope: t3Scope, Mode: files.ReadPresign, Disposition: files.DispositionInline, FileIDs: []files.FileID{id}})
		if err != nil {
			t.Fatalf("resolve: %v", err)
		}
		return got[0]
	}

	claimed := t4Upload(t, h, files.TaskDescriptionImage, t3Scope, "ttl-claimed")
	t4ClaimAs(t, h, files.TaskDescriptionImage, t3Scope, claimed.File.ID)
	staged := t4Upload(t, h, files.TaskDescriptionImage, t3Scope, "ttl-staged")
	now := h.clock.Now()

	r := resolve(claimed.File.ID)
	if r.Err != nil || !r.URLExpiresAt.Equal(now.Add(files.MaxResolveURLTTL)) || sg.lastTTL != files.MaxResolveURLTTL {
		t.Fatalf("claimed: expires %v ttl %v err %v; want 12h", r.URLExpiresAt, sg.lastTTL, r.Err)
	}
	// The URL is used exactly as signed: consumer host and path, no rewrite.
	if !strings.HasPrefix(r.URL, "https://consumer.example/bucket/v1/orgs/"+t3Org+"/") {
		t.Fatalf("signed URL was rewritten: %q", r.URL)
	}

	// 20h later the staged file has 4h of claim window left: the URL stops then.
	h.clock.Advance(20 * time.Hour)
	now = h.clock.Now()
	r = resolve(staged.File.ID)
	if r.Err != nil || !r.URLExpiresAt.Equal(staged.ClaimExpiresAt) || sg.lastTTL != staged.ClaimExpiresAt.Sub(now) {
		t.Fatalf("staged: expires %v ttl %v err %v; want the claim window %v", r.URLExpiresAt, sg.lastTTL, r.Err, staged.ClaimExpiresAt)
	}

	// A temporary credential that ends in 30 minutes caps the URL.
	sg.credential = now.Add(30 * time.Minute)
	if r = resolve(claimed.File.ID); r.Err != nil || !r.URLExpiresAt.Equal(sg.credential) {
		t.Fatalf("credential cap: expires %v err %v; want %v", r.URLExpiresAt, r.Err, sg.credential)
	}

	// An already expired credential, a signing error and an empty signature
	// are storage_unavailable with no URL - never a public or unsigned one.
	for name, set := range map[string]func(){
		"expired credential": func() { *sg = capSigner{credential: now.Add(-time.Second)} },
		"signing error":      func() { *sg = capSigner{err: errors.New("sts down")} },
		"empty signature":    func() { *sg = capSigner{empty: true} },
	} {
		set()
		r = resolve(claimed.File.ID)
		t3Code(t, r.Err, files.CodeStorageUnavailable)
		if r.URL != "" || !r.URLExpiresAt.IsZero() {
			t.Errorf("%s: a URL survived the failure: %q", name, r.URL)
		}
	}
}

func TestPresignDispositionComesFromTheSharedFilename(t *testing.T) {
	h := newFileHarness(t, localFileBackend(), presignRegistry(t))
	up := t4Upload(t, h, files.TaskDescriptionImage, t3Scope, "cd")
	var seen []string
	h.svc.signer = signerFunc(func(opts storage.SignOptions) { seen = append(seen, opts.Disposition) })
	for _, d := range []files.Disposition{files.DispositionInline, files.DispositionAttachment} {
		if _, err := h.svc.ResolveMany(context.Background(), files.ResolveInput{Scope: t3Scope, Mode: files.ReadPresign, Disposition: d, FileIDs: []files.FileID{up.File.ID}}); err != nil {
			t.Fatalf("resolve: %v", err)
		}
	}
	if len(seen) != 2 || !strings.HasPrefix(seen[0], `inline; filename="anh.png"`) || !strings.HasPrefix(seen[1], `attachment; filename="anh.png"`) {
		t.Fatalf("dispositions = %q", seen)
	}
}

type signerFunc func(storage.SignOptions)

func (f signerFunc) SignRead(_ context.Context, _ storage.ObjectLocator, opts storage.SignOptions) (storage.SignedURL, error) {
	f(opts)
	return storage.SignedURL{URL: "https://consumer.example/x", Method: "GET"}, nil
}

func (f signerFunc) SignWrite(context.Context, storage.ObjectLocator, storage.SignOptions) (storage.SignedURL, error) {
	return storage.SignedURL{}, errors.New("not used")
}

// queryCounter counts statements on one pool, so the batch rule is measured
// instead of assumed.
type queryCounter struct{ n atomic.Int64 }

func (c *queryCounter) TraceQueryStart(ctx context.Context, _ *pgx.Conn, _ pgx.TraceQueryStartData) context.Context {
	c.n.Add(1)
	return ctx
}

func (c *queryCounter) TraceQueryEnd(context.Context, *pgx.Conn, pgx.TraceQueryEndData) {}

func countingPool(t *testing.T, base *pgxpool.Pool) (*pgxpool.Pool, *queryCounter) {
	t.Helper()
	cfg := base.Config()
	counter := &queryCounter{}
	cfg.ConnConfig.Tracer = counter
	pool, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		t.Fatalf("counting pool: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool, counter
}

func TestResolveManyIsOneQueryPerBatch(t *testing.T) {
	h := newFileHarness(t, localFileBackend(), nil)
	ctx := context.Background()
	var ids []files.FileID
	for i := 0; i < 12; i++ {
		ids = append(ids, t3UploadOK(t, h, "batch-"+string(rune('a'+i))).File.ID)
	}
	avatarIDs := []files.FileID{
		t4Upload(t, h, files.UserAvatar, files.Scope{UserID: t3User}, "batch-av1").File.ID,
		t4Upload(t, h, files.UserAvatar, files.Scope{UserID: t3User}, "batch-av2").File.ID,
	}
	pool, counter := countingPool(t, h.pool)
	h.svc.q = db.New(pool)

	for _, tc := range []struct {
		scope files.Scope
		mode  files.ReadMode
		ids   []files.FileID
	}{
		{t3Scope, files.ReadProxy, ids[:1]},
		{t3Scope, files.ReadProxy, ids},
		{files.Scope{UserID: t3User}, files.ReadPresign, avatarIDs},
	} {
		counter.n.Store(0)
		got, err := h.svc.ResolveMany(ctx, files.ResolveInput{Scope: tc.scope, Mode: tc.mode, FileIDs: tc.ids})
		if err != nil {
			t.Fatalf("resolve: %v", err)
		}
		for i, r := range got {
			if r.Err != nil {
				t.Fatalf("entry %d: %v", i, r.Err)
			}
		}
		if n := counter.n.Load(); n != 1 {
			t.Fatalf("%d ids took %d queries, want 1", len(tc.ids), n)
		}
	}
}

func TestOpenStreamsWindowsAndPastTheEnd(t *testing.T) {
	h := newFileHarness(t, localFileBackend(), nil)
	ctx := context.Background()
	up := t3UploadOK(t, h, "open")
	rd, err := h.svc.Open(ctx, files.OpenInput{Scope: t3Scope, FileID: up.File.ID, Offset: 2, Length: 4})
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	b, _ := io.ReadAll(rd.Body)
	_ = rd.Close()
	if string(b) != string(t3PNG[2:6]) {
		t.Fatalf("window = %q, want %q", b, t3PNG[2:6])
	}
	rd, err = h.svc.Open(ctx, files.OpenInput{Scope: t3Scope, FileID: up.File.ID, Offset: int64(len(t3PNG))})
	if err != nil {
		t.Fatalf("open past end: %v", err)
	}
	if b, _ = io.ReadAll(rd.Body); len(b) != 0 {
		t.Fatalf("past the end read %d bytes", len(b))
	}
	_ = rd.Close()
	if _, err := h.svc.Open(ctx, files.OpenInput{Scope: t3Scope, FileID: up.File.ID, Offset: -1}); err == nil {
		t.Fatal("negative offset accepted")
	}
	h.store.setDown(true)
	if _, err := h.svc.Open(ctx, files.OpenInput{Scope: t3Scope, FileID: up.File.ID}); err == nil {
		t.Fatal("Open succeeded with storage down")
	} else {
		t3Code(t, err, files.CodeStorageUnavailable)
	}
}

// On MinIO the URL is the adapter's real signature: it names the endpoint the
// adapter was configured with (the consumer host), fetches the exact bytes and
// lives 12 hours for a claimed file. Skips without the MINIO_* variables.
func TestPresignOnMinIOSignsTheConsumerHost(t *testing.T) {
	backend, ok := minioFileBackend()
	if !ok {
		t.Skip("MINIO_* is not set; start MinIO with `docker compose -f docker-compose.minio.yml up -d minio`")
	}
	h := newFileHarness(t, backend, nil)
	ctx := context.Background()
	up := t4Upload(t, h, files.UserAvatar, files.Scope{UserID: t3User}, "minio-avatar")
	got, err := h.svc.ResolveMany(ctx, files.ResolveInput{Scope: files.Scope{UserID: t3User}, Mode: files.ReadPresign, Disposition: files.DispositionAttachment, FileIDs: []files.FileID{up.File.ID}})
	if err != nil || got[0].Err != nil {
		t.Fatalf("resolve: %v %v", err, got[0].Err)
	}
	signed, err := url.Parse(got[0].URL)
	if err != nil {
		t.Fatalf("signed URL: %v", err)
	}
	endpoint, _ := url.Parse(os.Getenv("MINIO_ENDPOINT"))
	if signed.Host != endpoint.Host {
		t.Fatalf("signed host = %q, want the configured endpoint %q", signed.Host, endpoint.Host)
	}
	if !strings.Contains(signed.RawQuery, "response-content-disposition=attachment") {
		t.Fatalf("signature does not carry the disposition")
	}
	// Staged avatar: the claim window (24h) is longer than 12h, so 12h wins.
	if want := h.clock.Now().Add(files.MaxResolveURLTTL); !got[0].URLExpiresAt.Equal(want) {
		t.Fatalf("expires %v, want %v", got[0].URLExpiresAt, want)
	}
	res, err := http.Get(got[0].URL)
	if err != nil {
		t.Fatalf("GET signed URL: %v", err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	if res.StatusCode != http.StatusOK || !bytes.Equal(body, t3PNG) {
		t.Fatalf("signed GET = %d, %d bytes", res.StatusCode, len(body))
	}
}
