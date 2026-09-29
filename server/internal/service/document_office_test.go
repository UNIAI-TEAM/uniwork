package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/files/filesfake"
	"github.com/unicomhub/uniwork/server/internal/office"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// TestDocumentOfficeJob runs the Go job lifecycle against the REAL engine
// service (the office compose profile, started with fault operations on) and
// a real database. FileService is the in-memory fake bridged to a real HTTP
// write target the engine container PUTs to; the same provider-output shape
// lands on the real FileService in TestDocumentOfficeCommit (local, MinIO).
//
// Environment (scripts in the G2-02 report start the container):
//   OFFICE_ENGINE_TEST_URL            engine base URL, e.g. http://127.0.0.1:18091
//   OFFICE_ENGINE_TEST_TARGET_ADDR    listen address of the write target, e.g. 0.0.0.0:18093
//   OFFICE_ENGINE_TEST_TARGET_ORIGIN  that target as the engine sees it, e.g. http://host.docker.internal:18093
//   OFFICE_ENGINE_TEST_CONTAINER      container name, for the restart cases
//   OFFICE_ENGINE_TEST_SERVICE_TOKEN / OFFICE_ENGINE_TEST_GRANT_KEY (default: the compose dev values)
// Without OFFICE_ENGINE_TEST_URL the engine cases skip; the engine-down case
// always runs.

const (
	officeDevToken = "dev-only-office-engine-service-token-000001"
	officeDevKey   = "dev-only-office-engine-grant-key-00000000002"
)

