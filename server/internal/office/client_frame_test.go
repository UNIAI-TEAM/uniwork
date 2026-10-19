package office

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// frameEngine is an in-process fake of the engine's framed submit (protocol 2):
// it reads exactly X-Office-Envelope-Length envelope bytes, then counts and
// hashes the rest of the body without keeping it, and refuses a body that does
// not match the envelope's input_length / input_checksum.
type frameEngine struct {
	srv *httptest.Server
	cli *Client

	mu sync.Mutex
	// budgetRefusals is how many submits answer 503 engine_overloaded
	// reason input_budget before a body byte is read.
	budgetRefusals int
	// redirects is how many submits answer 307 so the transport replays the body.
	redirects int
	frames    []seenFrame
}

type seenFrame struct {
	contentType    string
	envelopeHeader string
	contentLength  int64
	envelope       []byte
	inputLen       int64
	inputSum       string
	// readAtStart is what the client had already read from its source when
	// the handler began (headers arrived, no body consumed yet).
	readAtStart int64
	refused     string
}

func newFrameEngine(t *testing.T, progress func() int64) *frameEngine {
	t.Helper()
	e := &frameEngine{}
	e.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var fr seenFrame
		if progress != nil {
			fr.readAtStart = progress()
		}
		e.mu.Lock()
		refuse := e.budgetRefusals > 0
		redirect := e.redirects > 0
		if refuse {
			e.budgetRefusals--
		} else if redirect {
			e.redirects--
		}
		e.mu.Unlock()
		if refuse {
			w.Header().Set("Retry-After", "2")
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte(`{"error":{"code":"engine_overloaded","reason":"input_budget"}}`))
			return
		}
		if redirect {
			http.Redirect(w, r, "/v1/jobs", http.StatusTemporaryRedirect)
			return
		}
		fr.contentType = r.Header.Get("Content-Type")
		fr.envelopeHeader = r.Header.Get("X-Office-Envelope-Length")
		fr.contentLength = r.ContentLength
		n, err := strconv.Atoi(fr.envelopeHeader)
		if err != nil || n < 1 || fr.contentLength < int64(n) {
			e.record(fr, "framing")
			writeJSONError(w, 400, `{"error":{"code":"contract_violation","reason":"framing"}}`)
			return
		}
		fr.envelope = make([]byte, n)
		if _, err := io.ReadFull(r.Body, fr.envelope); err != nil {
			e.record(fr, "framing")
			writeJSONError(w, 400, `{"error":{"code":"contract_violation","reason":"framing"}}`)
			return
		}
		h := sha256.New()
		fr.inputLen, _ = io.Copy(h, r.Body)
		fr.inputSum = hex.EncodeToString(h.Sum(nil))
		var env struct {
			Payload struct {
				InputBytes    *string `json:"input_bytes"`
				InputChecksum string  `json:"input_checksum"`
				InputLength   int64   `json:"input_length"`
			} `json:"payload"`
		}
		_ = json.Unmarshal(fr.envelope, &env)
		switch {
		case env.Payload.InputBytes != nil:
			e.record(fr, "input_bytes_present")
			writeJSONError(w, 400, `{"error":{"code":"contract_violation","reason":"input_bytes"}}`)
		case fr.inputLen != env.Payload.InputLength || fr.inputSum != env.Payload.InputChecksum:
			e.record(fr, "upload_checksum_mismatch")
			writeJSONError(w, 400, `{"error":{"code":"upload_checksum_mismatch","reason":"digest"}}`)
		default:
			e.record(fr, "")
			_, _ = w.Write([]byte(`{"job_id":"job1","state":"running"}`))
		}
	}))
	t.Cleanup(e.srv.Close)
	cli, err := NewClient(Config{BaseURL: e.srv.URL, ServiceToken: testToken, GrantKey: testKey, RequestTimeout: 30 * time.Second}, e.srv.Client())
	if err != nil {
		t.Fatal(err)
	}
	e.cli = cli
	return e
}

func writeJSONError(w http.ResponseWriter, status int, body string) {
	w.WriteHeader(status)
	_, _ = w.Write([]byte(body))
}

