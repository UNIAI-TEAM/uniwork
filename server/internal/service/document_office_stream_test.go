package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/office"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// countingFiles counts what the office service pulls out of FileService, so a
// test can prove the base is streamed to the engine and not read up front.
type countingFiles struct {
	*bridgeFiles
	opens    atomic.Int64
	closes   atomic.Int64
	read     atomic.Int64
	outputs  atomic.Int64
	readHook func([]byte) (int, error)
}

type countedBody struct {
	io.ReadCloser
	n        *atomic.Int64
	closes   *atomic.Int64
	readHook func([]byte) (int, error)
}

func (b *countedBody) Read(p []byte) (int, error) {
	if b.readHook != nil {
		return b.readHook(p)
	}
	n, err := b.ReadCloser.Read(p)
	b.n.Add(int64(n))
	return n, err
}

func (b *countedBody) Close() error {
	b.closes.Add(1)
	return b.ReadCloser.Close()
}

func (c *countingFiles) Open(ctx context.Context, in files.OpenInput) (files.Reader, error) {
	r, err := c.bridgeFiles.Open(ctx, in)
	if err != nil {
		return r, err
	}
	c.opens.Add(1)
	r.Body = &countedBody{ReadCloser: r.Body, n: &c.read, closes: &c.closes, readHook: c.readHook}
	return r, nil
}

func (c *countingFiles) RegisterProviderOutput(ctx context.Context, in files.ProviderOutputInput) (files.ProviderOutput, error) {
	c.outputs.Add(1)
	return c.bridgeFiles.RegisterProviderOutput(ctx, in)
}

func (f *officeFixture) streamService(engine OfficeEngine, cf files.Service) *DocumentOfficeService {
	return NewDocumentOfficeService(DocumentOfficeOptions{
		Pool: f.pool, Queries: f.q, Files: cf, Engine: engine, Documents: f.docs,
		MaxDeadline: 2 * time.Minute, ReconcileInterval: 100 * time.Millisecond, Clock: f.clock,
	})
}

// seenSubmit is what the scripted engine's Submit saw: the envelope payload
// and the whole input stream (drained the way the engine drains the frame).
type seenSubmit struct {
	payload     map[string]any
	source      office.InputSource
	body        []byte
	readAtStart int64
}

func recordSubmits(eng *scriptedEngine, cf *countingFiles, fail func(n int) error) *[]seenSubmit {
	var seen []seenSubmit
	eng.submitHook = func(env office.Envelope, in office.InputSource) error {
		s := seenSubmit{source: in, readAtStart: cf.read.Load()}
		_ = json.Unmarshal(env.Payload, &s.payload)
		rc, err := in.Open()
		if err != nil {
			return err
		}
		defer rc.Close()
		s.body, _ = io.ReadAll(rc)
		seen = append(seen, s)
		if fail != nil {
			return fail(len(seen))
		}
		return nil
	}
	return &seen
}

func TestOfficeSubmitStreamsTheStoredBase(t *testing.T) {
	ctx := context.Background()
	content := strings.Repeat("stream me, do not buffer me\n", 20000)
	f := newOfficeFixture(t, content)
	cf := &countingFiles{bridgeFiles: f.files}
	eng := newScriptedEngine()
	seen := recordSubmits(eng, cf, nil)

	row, err := f.streamService(eng, cf).StartOfficeJob(ctx, f.actor, f.input("k-stream"))
	if err != nil {
		t.Fatal(err)
	}
	if len(*seen) != 1 {
		t.Fatalf("submits: %d", len(*seen))
	}
	s := (*seen)[0]
	// The version row carries a checksum, so nothing reads the base before the
	// submit starts: the engine's digest check is the proof.
	if s.readAtStart != 0 {
		t.Fatalf("%d base bytes were read before Submit started: the base was buffered", s.readAtStart)
	}
	want := sha256Hex([]byte(content))
	if !bytes.Equal(s.body, []byte(content)) {
		t.Fatalf("streamed %d bytes, want the %d-byte base", len(s.body), len(content))
	}
	if s.source.Checksum != want || s.source.Length != int64(len(content)) {
		t.Fatalf("source: %+v", s.source)
	}
	if _, has := s.payload["input_bytes"]; has {
		t.Fatal("the envelope still carries input_bytes")
	}
	if s.payload["input_checksum"] != want || int64(s.payload["input_length"].(float64)) != int64(len(content)) {
		t.Fatalf("payload digest: %+v", s.payload)
	}
	if row.InputChecksum != want || row.InputLength != int64(len(content)) {
		t.Fatalf("row digest: %s %d", row.InputChecksum, row.InputLength)
	}
}

