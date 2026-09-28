package service

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/files/filesfake"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// G1-03 (UNI-677) test harness: one DocumentService wired to a FileService
// and the quota gate, built per backend. Every storage test runs on
// filesfake (the Gate A0 double that passes filescontract) and on the real
// FileService with the local adapter and, when MINIO_* is set, MinIO - the
// same behaviour on every implementation that passes the contract.

type docStorageEnv struct {
	name  string
	f     *docPermFixture
	tn    docTenant
	svc   *DocumentService
	fs    files.Service
	ent   *EntitlementService
	fake  *filesfake.Fake // fake backend only
	real  *FileService    // real backends only
	clock *fileTestClock  // real backends only
}

// documentsOpenRegistry is DefaultSpecs with the Document purposes open, so
// the real FileService serves them whatever the default says.
func documentsOpenRegistry(t *testing.T) *files.Registry {
	t.Helper()
	specs := files.DefaultSpecs()
	for i := range specs {
		if specs[i].Purpose == files.DocumentFile || specs[i].Purpose == files.DocumentAsset {
			specs[i].Disabled = false
		}
	}
	reg, err := files.NewRegistry(specs...)
	if err != nil {
		t.Fatal(err)
	}
	return &reg
}

func newDocPermFixtureOn(pool *pgxpool.Pool) *docPermFixture {
	q := db.New(pool)
	return &docPermFixture{
		ctx:  context.Background(),
		pool: pool,
		q:    q,
		as:   NewAuthService(pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil),
		svc:  newDocumentServiceForTest(pool, q),
	}
}

func (e *docStorageEnv) wire(t *testing.T, fs files.Service) {
	t.Helper()
	e.fs = fs
	e.ent = NewEntitlementService(e.f.pool, e.f.q)
	e.svc = e.f.svc
	e.svc.SetFiles(fs)
	e.svc.SetEntitlements(e.ent)
	e.svc.store.spoolDir = t.TempDir()
	e.tn = e.f.tenant(t, "g103"+strings.ToLower(util.NewID()[20:]))
}

func newFakeDocStorageEnv(t *testing.T) *docStorageEnv {
	t.Helper()
	env := &docStorageEnv{name: "fake", f: newDocPermFixtureOn(testutil.DB(t))}
	env.fake = filesfake.New(filesfake.Options{})
	env.wire(t, env.fake)
	return env
}

func newRealDocStorageEnv(t *testing.T, backend fileBackend) *docStorageEnv {
	t.Helper()
	base := newFileHarness(t, backend, nil)
	env := &docStorageEnv{name: backend.name, f: newDocPermFixtureOn(base.pool), clock: base.clock}
	ent := NewEntitlementService(base.pool, db.New(base.pool))
	svc, err := NewFileService(FileServiceOptions{
		Pool: base.pool, Store: base.store, Bucket: backend.bucket, Registry: documentsOpenRegistry(t),
		Signer: base.svc.signer, Quota: ent, Clock: base.clock.Now, SpoolDir: t.TempDir(),
		ReferenceProviders: productionProviders(), GC: FileGCConfig{Mode: FileGCDestructive},
	})
	if err != nil {
		t.Fatalf("NewFileService: %v", err)
	}
	env.real = svc
	env.wire(t, svc)
	env.ent = ent
	env.svc.SetEntitlements(ent)
	return env
}

// forEachDocStorageBackend runs body on the fake, the local adapter and MinIO.
func forEachDocStorageBackend(t *testing.T, body func(t *testing.T, env *docStorageEnv)) {
	t.Run("fake", func(t *testing.T) { body(t, newFakeDocStorageEnv(t)) })
	t.Run("local", func(t *testing.T) { body(t, newRealDocStorageEnv(t, localFileBackend())) })
	t.Run("minio", func(t *testing.T) {
		backend, ok := minioFileBackend()
		if !ok {
			t.Skip("MINIO_* is not set; start MinIO with `docker compose -f docker-compose.minio.yml up -d minio`")
		}
		body(t, newRealDocStorageEnv(t, backend))
	})
}