func (e *frameEngine) record(fr seenFrame, refused string) {
	fr.refused = refused
	e.mu.Lock()
	e.frames = append(e.frames, fr)
	e.mu.Unlock()
}

func (e *frameEngine) seen() []seenFrame {
	e.mu.Lock()
	defer e.mu.Unlock()
	return append([]seenFrame(nil), e.frames...)
}

// genReader yields n deterministic pseudo-random bytes without holding them.
type genReader struct {
	left int64
	x    uint64
	read *atomic.Int64
}

func newGenReader(n int64, read *atomic.Int64) *genReader {
	return &genReader{left: n, x: 0x9e3779b97f4a7c15, read: read}
}

func (g *genReader) Read(p []byte) (int, error) {
	if g.left <= 0 {
		return 0, io.EOF
	}
	if int64(len(p)) > g.left {
		p = p[:g.left]
	}
	for i := range p {
		g.x = g.x*6364136223846793005 + 1442695040888963407
		p[i] = byte(g.x >> 56)
	}
	g.left -= int64(len(p))
	if g.read != nil {
		g.read.Add(int64(len(p)))
	}
	return len(p), nil
}

func (g *genReader) Close() error { return nil }

func genDigest(n int64) string {
	h := sha256.New()
	_, _ = io.Copy(h, newGenReader(n, nil))
	return hex.EncodeToString(h.Sum(nil))
}

func frameEnvelope(t *testing.T, sum string, length int64) Envelope {
	t.Helper()
	payload, err := json.Marshal(map[string]any{
		"base_revision": 1, "base_version_id": "v1", "input_checksum": sum, "input_length": length,
	})
	if err != nil {
		t.Fatal(err)
	}
	return Envelope{
		RequestID: "r1", ContractVersion: ContractVersion, ProtocolVersion: ProtocolVersion,
		Operation: OperationOpen, Format: FormatDOCX, Payload: payload,
	}
}

func TestSubmitSendsAFramedBodyByteExact(t *testing.T) {
	const size = 3<<20 + 17
	e := newFrameEngine(t, nil)
	sum := genDigest(size)
	env := frameEnvelope(t, sum, size)
	raw, _ := json.Marshal(env)
	src := InputSource{Length: size, Checksum: sum, Open: func() (io.ReadCloser, error) { return newGenReader(size, nil), nil }}

	js, err := e.cli.Submit(context.Background(), "grant", env, src)
	if err != nil || js.JobID != "job1" {
		t.Fatalf("submit: %+v %v", js, err)
	}
	frames := e.seen()
	if len(frames) != 1 {
		t.Fatalf("frames: %d", len(frames))
	}
	fr := frames[0]
	if fr.refused != "" {
		t.Fatalf("engine refused the frame: %s", fr.refused)
	}
	if fr.contentType != "application/vnd.uniwork.office-job" {
		t.Errorf("content-type %q", fr.contentType)
	}
	if fr.envelopeHeader != strconv.Itoa(len(raw)) || !bytes.Equal(fr.envelope, raw) {
		t.Errorf("envelope prefix: header %q, %d bytes", fr.envelopeHeader, len(fr.envelope))
	}
	if fr.contentLength != int64(len(raw))+size {
		t.Errorf("content-length %d, want %d", fr.contentLength, int64(len(raw))+size)
	}
	if fr.inputLen != size || fr.inputSum != sum {
		t.Errorf("input: %d bytes sha %s", fr.inputLen, fr.inputSum)
	}
}

func TestSubmitStreamsTheInputInsteadOfBufferingIt(t *testing.T) {
	// The source is generated, never held: if Submit read it into memory
	// before sending, the whole length would be consumed by the time the
	// engine's handler starts.
	const size = 128 << 20
	var read atomic.Int64
	e := newFrameEngine(t, read.Load)
	sum := genDigest(size)
	env := frameEnvelope(t, sum, size)
	src := InputSource{Length: size, Checksum: sum, Open: func() (io.ReadCloser, error) {
		read.Store(0)
		return newGenReader(size, &read), nil
	}}
	if _, err := e.cli.Submit(context.Background(), "grant", env, src); err != nil {
		t.Fatal(err)
	}
	fr := e.seen()[0]
	if fr.refused != "" || fr.inputLen != size {
		t.Fatalf("frame: %+v", fr)
	}
	if fr.readAtStart > size/4 {
		t.Fatalf("client had read %d of %d bytes before the engine handler started: the input was buffered", fr.readAtStart, size)
	}
}