func TestOfficeSubmitSpoolsALegacyBaseAndDeletesIt(t *testing.T) {
	ctx := context.Background()
	content := strings.Repeat("legacy row, no stored checksum\n", 5000)
	f := newOfficeFixture(t, content)
	if _, err := f.pool.Exec(ctx, `UPDATE document_versions SET checksum_sha256 = NULL WHERE id = $1`, f.ver); err != nil {
		t.Fatal(err)
	}
	spool := t.TempDir()
	t.Setenv("TMPDIR", spool)
	cf := &countingFiles{bridgeFiles: f.files}
	eng := newScriptedEngine()
	var spooledDuringSubmit int
	seen := recordSubmits(eng, cf, func(int) error {
		entries, _ := os.ReadDir(spool)
		spooledDuringSubmit = len(entries)
		return nil
	})

	row, err := f.streamService(eng, cf).StartOfficeJob(ctx, f.actor, f.input("k-spool"))
	if err != nil {
		t.Fatal(err)
	}
	s := (*seen)[0]
	want := sha256Hex([]byte(content))
	if !bytes.Equal(s.body, []byte(content)) || s.source.Checksum != want || row.InputChecksum != want {
		t.Fatalf("spooled submit: %d bytes, source %+v, row %s", len(s.body), s.source, row.InputChecksum)
	}
	if spooledDuringSubmit != 1 {
		t.Fatalf("temp files while submitting: %d, want 1", spooledDuringSubmit)
	}
	if entries, _ := os.ReadDir(spool); len(entries) != 0 {
		t.Fatalf("spool file left behind after the answer: %v", entries)
	}
}

func TestOfficeSubmitSpoolIsDeletedWhenTheJobNeverDispatches(t *testing.T) {
	ctx := context.Background()
	f := newOfficeFixture(t, strings.Repeat("x", 4096))
	if _, err := f.pool.Exec(ctx, `UPDATE document_versions SET checksum_sha256 = NULL WHERE id = $1`, f.ver); err != nil {
		t.Fatal(err)
	}
	spool := t.TempDir()
	t.Setenv("TMPDIR", spool)
	eng := newScriptedEngine()
	eng.bound = map[office.Operation]bool{} // negotiation refuses: nothing is bound
	cf := &countingFiles{bridgeFiles: f.files}
	if _, err := f.streamService(eng, cf).StartOfficeJob(ctx, f.actor, f.input("k-spool-refused")); err == nil {
		t.Fatal("expected the operation gate to refuse")
	}
	if entries, _ := os.ReadDir(spool); len(entries) != 0 {
		t.Fatalf("spool file left behind by a refused job: %v", entries)
	}
}