func officeEnv(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

// bridgeFiles is filesfake with a real write target: the engine PUTs to it and
// the handler feeds the bytes to the fake, the way the object store would.
type bridgeFiles struct {
	*filesfake.Fake
	origin string
	mu     sync.Mutex
	puts   map[files.FileID]int
}

var (
	bridgeOnce sync.Once
	bridgeSrv  *bridgeFiles
	bridgeErr  error
)

func officeBridge(t *testing.T) *bridgeFiles {
	t.Helper()
	bridgeOnce.Do(func() {
		b := &bridgeFiles{origin: officeEnv("OFFICE_ENGINE_TEST_TARGET_ORIGIN", ""), puts: map[files.FileID]int{}}
		addr := officeEnv("OFFICE_ENGINE_TEST_TARGET_ADDR", "127.0.0.1:0")
		ln, err := net.Listen("tcp", addr)
		if err != nil {
			bridgeErr = err
			return
		}
		if b.origin == "" {
			b.origin = "http://" + ln.Addr().String()
		}
		mux := http.NewServeMux()
		mux.HandleFunc("PUT /put/{id}", func(w http.ResponseWriter, r *http.Request) {
			body, _ := io.ReadAll(r.Body)
			id := files.FileID(r.PathValue("id"))
			b.mu.Lock()
			b.puts[id]++
			fake := b.Fake
			b.mu.Unlock()
			if err := fake.WriteProviderOutput(files.ProviderOutput{FileID: id}, body, r.Header.Get("Content-Type")); err != nil {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			w.WriteHeader(http.StatusOK)
		})
		go func() { _ = http.Serve(ln, mux) }()
		bridgeSrv = b
	})
	if bridgeErr != nil {
		t.Fatalf("write target: %v", bridgeErr)
	}
	// A fresh fake per test; the listener is shared.
	bridgeSrv.mu.Lock()
	bridgeSrv.Fake = filesfake.New(filesfake.Options{})
	bridgeSrv.puts = map[files.FileID]int{}
	bridgeSrv.mu.Unlock()
	return bridgeSrv
}

func (b *bridgeFiles) RegisterProviderOutput(ctx context.Context, in files.ProviderOutputInput) (files.ProviderOutput, error) {
	out, err := b.Fake.RegisterProviderOutput(ctx, in)
	if err != nil {
		return out, err
	}
	out.WriteTarget.URL = b.origin + "/put/" + string(out.FileID)
	out.WriteTarget.Headers = map[string]string{"content-type": "text/markdown"}
	return out, nil
}

func (b *bridgeFiles) putCount(id string) int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.puts[files.FileID(id)]
}

// officeFixture is a real tenant (docPermFixture) with a real
// DocumentService over the bridge fake, so the office service's document-ACL
// gate resolves actual membership, shares and levels.
type officeFixture struct {
	pool   *pgxpool.Pool
	q      *db.Queries
	pf     *docPermFixture
	tn     docTenant
	docs   *DocumentService
	files  *bridgeFiles
	actor  Actor
	org    string
	ws     string
	doc    string
	ver    string
	rev    int64
	offset atomic.Int64
}

func (f *officeFixture) clock() time.Time {
	return time.Now().Add(time.Duration(f.offset.Load()))
}

func newOfficeFixture(t *testing.T, content string) *officeFixture {
	t.Helper()
	pool := testutil.DB(t)
	pf := newDocPermFixtureOn(pool)
	f := &officeFixture{pool: pool, q: pf.q, pf: pf, files: officeBridge(t)}
	f.tn = pf.tenant(t, "g2c"+strings.ToLower(util.NewID()[20:]))
	f.actor, f.org, f.ws = human(f.tn.member), f.tn.orgID, f.tn.wsA
	f.docs = pf.svc
	f.docs.SetFiles(f.files)
	f.docs.SetEntitlements(NewEntitlementService(pool, pf.q))
	f.docs.store.spoolDir = t.TempDir()
	f.doc, f.ver, f.rev = f.seedDocument(t, content)
	return f
}

// seedDocument creates a file document through the real service, so the
// document, its first version and its file exist the way production leaves
// them. It answers (document id, version id, revision).
func (f *officeFixture) seedDocument(t *testing.T, content string) (string, string, int64) {
	t.Helper()
	res, err := f.docs.CreateFileDocument(context.Background(), f.actor, f.ws, CreateFileDocumentInput{
		Title: "Tài liệu " + util.NewID()[20:], Filename: "note.md", Body: strings.NewReader(content),
	})
	if err != nil {
		t.Fatalf("seed document: %v", err)
	}
	return res.Document.ID, res.Version.ID, res.Document.Revision
}

func (f *officeFixture) service(engine OfficeEngine) *DocumentOfficeService {
	return NewDocumentOfficeService(DocumentOfficeOptions{
		Pool: f.pool, Queries: f.q, Files: f.files, Engine: engine, Documents: f.docs,
		MaxDeadline: 2 * time.Minute, ReconcileInterval: 100 * time.Millisecond, Clock: f.clock,
	})
}

func (f *officeFixture) input(key string) OfficeJobInput {
	return OfficeJobInput{
		OrganizationID: f.org, WorkspaceID: f.ws, DocumentID: f.doc, BaseVersionID: f.ver, BaseRevision: f.rev,
		Operation: office.OperationSerialize, Format: office.FormatMD, IdempotencyKey: key, Deadline: 20 * time.Second,
	}
}

func realEngine(t *testing.T) *office.Client {
	t.Helper()
	url := officeEnv("OFFICE_ENGINE_TEST_URL", "")
	if url == "" {
		t.Skip("OFFICE_ENGINE_TEST_URL not set: start the office compose profile with fault operations (see the G2-02 report)")
	}
	c, err := office.NewClient(office.Config{
		BaseURL:      url,
		ServiceToken: officeEnv("OFFICE_ENGINE_TEST_SERVICE_TOKEN", officeDevToken),
		GrantKey:     officeEnv("OFFICE_ENGINE_TEST_GRANT_KEY", officeDevKey),
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := c.Ready(context.Background()); err != nil {
		t.Fatalf("engine at %s not ready: %v", url, err)
	}
	return c
}

func waitSettled(t *testing.T, svc *DocumentOfficeService, f *officeFixture, jobID string) db.OfficeJob {
	t.Helper()
	end := time.Now().Add(30 * time.Second)
	for {
		row, err := svc.GetOfficeJob(context.Background(), f.actor, f.org, f.ws, jobID)
		if err != nil {
			t.Fatalf("get: %v", err)
		}
		if !isLiveOfficeState(row.State) {
			return row
		}
		if time.Now().After(end) {
			t.Fatalf("job %s did not settle: %+v", jobID, row)
		}
		time.Sleep(100 * time.Millisecond)
	}
}

func claim(f *officeFixture, svc *DocumentOfficeService, jobID string) error {
	_, err := svc.ClaimOfficeJobOutputInTx(context.Background(), f.q, f.org, f.ws, jobID, util.NewID())
	return err
}

func TestDocumentOfficeJob(t *testing.T) {
	ctx := context.Background()

	t.Run("completes, verifies the output through FileService, and commits once", func(t *testing.T) {
		engine := realEngine(t)
		f := newOfficeFixture(t, "# Kế hoạch\n\nNội dung.\n")
		svc := f.service(engine)
		row, err := svc.StartOfficeJob(ctx, f.actor, f.input("k-complete"))
		if err != nil {
			t.Fatal(err)
		}
		if !row.OutputFileID.Valid || row.GrantID == "" {
			t.Fatalf("row persisted without output/grant: %+v", row)
		}
		done := waitSettled(t, svc, f, row.ID)
		sum := sha256.Sum256([]byte("# Kế hoạch\n\nNội dung.\n"))
		if done.State != "completed" || done.OutputChecksum.String != hex.EncodeToString(sum[:]) {
			t.Fatalf("done: %+v", done)
		}
		file, err := f.files.Open(ctx, files.OpenInput{Scope: files.Scope{OrganizationID: f.org, WorkspaceID: f.ws}, FileID: files.FileID(done.OutputFileID.String)})
		if err != nil {
			t.Fatalf("output not ready in FileService: %v", err)
		}
		_ = file.Close()
		if err := claim(f, svc, row.ID); err != nil {
			t.Fatalf("first commit: %v", err)
		}
		if err := claim(f, svc, row.ID); !errors.Is(err, ErrOfficeJobNotCommittable) {
			t.Fatalf("second commit: %v", err)
		}
		// A committed job is final: cancel answers it unchanged.
		after, err := svc.CancelOfficeJob(ctx, f.actor, f.org, f.ws, row.ID)
		if err != nil || after.State != "completed" || !after.CommittedVersionID.Valid {
			t.Fatalf("cancel after commit: %+v %v", after, err)
		}
	})

	t.Run("retry of the same key reads the job or replays its output, never a second job", func(t *testing.T) {
		engine := realEngine(t)
		f := newOfficeFixture(t, "retry me\n")
		svc := f.service(engine)
		first, err := svc.StartOfficeJob(ctx, f.actor, f.input("k-retry"))
		if err != nil {
			t.Fatal(err)
		}
		second, err := svc.StartOfficeJob(ctx, f.actor, f.input("k-retry"))
		if err != nil || second.ID != first.ID {
			t.Fatalf("retry started another job: %s vs %s (%v)", second.ID, first.ID, err)
		}
		done := waitSettled(t, svc, f, first.ID)
		replay, err := svc.StartOfficeJob(ctx, f.actor, f.input("k-retry"))
		if err != nil || replay.ID != first.ID || replay.OutputFileID != done.OutputFileID || replay.State != "completed" {
			t.Fatalf("replay: %+v %v", replay, err)
		}
		if n := f.files.putCount(done.OutputFileID.String); n != 1 {
			t.Fatalf("output written %d times, want 1", n)
		}
		changed := f.input("k-retry")
		changed.DocumentModelRef = "another-model"
		if _, err := svc.StartOfficeJob(ctx, f.actor, changed); office.ErrorCode(err) != "payload_fingerprint_mismatch" {
			t.Fatalf("changed payload: %v", err)
		}
		other := human(f.tn.creator) // another member with edit on the document
		if _, err := svc.StartOfficeJob(ctx, other, f.input("k-retry")); office.ErrorCode(err) != "job_conflict" {
			t.Fatalf("other actor, same key: %v", err)
		}
	})

	t.Run("a second key for the same live work is in_flight", func(t *testing.T) {
		engine := realEngine(t)
		f := newOfficeFixture(t, "uniwork-fault:sleep 3000\n")
		svc := f.service(engine)
		first, err := svc.StartOfficeJob(ctx, f.actor, f.input("k-live-1"))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := svc.StartOfficeJob(ctx, f.actor, f.input("k-live-2")); office.ErrorCode(err) != "in_flight" {
			t.Fatalf("second key: %v", err)
		}
		waitSettled(t, svc, f, first.ID)
	})

	t.Run("process kill: a worker that dies settles failed engine_crashed", func(t *testing.T) {
		engine := realEngine(t)
		f := newOfficeFixture(t, "uniwork-fault:crash\n")
		svc := f.service(engine)
		row, err := svc.StartOfficeJob(ctx, f.actor, f.input("k-crash"))
		if err != nil {
			t.Fatal(err)
		}
		done := waitSettled(t, svc, f, row.ID)
		if done.State != "failed" || done.ErrorCode.String != "engine_crashed" {
			t.Fatalf("crash: %+v", done)
		}
		if err := claim(f, svc, row.ID); !errors.Is(err, ErrOfficeJobNotCommittable) {
			t.Fatalf("failed job committable: %v", err)
		}
	})

	t.Run("timeout: the engine deadline settles timed_out", func(t *testing.T) {
		engine := realEngine(t)
		f := newOfficeFixture(t, "uniwork-fault:sleep 60000\n")
		svc := f.service(engine)
		in := f.input("k-timeout")
		in.Deadline = 2 * time.Second
		row, err := svc.StartOfficeJob(ctx, f.actor, in)
		if err != nil {
			t.Fatal(err)
		}
		done := waitSettled(t, svc, f, row.ID)
		if done.State != "timed_out" || done.ErrorCode.String != "engine_timeout" {
			t.Fatalf("timeout: %+v", done)
		}
	})

	t.Run("cancel of a running job wins and forbids a late commit", func(t *testing.T) {
		engine := realEngine(t)
		f := newOfficeFixture(t, "uniwork-fault:sleep 3000\n")
		svc := f.service(engine)
		row, err := svc.StartOfficeJob(ctx, f.actor, f.input("k-cancel"))
		if err != nil {
			t.Fatal(err)
		}
		cancelled, err := svc.CancelOfficeJob(ctx, f.actor, f.org, f.ws, row.ID)
		if err != nil || cancelled.State != "cancelled" {
			t.Fatalf("cancel: %+v %v", cancelled, err)
		}
		time.Sleep(4 * time.Second) // well past the point the sleep would have finished
		again, err := svc.GetOfficeJob(ctx, f.actor, f.org, f.ws, row.ID)
		if err != nil || again.State != "cancelled" {
			t.Fatalf("after the engine's time: %+v %v", again, err)
		}
		if f.files.putCount(row.OutputFileID.String) != 0 {
			t.Fatal("a cancelled job still wrote its output")
		}
		if err := claim(f, svc, row.ID); !errors.Is(err, ErrOfficeJobNotCommittable) {
			t.Fatalf("cancelled job committable: %v", err)
		}
	})

	t.Run("cancel/complete race: exactly one outcome, and commit only if completed", func(t *testing.T) {
		engine := realEngine(t)
		// One database per subtest (testutil.DB holds its lock until cleanup):
		// every round seeds its own document instead.
		f := newOfficeFixture(t, "race\n")
		svc := f.service(engine)
		for i := 0; i < 6; i++ {
			in := f.input(fmt.Sprintf("k-race-%d", i))
			in.DocumentID, in.BaseVersionID, in.BaseRevision = f.seedDocument(t, fmt.Sprintf("race %d\n", i))
			row, err := svc.StartOfficeJob(ctx, f.actor, in)
			if err != nil {
				t.Fatal(err)
			}
			time.Sleep(time.Duration(i*60) * time.Millisecond)
			var wg sync.WaitGroup
			start := make(chan struct{})
			var commitErr error
			wg.Add(3)
			go func() { defer wg.Done(); <-start; _, _ = svc.CancelOfficeJob(ctx, f.actor, f.org, f.ws, row.ID) }()
			go func() { defer wg.Done(); <-start; _, _ = svc.GetOfficeJob(ctx, f.actor, f.org, f.ws, row.ID) }()
			go func() { defer wg.Done(); <-start; time.Sleep(20 * time.Millisecond); commitErr = claim(f, svc, row.ID) }()
			close(start)
			wg.Wait()
			final := waitSettled(t, svc, f, row.ID)
			switch final.State {
			case "completed":
				// Cancel lost; the output is committable exactly once (the racing
				// claim may have run before completion and been refused).
				if !final.CommittedVersionID.Valid {
					if err := claim(f, svc, row.ID); err != nil {
						t.Fatalf("round %d: completed but not committable: %v", i, err)
					}
				} else if commitErr != nil {
					t.Fatalf("round %d: committed but the claim reported %v", i, commitErr)
				}
			case "cancelled":
				if commitErr == nil || final.CommittedVersionID.Valid {
					t.Fatalf("round %d: cancelled job was committed", i)
				}
			default:
				t.Fatalf("round %d: unexpected outcome %s", i, final.State)
			}
		}
	})

	t.Run("late response: an engine answer after Go settled the job changes nothing", func(t *testing.T) {
		engine := realEngine(t)
		f := newOfficeFixture(t, "uniwork-fault:sleep 1000\n")
		svc := f.service(engine)
		row, err := svc.StartOfficeJob(ctx, f.actor, f.input("k-late"))
		if err != nil {
			t.Fatal(err)
		}
		timedOut, err := svc.settle(ctx, row, office.JobTimedOut, "engine_timeout", "go_deadline")
		if err != nil || timedOut.State != "timed_out" {
			t.Fatalf("go-side timeout: %+v %v", timedOut, err)
		}
		end := time.Now().Add(10 * time.Second)
		for f.files.putCount(row.OutputFileID.String) == 0 && time.Now().Before(end) {
			time.Sleep(100 * time.Millisecond)
		}
		if f.files.putCount(row.OutputFileID.String) != 1 {
			t.Fatal("engine never finished the late job")
		}
		late, err := svc.Refresh(ctx, timedOut)
		if err != nil || late.State != "timed_out" {
			t.Fatalf("late answer moved the row: %+v %v", late, err)
		}
		if n, err := svc.ReconcileOfficeJobs(ctx); err != nil || n != 0 {
			t.Fatalf("reconciler saw a settled job: %d %v", n, err)
		}
		if err := claim(f, svc, row.ID); !errors.Is(err, ErrOfficeJobNotCommittable) {
			t.Fatalf("late output committable: %v", err)
		}
	})

	t.Run("Go-side deadline: a job the engine still runs is cancelled and timed out", func(t *testing.T) {
		engine := realEngine(t)
		f := newOfficeFixture(t, "uniwork-fault:sleep 60000\n")
		svc := f.service(engine)
		row, err := svc.StartOfficeJob(ctx, f.actor, f.input("k-go-deadline"))
		if err != nil {
			t.Fatal(err)
		}
		f.offset.Store(int64(time.Minute))
		done, err := svc.Refresh(ctx, row)
		if err != nil || done.State != "timed_out" || done.ErrorReason.String != "deadline" {
			t.Fatalf("go deadline: %+v %v", done, err)
		}
		f.offset.Store(0)
		grant, _ := svc.grantFor(row, nil, nil)
		js, err := engine.Status(ctx, row.ID, grant)
		if err != nil || js.State != office.JobCancelled {
			t.Fatalf("engine job not cancelled: %+v %v", js, err)
		}
	})

	t.Run("grant bindings are enforced by the real engine", func(t *testing.T) {
		engine := realEngine(t)
		f := newOfficeFixture(t, "grant\n")
		svc := f.service(engine)
		row, err := svc.StartOfficeJob(ctx, f.actor, f.input("k-grant"))
		if err != nil {
			t.Fatal(err)
		}
		waitSettled(t, svc, f, row.ID)
		base, err := svc.readBase(ctx, files.Scope{OrganizationID: f.org, WorkspaceID: f.ws}, files.FileID(mustVersionFile(t, f)), pgtype.Text{})
		if err != nil {
			t.Fatal(err)
		}
		env, err := svc.envelope(row, f.input("k-grant"), base)
		if err != nil {
			t.Fatal(err)
		}
		signed := func(mut func(*office.ServiceGrant)) (string, office.Envelope) {
			g := office.ServiceGrant{
				V: 1, GrantID: row.GrantID, JobID: row.ID, ActorID: row.CreatedBy, ActorKind: "human",
				OrganizationID: f.org, WorkspaceID: f.ws, DocumentID: f.doc, Operation: office.OperationSerialize, Format: office.FormatMD,
				BaseRevision: f.rev, BaseVersionID: f.ver, Input: &office.GrantInput{Checksum: base.checksum, Length: int64(len(base.bytes))},
				DeadlineAt: time.Now().Add(time.Minute).UnixMilli(), IssuedAt: time.Now().UnixMilli(), ExpiresAt: time.Now().Add(30 * time.Second).UnixMilli(),
			}
			mut(&g)
			tok, err := engine.Sign(g)
			if err != nil {
				t.Fatal(err)
			}
			e := env
			e.GrantID = g.GrantID
			return tok, e
		}
		// Reuse: the consumed grant with a changed payload.
		reused, changed := signed(func(*office.ServiceGrant) {})
		changed.Payload = bytes.Replace(env.Payload, []byte(`"document_model_ref":"`), []byte(`"document_model_ref":"x`), 1)
		if _, err := engine.Submit(ctx, reused, changed); office.ErrorCode(err) != "payload_fingerprint_mismatch" {
			t.Fatalf("reused grant, new payload: %v", err)
		}
		// Expired.
		fresh := func(g *office.ServiceGrant) { g.GrantID, g.JobID = util.NewID(), util.NewID() }
		expired, expiredEnv := signed(func(g *office.ServiceGrant) { fresh(g); g.ExpiresAt = time.Now().Add(-time.Second).UnixMilli() })
		if _, err := engine.Submit(ctx, expired, expiredEnv); office.ErrorCode(err) != "grant_expired" {
			t.Fatalf("expired grant: %v", err)
		}
		// Wrong scope: a grant for another base version.
		scoped, scopedEnv := signed(func(g *office.ServiceGrant) { fresh(g); g.BaseVersionID = util.NewID() })
		if _, err := engine.Submit(ctx, scoped, scopedEnv); office.ErrorCode(err) != "grant_scope" {
			t.Fatalf("wrong-scope grant: %v", err)
		}
		// Signed with the service token instead of the grant key.
		bad, _ := office.SignGrant(office.ServiceGrant{V: 1, GrantID: "g", JobID: "j"}, []byte(officeEnv("OFFICE_ENGINE_TEST_SERVICE_TOKEN", officeDevToken)))
		if _, err := engine.Status(ctx, "j", bad); office.ErrorCode(err) != "grant_scope" {
			t.Fatalf("service-keyed grant: %v", err)
		}
		// Q7 stays a named blocker, before any job row exists.
		conv := f.input("k-convert")
		conv.Operation = office.OperationConvert
		if _, err := svc.StartOfficeJob(ctx, f.actor, conv); office.ErrorCode(err) != "unsupported_operation" {
			t.Fatalf("convert: %v", err)
		}
		if _, err := f.q.GetOfficeJobByIdempotencyKey(ctx, db.GetOfficeJobByIdempotencyKeyParams{OrganizationID: f.org, WorkspaceID: f.ws, IdempotencyKey: "k-convert"}); err == nil {
			t.Fatal("convert persisted a job")
		}
	})

	t.Run("authorization and base checks run before any row or output exists", func(t *testing.T) {
		engine := realEngine(t)
		f := newOfficeFixture(t, "auth\n")
		svc := f.service(engine)
		if _, err := svc.StartOfficeJob(ctx, Human(util.NewID()), f.input("k-auth")); !errors.Is(err, ErrNotFound) {
			t.Fatalf("non-member: %v", err)
		}
		stale := f.input("k-stale")
		stale.BaseRevision = f.rev - 1
		if _, err := svc.StartOfficeJob(ctx, f.actor, stale); office.ErrorCode(err) != "base_version_mismatch" {
			t.Fatalf("stale revision: %v", err)
		}
		other := f.input("k-other-doc")
		other.OrganizationID = util.NewID()
		if _, err := svc.StartOfficeJob(ctx, f.actor, other); !errors.Is(err, ErrNotFound) {
			t.Fatalf("other tenant: %v", err)
		}
		if _, err := svc.GetOfficeJob(ctx, Human(util.NewID()), f.org, f.ws, "nope"); !errors.Is(err, ErrNotFound) {
			t.Fatalf("non-member read: %v", err)
		}
	})

	t.Run("restart: a job the engine lost mid-run settles failed engine_lost_job", func(t *testing.T) {
		engine := realEngine(t)
		container := restartable(t)
		f := newOfficeFixture(t, "uniwork-fault:sleep 60000\n")
		svc := f.service(engine)
		row, err := svc.StartOfficeJob(ctx, f.actor, f.input("k-restart-lost"))
		if err != nil {
			t.Fatal(err)
		}
		restartEngine(t, container, engine)
		done, err := svc.Refresh(ctx, row)
		if err != nil || done.State != "failed" || done.ErrorReason.String != "engine_lost_job" {
			t.Fatalf("lost job: %+v %v", done, err)
		}
	})

	t.Run("restart: output written before the crash reconciles to completed", func(t *testing.T) {
		engine := realEngine(t)
		container := restartable(t)
		f := newOfficeFixture(t, "written before the crash\n")
		svc := f.service(engine)
		row, err := svc.StartOfficeJob(ctx, f.actor, f.input("k-restart-written"))
		if err != nil {
			t.Fatal(err)
		}
		end := time.Now().Add(10 * time.Second)
		for f.files.putCount(row.OutputFileID.String) == 0 && time.Now().Before(end) {
			time.Sleep(50 * time.Millisecond)
		}
		restartEngine(t, container, engine)
		// A fresh service instance stands in for a restarted Go process.
		n, err := f.service(engine).ReconcileOfficeJobs(ctx)
		if err != nil || n < 1 {
			t.Fatalf("reconcile: %d %v", n, err)
		}
		done, err := svc.GetOfficeJob(ctx, f.actor, f.org, f.ws, row.ID)
		sum := sha256.Sum256([]byte("written before the crash\n"))
		if err != nil || done.State != "completed" || done.OutputChecksum.String != hex.EncodeToString(sum[:]) {
			t.Fatalf("reconciled: %+v %v", done, err)
		}
	})
}

func mustVersionFile(t *testing.T, f *officeFixture) string {
	t.Helper()
	v, err := f.q.GetOfficeJobBaseVersion(context.Background(), db.GetOfficeJobBaseVersionParams{ID: f.ver, OrganizationID: f.org, WorkspaceID: f.ws, DocumentID: f.doc})
	if err != nil {
		t.Fatal(err)
	}
	return v.FileID.String
}

func restartable(t *testing.T) string {
	t.Helper()
	name := officeEnv("OFFICE_ENGINE_TEST_CONTAINER", "")
	if name == "" {
		t.Skip("OFFICE_ENGINE_TEST_CONTAINER not set: restart cases need the engine container name")
	}
	return name
}

func restartEngine(t *testing.T, container string, engine *office.Client) {
	t.Helper()
	if out, err := exec.Command("docker", "restart", "-t", "5", container).CombinedOutput(); err != nil {
		t.Fatalf("docker restart: %v %s", err, out)
	}
	end := time.Now().Add(60 * time.Second)
	for {
		if _, err := engine.Ready(context.Background()); err == nil {
			return
		}
		if time.Now().After(end) {
			t.Fatal("engine did not come back after restart")
		}
		time.Sleep(250 * time.Millisecond)
	}
}

// deadEngine is a client pointed at a port nobody listens on.
func deadEngine(t *testing.T) *office.Client {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	deadURL := "http://" + ln.Addr().String()
	_ = ln.Close()
	down, err := office.NewClient(office.Config{BaseURL: deadURL, ServiceToken: officeDevToken, GrantKey: officeDevKey, RequestTimeout: time.Second}, nil)
	if err != nil {
		t.Fatal(err)
	}
	return down
}

// Engine down: office jobs report a retryable error and stay retryable on the
// same key, while the API's readiness and the Documents read paths (list and
// download) never touch the engine. The recovery half needs a write target the
// engine can reach, so it is TestDocumentOfficeJobRedispatchAfterEngineDown.
func TestDocumentOfficeEngineDown(t *testing.T) {
	ctx := context.Background()
	f := newOfficeFixture(t, "engine down\n")
	svc := f.service(deadEngine(t))

	row, err := svc.StartOfficeJob(ctx, f.actor, f.input("k-down"))
	if office.ErrorCode(err) != "engine_crashed" || !office.Retryable(err) {
		t.Fatalf("engine down: %v", err)
	}
	// Negotiation runs before any mutation: a refused dispatch wrote no row
	// and no provider-output intent, and the same key can start later.
	if row.ID != "" {
		t.Fatalf("engine down wrote a row: %+v", row)
	}
	if n := f.officeJobCount(t, f.doc); n != 0 {
		t.Fatalf("engine down wrote %d job rows", n)
	}
	if _, err := svc.EngineReady(ctx); err == nil {
		t.Fatal("engine readiness reported ready while down")
	}

	rep := NewReadiness(f.pool, nil).Check(ctx)
	if !rep.Ready {
		t.Fatalf("main /readyz failed with the engine down: %+v", rep)
	}
	for _, c := range rep.Checks {
		if strings.Contains(c.Name, "office") || strings.Contains(c.Name, "engine") {
			t.Fatalf("main readiness probes the engine: %+v", c)
		}
	}
	docs, err := f.q.ListDocumentsByParent(ctx, db.ListDocumentsByParentParams{OrganizationID: f.org, WorkspaceID: f.ws})
	if err != nil || len(docs) != 1 || docs[0].ID != f.doc {
		t.Fatalf("list with engine down: %v %v", docs, err)
	}
	dl, err := f.files.Open(ctx, files.OpenInput{Scope: files.Scope{OrganizationID: f.org, WorkspaceID: f.ws}, FileID: files.FileID(mustVersionFile(t, f))})
	if err != nil {
		t.Fatalf("download with engine down: %v", err)
	}
	body, _ := io.ReadAll(dl.Body)
	_ = dl.Close()
	if string(body) != "engine down\n" {
		t.Fatalf("download bytes: %q", body)
	}
	// No engine configured at all: refused by name, nothing persisted.
	none := f.service(nil)
	if _, err := none.StartOfficeJob(ctx, f.actor, f.input("k-none")); !errors.Is(err, office.ErrNotConfigured) {
		t.Fatalf("no engine: %v", err)
	}
	if n, err := none.ReconcileOfficeJobs(ctx); n != 0 || err != nil {
		t.Fatalf("reconcile without engine: %d %v", n, err)
	}
}

// When the engine is back, the key refused while it was down starts (and
// completes) the job. It dispatches to the real engine, so it shares the
// TestDocumentOfficeJob process and its container-facing write target.
func TestDocumentOfficeJobRedispatchAfterEngineDown(t *testing.T) {
	ctx := context.Background()
	engine := realEngine(t)
	f := newOfficeFixture(t, "engine down\n")
	if _, err := f.service(deadEngine(t)).StartOfficeJob(ctx, f.actor, f.input("k-down")); office.ErrorCode(err) != "engine_crashed" {
		t.Fatalf("engine down: %v", err)
	}
	up := f.service(engine)
	again, err := up.StartOfficeJob(ctx, f.actor, f.input("k-down"))
	if err != nil || again.ID == "" {
		t.Fatalf("redispatch: %+v %v", again, err)
	}
	if done := waitSettled(t, up, f, again.ID); done.State != "completed" {
		t.Fatalf("redispatched job: %+v", done)
	}
}

// mustGet reads a job row straight from the database, for assertions that a
// late engine answer never rewrites a settled row.
func (s *DocumentOfficeService) mustGet(t *testing.T, orgID, wsID, jobID string) db.OfficeJob {
	t.Helper()
	row, err := s.q.GetOfficeJob(context.Background(), db.GetOfficeJobParams{
		ID: jobID, OrganizationID: orgID, WorkspaceID: wsID,
	})
	if err != nil {
		t.Fatalf("get job %s: %v", jobID, err)
	}
	return row
}