func TestSubmitInputBudgetRefusalIsRetryableAndReopensTheSource(t *testing.T) {
	const size = 1<<20 + 5
	e := newFrameEngine(t, nil)
	e.budgetRefusals = 1
	sum := genDigest(size)
	env := frameEnvelope(t, sum, size)
	var opens atomic.Int32
	src := InputSource{Length: size, Checksum: sum, Open: func() (io.ReadCloser, error) {
		opens.Add(1)
		return newGenReader(size, nil), nil
	}}

	_, err := e.cli.Submit(context.Background(), "grant", env, src)
	var ee *EngineError
	if !Retryable(err) || ErrorCode(err) != "engine_overloaded" || !asEngineError(err, &ee) || ee.Reason != "input_budget" {
		t.Fatalf("budget refusal: code=%q retryable=%v err=%v", ErrorCode(err), Retryable(err), err)
	}
	// The retry opens the source again: a consumed reader is never reused.
	if _, err := e.cli.Submit(context.Background(), "grant", env, src); err != nil {
		t.Fatal(err)
	}
	if got := opens.Load(); got != 2 {
		t.Fatalf("Open called %d times, want 2 (once per Submit)", got)
	}
	frames := e.seen()
	if len(frames) != 1 || frames[0].refused != "" || frames[0].inputLen != size || frames[0].inputSum != sum {
		t.Fatalf("second frame: %+v", frames)
	}
}

func TestSubmitReopensTheSourceWhenTheTransportReplaysTheBody(t *testing.T) {
	const size = 256 << 10
	e := newFrameEngine(t, nil)
	e.redirects = 1
	sum := genDigest(size)
	env := frameEnvelope(t, sum, size)
	var opens atomic.Int32
	src := InputSource{Length: size, Checksum: sum, Open: func() (io.ReadCloser, error) {
		opens.Add(1)
		return newGenReader(size, nil), nil
	}}
	if _, err := e.cli.Submit(context.Background(), "grant", env, src); err != nil {
		t.Fatal(err)
	}
	if opens.Load() < 2 {
		t.Fatalf("Open called %d times: a replayed body must come from a fresh source", opens.Load())
	}
	frames := e.seen()
	if len(frames) != 1 || frames[0].refused != "" || frames[0].inputSum != sum {
		t.Fatalf("replayed frame: %+v", frames)
	}
}

func TestSubmitCapsOverlongSourceAtDeclaredLength(t *testing.T) {
	const size = 1 << 20
	e := newFrameEngine(t, nil)
	buf := bytes.Repeat([]byte("a"), size+1)
	h := sha256.Sum256(buf[:size])
	sum := hex.EncodeToString(h[:])
	env := frameEnvelope(t, sum, size)
	overlong := InputSource{Length: size, Checksum: sum, Open: func() (io.ReadCloser, error) {
		return io.NopCloser(bytes.NewReader(buf)), nil
	}}
	js, err := e.cli.Submit(context.Background(), "grant", env, overlong)
	if err != nil || js.JobID != "job1" {
		t.Fatalf("overlong submit: job=%+v err=%v", js, err)
	}
	frames := e.seen()
	if len(frames) != 1 || frames[0].refused != "" || frames[0].inputLen != size || frames[0].inputSum != sum {
		t.Fatalf("overlong frame: %+v", frames)
	}

	short := InputSource{Length: size, Checksum: sum, Open: func() (io.ReadCloser, error) {
		return io.NopCloser(bytes.NewReader(buf[:size-1])), nil
	}}
	if _, err := e.cli.Submit(context.Background(), "grant", env, short); err == nil {
		t.Fatal("expected short source to fail")
	}
	for i, fr := range e.seen()[1:] {
		if fr.refused == "" {
			t.Fatalf("short frame %d was accepted: %+v", i, fr)
		}
	}
}

func asEngineError(err error, target **EngineError) bool {
	ee, ok := err.(*EngineError)
	if ok {
		*target = ee
	}
	return ok
}