func TestOfficeInputBudgetRefusalKeepsTheRowAcceptedAndRetryReopensTheBase(t *testing.T) {
	ctx := context.Background()
	content := strings.Repeat("retry me\n", 30000)
	f := newOfficeFixture(t, content)
	cf := &countingFiles{bridgeFiles: f.files}
	eng := newScriptedEngine()
	seen := recordSubmits(eng, cf, func(n int) error {
		if n == 1 {
			return office.NewEngineError("engine_overloaded", "input_budget")
		}
		return nil
	})
	svc := f.streamService(eng, cf)

	row, err := svc.StartOfficeJob(ctx, f.actor, f.input("k-budget"))
	if !office.Retryable(err) || office.ErrorCode(err) != "engine_overloaded" {
		t.Fatalf("first dispatch: %v", err)
	}
	if row.State != string(office.JobAccepted) || row.DispatchedAt.Valid {
		t.Fatalf("a retryable refusal must leave the row accepted and undispatched: %+v", row)
	}
	again, err := svc.StartOfficeJob(ctx, f.actor, f.input("k-budget"))
	if err != nil {
		t.Fatal(err)
	}
	if again.ID != row.ID || again.State != string(office.JobRunning) {
		t.Fatalf("retry: %+v", again)
	}
	if len(*seen) != 2 {
		t.Fatalf("submits: %d", len(*seen))
	}
	for i, s := range *seen {
		if !bytes.Equal(s.body, []byte(content)) {
			t.Errorf("submit %d streamed %d bytes, want the full %d-byte base", i+1, len(s.body), len(content))
		}
		if s.readAtStart != int64(i)*int64(len(content)) {
			t.Errorf("submit %d: %d bytes read before Submit", i+1, s.readAtStart)
		}
	}
	if got := cf.opens.Load(); got != 2 {
		t.Fatalf("the base was opened %d times, want one fresh open per dispatch", got)
	}
}

func TestOfficeSubmitRedispatchNegotiatesJobTransport(t *testing.T) {
	ctx := context.Background()
	f := newOfficeFixture(t, "retry transport gate\n")
	cf := &countingFiles{bridgeFiles: f.files}
	eng := newScriptedEngine()
	seen := recordSubmits(eng, cf, func(n int) error {
		if n == 1 {
			return office.NewEngineError("engine_overloaded", "input_budget")
		}
		return nil
	})
	svc := f.streamService(eng, cf)

	row, err := svc.StartOfficeJob(ctx, f.actor, f.input("k-redispatch-transport"))
	if !office.Retryable(err) || office.ErrorCode(err) != "engine_overloaded" {
		t.Fatalf("first dispatch: %v", err)
	}
	if row.State != string(office.JobAccepted) || row.DispatchedAt.Valid {
		t.Fatalf("expected accepted/undispatched row after retryable refusal: %+v", row)
	}
	if cf.outputs.Load() != 1 || len(*seen) != 1 {
		t.Fatalf("after first attempt: outputs=%d submits=%d, want 1 and 1", cf.outputs.Load(), len(*seen))
	}

	for _, tr := range []string{"", "json/1"} {
		v := tr
		eng.jobTransport = &v
		_, err := svc.StartOfficeJob(ctx, f.actor, f.input("k-redispatch-transport"))
		if err == nil {
			t.Fatalf("job_transport %q redispatched an accepted row", tr)
		}
		if ee := wantOfficeCode(t, err, "engine_incompatible"); ee.Reason != "job_transport:"+tr {
			t.Fatalf("job_transport %q refusal = %+v, want job_transport:%s", tr, ee, tr)
		}
		persisted, err := f.q.GetOfficeJob(ctx, db.GetOfficeJobParams{ID: row.ID, OrganizationID: f.org, WorkspaceID: f.ws})
		if err != nil {
			t.Fatal(err)
		}
		if persisted.State != string(office.JobAccepted) || persisted.DispatchedAt.Valid {
			t.Fatalf("job_transport %q mutated row: %+v", tr, persisted)
		}
		if cf.outputs.Load() != 1 {
			t.Fatalf("job_transport %q registered provider output %d times, want 1", tr, cf.outputs.Load())
		}
		if len(*seen) != 1 || len(eng.grants) != 0 {
			t.Fatalf("job_transport %q called Submit: submits=%d grants=%d", tr, len(*seen), len(eng.grants))
		}
	}

	framed := office.JobTransport
	eng.jobTransport = &framed
	again, err := svc.StartOfficeJob(ctx, f.actor, f.input("k-redispatch-transport"))
	if err != nil {
		t.Fatalf("redispatch after restoring %s: %v", office.JobTransport, err)
	}
	if again.ID != row.ID || again.GrantID != row.GrantID || again.State != string(office.JobRunning) || !again.DispatchedAt.Valid {
		t.Fatalf("redispatch row: %+v", again)
	}
	if cf.outputs.Load() != 2 || len(*seen) != 2 || len(eng.grants) != 1 {
		t.Fatalf("after valid redispatch: outputs=%d submits=%d grants=%d, want 2, 2, 1", cf.outputs.Load(), len(*seen), len(eng.grants))
	}
}

