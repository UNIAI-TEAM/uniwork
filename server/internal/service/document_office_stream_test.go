package service

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/office"
)

// countingFiles counts what the office service pulls out of FileService, so a
// test can prove the base is streamed to the engine and not read up front.
type countingFiles struct {
	*bridgeFiles
	opens atomic.Int64
	read  atomic.Int64
}

type countedBody struct {
	io.ReadCloser
	n *atomic.Int64
}

func (b countedBody) Read(p []byte) (int, error) {
	n, err := b.ReadCloser.Read(p)
	b.n.Add(int64(n))
	return n, err
}

func (c *countingFiles) Open(ctx context.Context, in files.OpenInput) (files.Reader, error) {
	r, err := c.bridgeFiles.Open(ctx, in)
	if err != nil {
		return r, err
	}
	c.opens.Add(1)
	r.Body = countedBody{ReadCloser: r.Body, n: &c.read}
	return r, nil
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