// realOnly runs body on the real backends only (quota hook, session rows,
// the collector).
func realOnly(t *testing.T, env *docStorageEnv) {
	t.Helper()
	if env.real == nil {
		t.Skip("needs the real FileService")
	}
}

// Bodies. Each one carries a unique marker so two uploads never share a
// checksum unless the test says so.

func pdfBody(marker string) []byte {
	return []byte("%PDF-1.7\n% " + marker + "\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n")
}

func sizedPDF(marker string, size int) []byte {
	b := pdfBody(marker)
	if pad := size - len(b); pad > 0 {
		b = append(b[:len(b)-6], append(bytes.Repeat([]byte("x"), pad), []byte("%%EOF\n")...)...)
	}
	return b
}

func docxBody(t *testing.T, marker string) []byte {
	t.Helper()
	return docxLike(t, "word/document.xml", "word/"+marker+".xml")
}

// docxLike is an OOXML package with the content types, the relationships and
// the named word/ parts.
func docxLike(t *testing.T, parts ...string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, name := range append([]string{"[Content_Types].xml", "_rels/.rels"}, parts...) {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write([]byte("<x>" + name + "</x>")); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func readBytes(t *testing.T, r io.Reader) []byte {
	t.Helper()
	b, err := io.ReadAll(r)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func pgInt4(v int32) pgtype.Int4 { return pgtype.Int4{Int32: v, Valid: true} }

func pgText(v string) pgtype.Text { return pgtype.Text{String: v, Valid: true} }

func pngBody(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	img.Set(0, 0, color.RGBA{G: 200, A: 255})
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func sha(b []byte) string {
	s := sha256.Sum256(b)
	return hex.EncodeToString(s[:])
}

func (e *docStorageEnv) createFile(t *testing.T, actor Actor, name string, body []byte) DocumentFileResult {
	t.Helper()
	res, err := e.svc.CreateFileDocument(context.Background(), actor, e.tn.wsA, CreateFileDocumentInput{
		Title: "Báo cáo " + name, Filename: name, Body: bytes.NewReader(body),
	})
	if err != nil {
		t.Fatalf("create file document %s: %v", name, err)
	}
	return res
}

func (e *docStorageEnv) upload(t *testing.T, actor Actor, docID, name string, body []byte) DocumentUpload {
	t.Helper()
	up, err := e.svc.UploadDocumentFile(context.Background(), actor, docID, DocumentUploadInput{Filename: name, Body: bytes.NewReader(body)})
	if err != nil {
		t.Fatalf("upload %s: %v", name, err)
	}
	return up
}

func (e *docStorageEnv) commit(actor Actor, docID, uploadID string, base int64, key string) (DocumentFileResult, error) {
	return e.svc.CommitFileVersion(context.Background(), actor, docID, CommitFileVersionInput{
		UploadID: uploadID, BaseRevision: base, IdempotencyKey: key,
	})
}

func (e *docStorageEnv) doc(t *testing.T, id string) db.Document {
	t.Helper()
	d, err := e.f.q.GetDocumentByID(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	return d
}

func (e *docStorageEnv) versions(t *testing.T, d db.Document) []db.DocumentVersion {
	t.Helper()
	vs, err := e.f.q.ListDocumentVersions(context.Background(), db.ListDocumentVersionsParams{
		OrganizationID: d.OrganizationID, WorkspaceID: d.WorkspaceID, DocumentID: d.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	return vs
}

func (e *docStorageEnv) usage(t *testing.T) int64 {
	t.Helper()
	n, err := e.f.q.CountStorageBytesInOrganization(context.Background(), e.tn.orgID)
	if err != nil {
		t.Fatal(err)
	}
	return n
}

func (e *docStorageEnv) setStorageLimit(t *testing.T, limit int64) {
	t.Helper()
	if _, err := e.f.pool.Exec(context.Background(),
		`UPDATE subscriptions SET overrides = jsonb_build_object('storage.bytes', $1::bigint) WHERE organization_id = $2`,
		limit, e.tn.orgID); err != nil {
		t.Fatal(err)
	}
}

// sessionStatus reads the upload session behind a file (real backends).
func (e *docStorageEnv) sessionStatus(t *testing.T, id string) string {
	t.Helper()
	var status string
	if err := e.f.pool.QueryRow(context.Background(),
		`SELECT status FROM file_upload_sessions WHERE file_id = $1`, id).Scan(&status); err != nil {
		t.Fatalf("session of %s: %v", id, err)
	}
	return status
}

func (e *docStorageEnv) read(t *testing.T, actor Actor, docID string, version int32, rng DocumentByteRange) []byte {
	t.Helper()
	dl, err := e.svc.OpenDocumentFile(context.Background(), actor, docID, version, rng)
	if err != nil {
		t.Fatalf("open %s v%d: %v", docID, version, err)
	}
	defer func() { _ = dl.Reader.Close() }()
	b, err := io.ReadAll(dl.Reader.Body)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// accessLogs counts access-log rows of one action on a document (G1-02b
// writes them after the read).
func (e *docStorageEnv) accessLogs(t *testing.T, docID, action string) int {
	t.Helper()
	var n int
	if err := e.f.pool.QueryRow(context.Background(),
		`SELECT count(*) FROM document_access_logs WHERE document_id = $1 AND action = $2`, docID, action).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func (e *docStorageEnv) countAudit(t *testing.T, action, docID string) int {
	t.Helper()
	var n int
	if err := e.f.pool.QueryRow(context.Background(),
		`SELECT count(*) FROM audit_events WHERE action = $1 AND resource_id = $2`, action, docID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func (e *docStorageEnv) countOutbox(t *testing.T, topic, docID string) int {
	t.Helper()
	var n int
	if err := e.f.pool.QueryRow(context.Background(),
		`SELECT count(*) FROM outbox_events WHERE topic = $1 AND payload::jsonb->>'document_id' = $2`, topic, docID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func wantCode(t *testing.T, err error, code string) CodedError {
	t.Helper()
	var ce CodedError
	if !errors.As(err, &ce) || ce.Code != code {
		t.Fatalf("want %s, got %v", code, err)
	}
	return ce
}

func wantNotFound(t *testing.T, err error) {
	t.Helper()
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("want not found, got %v", err)
	}
}

func human(u db.User) Actor { return Human(u.ID) }

func mustf(t *testing.T, err error, format string, args ...any) {
	t.Helper()
	if err != nil {
		t.Fatalf("%s: %v", fmt.Sprintf(format, args...), err)
	}
}

// auditFileDocument wires a DocumentService on filesfake into the audit
// coverage fixture and creates one file document owned by its owner.
func auditFileDocument(t *testing.T, f *auditFixture) (*DocumentService, DocumentFileResult) {
	t.Helper()
	w := f.build(t)
	svc := NewDocumentService(f.pool, f.q, f.orgs, f.ws)
	svc.SetFiles(filesfake.New(filesfake.Options{}))
	svc.SetEntitlements(NewEntitlementService(f.pool, f.q))
	svc.store.spoolDir = t.TempDir()
	res, err := svc.CreateFileDocument(f.ctx, Human(f.owner.ID), w.ID, CreateFileDocumentInput{
		Title: "Audit file", Filename: "audit.pdf", Body: bytes.NewReader(pdfBody("audit-v1-" + util.NewID())),
	})
	if err != nil {
		t.Fatal(err)
	}
	return svc, res
}

// officeJobRows counts the office_jobs rows of one document (G2-07a rows).
func (e *docStorageEnv) officeJobRows(t *testing.T, documentID string) int {
	t.Helper()
	var n int
	if err := e.f.pool.QueryRow(context.Background(),
		`SELECT count(*) FROM office_jobs WHERE document_id = $1`, documentID).Scan(&n); err != nil {
		t.Fatalf("count office jobs: %v", err)
	}
	return n
}