func TestOfficeSubmitSuppliedInputReleasesTheBase(t *testing.T) {
	ctx := context.Background()
	for _, tc := range []struct {
		name   string
		legacy bool
	}{
		{name: "stored_checksum", legacy: false},
		{name: "legacy", legacy: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newOfficeFixture(t, strings.Repeat("base content\n", 1024))
			if tc.legacy {
				if _, err := f.pool.Exec(ctx, `UPDATE document_versions SET checksum_sha256 = NULL WHERE id = $1`, f.ver); err != nil {
					t.Fatal(err)
				}
			}
			spool := t.TempDir()
			t.Setenv("TMPDIR", spool)
			cf := &countingFiles{bridgeFiles: f.files}
			eng := newScriptedEngine()
			seen := recordSubmits(eng, cf, func(n int) error {
				if n == 1 {
					return office.NewEngineError("engine_overloaded", "input_budget")
				}
				return nil
			})
			svc := f.streamService(eng, cf)

			raw := []byte("supplied replacement\n")
			supplied := bytesInput(raw, sha256Hex(raw))
			in := f.input("k-supplied-" + tc.name)
			in.input = &supplied

			row, err := svc.StartOfficeJob(ctx, f.actor, in)
			if !office.Retryable(err) || row.State != string(office.JobAccepted) || row.DispatchedAt.Valid {
				t.Fatalf("first dispatch: row=%+v err=%v", row, err)
			}
			entries, _ := os.ReadDir(spool)
			if cf.opens.Load() != 1 || cf.closes.Load() != 1 || len(entries) != 0 {
				t.Fatalf("after first dispatch: baseOpens=%d baseCloses=%d spoolFiles=%d (%v)", cf.opens.Load(), cf.closes.Load(), len(entries), entries)
			}

			again, err := svc.StartOfficeJob(ctx, f.actor, in)
			if err != nil || again.ID != row.ID || again.State != string(office.JobRunning) {
				t.Fatalf("replay dispatch: row=%+v err=%v", again, err)
			}
			entries, _ = os.ReadDir(spool)
			if cf.opens.Load() != 2 || cf.closes.Load() != 2 || len(entries) != 0 {
				t.Fatalf("after replay dispatch: baseOpens=%d baseCloses=%d spoolFiles=%d (%v)", cf.opens.Load(), cf.closes.Load(), len(entries), entries)
			}
			if len(*seen) != 2 || !bytes.Equal((*seen)[1].body, raw) {
				t.Fatalf("seen submits: %+v", *seen)
			}
		})
	}
}

func TestOfficeSubmitLegacySpoolPanicDeletesTheSpool(t *testing.T) {
	ctx := context.Background()
	f := newOfficeFixture(t, strings.Repeat("legacy base\n", 1024))
	if _, err := f.pool.Exec(ctx, `UPDATE document_versions SET checksum_sha256 = NULL WHERE id = $1`, f.ver); err != nil {
		t.Fatal(err)
	}
	spool := t.TempDir()
	t.Setenv("TMPDIR", spool)
	cf := &countingFiles{
		bridgeFiles: f.files,
		readHook: func([]byte) (int, error) {
			panic("injected storage read panic")
		},
	}
	svc := f.streamService(newScriptedEngine(), cf)

	var recovered any
	func() {
		defer func() { recovered = recover() }()
		_, _ = svc.StartOfficeJob(ctx, f.actor, f.input("k-spool-panic"))
	}()
	if recovered != "injected storage read panic" {
		t.Fatalf("recovered=%v, want injected storage read panic", recovered)
	}
	entries, _ := os.ReadDir(spool)
	if cf.opens.Load() != 1 || cf.closes.Load() != 1 || len(entries) != 0 {
		t.Fatalf("after panic: baseOpens=%d baseCloses=%d spoolFiles=%d (%v)", cf.opens.Load(), cf.closes.Load(), len(entries), entries)
	}
}

type heldBodyFiles struct {
	*countingFiles
	spoolDir     string
	spooledFiles atomic.Int64
	ctxErr       atomic.Value
}

type heldBody struct {
	io.ReadCloser
	ctx    context.Context
	parent *heldBodyFiles
	wrote  bool
}

func (b *heldBody) Read(p []byte) (int, error) {
	if !b.wrote {
		b.wrote = true
		return copy(p, "partial legacy bytes\n"), nil
	}
	entries, _ := os.ReadDir(b.parent.spoolDir)
	var spools int64
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), officeSpoolPrefix) {
			spools++
		}
	}
	b.parent.spooledFiles.Store(spools)
	select {
	case <-b.ctx.Done():
		b.parent.ctxErr.Store(b.ctx.Err())
		return 0, b.ctx.Err()
	case <-time.After(500 * time.Millisecond):
		return 0, errors.New("held reader context was not cancelled by copy budget")
	}
}

func (h *heldBodyFiles) Open(ctx context.Context, in files.OpenInput) (files.Reader, error) {
	r, err := h.countingFiles.Open(ctx, in)
	if err != nil {
		return r, err
	}
	r.Body = &heldBody{ReadCloser: r.Body, ctx: ctx, parent: h}
	return r, nil
}

func TestOfficeSubmitLegacySpoolCopyBudgetAbortsStalledReaderAndDeletesTheSpool(t *testing.T) {
	ctx := context.Background()
	f := newOfficeFixture(t, strings.Repeat("legacy base\n", 1024))
	if _, err := f.pool.Exec(ctx, `UPDATE document_versions SET checksum_sha256 = NULL WHERE id = $1`, f.ver); err != nil {
		t.Fatal(err)
	}
	spool := t.TempDir()
	t.Setenv("TMPDIR", spool)
	cf := &countingFiles{bridgeFiles: f.files}
	hf := &heldBodyFiles{countingFiles: cf, spoolDir: spool}
	svc := NewDocumentOfficeService(DocumentOfficeOptions{
		Pool: f.pool, Queries: f.q, Files: hf, Engine: newScriptedEngine(), Documents: f.docs,
		MaxDeadline: 2 * time.Minute, ReconcileInterval: 100 * time.Millisecond, Clock: f.clock,
		spoolCopyBudget: 25 * time.Millisecond,
	})

	_, err := svc.StartOfficeJob(ctx, f.actor, f.input("k-spool-budget"))
	if err == nil {
		t.Fatal("expected stalled legacy spool copy to fail on copy budget expiry")
	}
	gotCtxErr, _ := hf.ctxErr.Load().(error)
	if !errors.Is(gotCtxErr, context.DeadlineExceeded) {
		t.Fatalf("held reader ctxErr = %v, want context.DeadlineExceeded", gotCtxErr)
	}
	var ce CodedError
	if !errors.As(err, &ce) || ce.Status != http.StatusServiceUnavailable || ce.Code != files.CodeStorageUnavailable || !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("StartOfficeJob err = %T %v, want 503 storage_unavailable CodedError wrapping context.DeadlineExceeded", err, err)
	}
	if got := hf.spooledFiles.Load(); got != 1 {
		t.Fatalf("spooled files while copy was blocked = %d, want 1", got)
	}
	if entries, _ := os.ReadDir(spool); len(entries) != 0 {
		t.Fatalf("spool file left behind after copy budget expiry: %v", entries)
	}
	if cf.opens.Load() != 1 || cf.closes.Load() != 1 {
		t.Fatalf("after copy budget expiry: baseOpens=%d baseCloses=%d, want 1 and 1", cf.opens.Load(), cf.closes.Load())
	}
	if n := f.officeJobCount(t, f.doc); n != 0 {
		t.Fatalf("office_jobs = %d, want 0", n)
	}
}

func TestOfficeSubmitLegacySpoolHeldByDescriptorSurvivesPathRemoval(t *testing.T) {
	ctx := context.Background()
	content := strings.Repeat("legacy descriptor survives sweep unlink\n", 1024)
	f := newOfficeFixture(t, content)
	spool := t.TempDir()
	t.Setenv("TMPDIR", spool)
	cf := &countingFiles{bridgeFiles: f.files}
	svc := f.streamService(newScriptedEngine(), cf)

	v, err := f.q.GetOfficeJobBaseVersion(ctx, db.GetOfficeJobBaseVersionParams{
		ID: f.ver, OrganizationID: f.org, WorkspaceID: f.ws, DocumentID: f.doc,
	})
	if err != nil {
		t.Fatalf("GetOfficeJobBaseVersion: %v", err)
	}
	in, err := svc.readBase(ctx, files.Scope{OrganizationID: f.org, WorkspaceID: f.ws}, files.FileID(v.FileID.String), pgtype.Text{})
	if err != nil {
		t.Fatalf("readBase: %v", err)
	}
	want := sha256Hex([]byte(content))
	if in.checksum != want || in.length != int64(len(content)) {
		t.Fatalf("readBase digest = (%s, %d), want (%s, %d)", in.checksum, in.length, want, len(content))
	}
	if cf.opens.Load() != 1 || cf.closes.Load() != 1 {
		t.Fatalf("after readBase: baseOpens=%d baseCloses=%d, want 1 and 1", cf.opens.Load(), cf.closes.Load())
	}

	entries, err := os.ReadDir(spool)
	if err != nil {
		t.Fatalf("ReadDir: %v", err)
	}
	if len(entries) != 1 || !strings.HasPrefix(entries[0].Name(), officeSpoolPrefix) {
		t.Fatalf("spool entries = %v, want 1 %s* file", entries, officeSpoolPrefix)
	}
	spoolPath := filepath.Join(spool, entries[0].Name())
	if err := os.Remove(spoolPath); err != nil {
		t.Fatalf("Remove(%s): %v", spoolPath, err)
	}

	for attempt := 1; attempt <= 2; attempt++ {
		rc, err := in.open()
		if err != nil {
			t.Fatalf("open attempt %d after os.Remove: %v", attempt, err)
		}
		got, err := io.ReadAll(rc)
		if err != nil {
			t.Fatalf("ReadAll attempt %d: %v", attempt, err)
		}
		if err := rc.Close(); err != nil {
			t.Fatalf("Close attempt %d: %v", attempt, err)
		}
		if !bytes.Equal(got, []byte(content)) {
			t.Fatalf("attempt %d read %d bytes, want %d bytes byte-exact", attempt, len(got), len(content))
		}
	}

	in.release()
	in.release()

	if entries, _ := os.ReadDir(spool); len(entries) != 0 {
		t.Fatalf("spool files after release: %v, want 0", entries)
	}
	if rc, err := in.open(); err == nil {
		_, readErr := rc.Read(make([]byte, 1))
		_ = rc.Close()
		if !errors.Is(readErr, os.ErrClosed) {
			t.Fatalf("read after release err = %v, want os.ErrClosed", readErr)
		}
	}
}
