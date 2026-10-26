# Log text dễ đọc khi xem từ Docker — Implementation Plan

> **Trạng thái:** in-progress

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Format text của server có màu cả khi stderr là pipe của Docker, phần quét nổi ở đầu dòng, id lặp lại nằm cuối và mờ; JSON production không đổi.

**Architecture:** `colorEnabled` quyết định màu từ `NO_COLOR` rồi `LOG_COLOR`. `buildHandler` chọn JSON hoặc `textHandler`. `textHandler` tự viết dòng phẳng; record trong group hoặc attr `KindGroup` ủy thác `tint`. `newHandler` chỉ bọc `buildHandler(os.Stderr, isTerminal(os.Stderr))` bằng wrapper telemetry đang có.

**Tech Stack:** Go 1.21+ `log/slog`, `github.com/lmittmann/tint` v1.2.0 (đã có trong `server/go.mod`). Không thêm dependency.

**Spec:** `docs/superpowers/specs/2026-10-23-dev-log-format-design.md`

## Global Constraints

- `LOG_FORMAT=json` (trim, không phân biệt hoa thường) là `slog.JSONHandler`: một object mỗi dòng, không byte ESC, không xếp lại field.
- Màu format text, đúng thứ tự: `NO_COLOR` sau trim còn khác rỗng thì tắt (thắng `LOG_COLOR=always`); `LOG_COLOR=never` tắt; `LOG_COLOR=auto` theo `stderrIsTerminal`; `always`, trống, hoặc giá trị khác thì bật. So sánh `LOG_COLOR` trim và không phân biệt hoa thường.
- Bộ mờ, đúng thứ tự: `request_id`, `correlation_id`, `trace_id`, `span_id`, `organization_id`, `workspace_id`, `actor_id`, `actor_kind`. `user_id`, `room_id`, `code`, `batch` ở phần sáng.
- Dòng `http request`: `method`, `path`, `status`, `duration` đứng đầu phần sáng, theo thứ tự đó.
- `status` chỉ tô khi message là `http request` và kind là `Int64` hoặc `Uint64`: 5xx đỏ, 4xx vàng, còn lại xanh. Chuỗi `"500"` không tô.
- Value `err` và `error` đỏ khi có màu. Mỗi span màu reset trước field sau.
- ESC trong value luôn được quote, kể cả khi tập an toàn của `tint` chứa ESC. Không giải mã `\x1b`. Dấu `\` một mình không buộc quote.
- Không sửa `RequestLogger`, `docker-compose.prod.yml`, `docker-compose.observability.yml`. Không lọc presence. Không `tty: true`. Không đổi chỗ gọi sang `tint.Err`.
- Comment code bằng tiếng Anh. Commit theo `.githooks/commit-msg`. Không `--no-verify`. Chưa có issue UniAI: không mở PR.
- Test logger không cần DB. Chạy trong `server/`.

## File structure

- `server/internal/logger/logger.go` — `colorEnabled`, `buildHandler`, `newHandler`. `Init` và `NewLogger` giữ nguyên.
- `server/internal/logger/text.go` — `textHandler`: xếp dòng, màu, quote, mutex.
- `server/internal/logger/logger_test.go` — test `colorEnabled` (task 1).
- `server/internal/logger/text_test.go` — test dòng text và `buildHandler` (task 2 và 3).
- `.env.example` — `LOG_COLOR`, `NO_COLOR`.
- `docs/ops/OBSERVABILITY.md` — sửa hàng `LOG_FORMAT`, thêm hàng `LOG_COLOR` và `NO_COLOR`.

---

### Task 1: Chính sách màu

**Files:**
- Modify: `server/internal/logger/logger.go`
- Test: `server/internal/logger/logger_test.go`

**Interfaces:**
- Consumes: không.
- Produces: `func colorEnabled(stderrIsTerminal bool) bool`

- [ ] **Step 1: Write the failing test**

Thêm vào cuối `server/internal/logger/logger_test.go`:

```go
func TestColorEnabled(t *testing.T) {
	cases := []struct {
		name  string
		color string
		no    string
		term  bool
		want  bool
	}{
		{name: "empty defaults on", color: "", no: "", term: false, want: true},
		{name: "always on without a tty", color: "always", no: "", term: false, want: true},
		{name: "never off even on a tty", color: "never", no: "", term: true, want: false},
		{name: "NO_COLOR wins over always", color: " ALWAYS ", no: "1", term: true, want: false},
		{name: "empty NO_COLOR does not disable", color: "always", no: "  ", term: false, want: true},
		{name: "auto follows the terminal bit", color: "Auto", no: "", term: false, want: false},
		{name: "auto on when the bit is set", color: "auto", no: "", term: true, want: true},
		{name: "unknown value is on", color: "weird", no: "", term: false, want: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("LOG_COLOR", tc.color)
			t.Setenv("NO_COLOR", tc.no)
			if got := colorEnabled(tc.term); got != tc.want {
				t.Fatalf("colorEnabled(%v) = %v, want %v", tc.term, got, tc.want)
			}
		})
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && go test ./internal/logger/ -count=1 -run TestColorEnabled`

Expected: FAIL, `undefined: colorEnabled`

- [ ] **Step 3: Write minimal implementation**

Thêm vào `server/internal/logger/logger.go`, ngay sau `isTerminal`:

```go
// colorEnabled decides ANSI for the text format. NO_COLOR wins over
// LOG_COLOR=always. auto is the only mode that consults the terminal bit.
// An empty LOG_COLOR, "always", and any other value turn colour on, including
// when stderr is a pipe.
func colorEnabled(stderrIsTerminal bool) bool {
	if strings.TrimSpace(os.Getenv("NO_COLOR")) != "" {
		return false
	}
	switch strings.ToLower(strings.TrimSpace(os.Getenv("LOG_COLOR"))) {
	case "never":
		return false
	case "auto":
		return stderrIsTerminal
	default:
		return true
	}
}
```

`os` và `strings` đã có trong import.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && go test ./internal/logger/ -count=1 -run 'TestColorEnabled|TestParseLevel|TestNewHandler|TestRequestAttrs'`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
gofmt -w server/internal/logger/logger.go server/internal/logger/logger_test.go
git add server/internal/logger/logger.go server/internal/logger/logger_test.go
git commit -m "$(cat <<'EOF'
test(server): pin when dev logs emit colour

EOF
)"
```

---

### Task 2: Handler text

**Files:**
- Create: `server/internal/logger/text.go`
- Create: `server/internal/logger/text_test.go`

**Interfaces:**
- Consumes: không (chưa gọi `colorEnabled`).
- Produces: `func newTextHandler(w io.Writer, level slog.Leveler, color bool) slog.Handler`

Hành vi `newTextHandler`:

- Level lọc bằng `level.Level()`. `nil` level coi như `slog.LevelDebug`.
- Dòng phẳng: thời gian `15:04:05.000`, nhãn `DBG`/`INF`/`WRN`/`ERR` (hậu tố `+N` hoặc `-N` như `tint`), message, rồi attr.
- Attr từ `WithAttrs` đứng trước attr của record. Attr zero bỏ. Key lặp in mỗi lần.
- Message `http request`: `method`, `path`, `status`, `duration` kéo lên đầu phần sáng. Key thiếu thì bỏ.
- Phần sáng còn lại theo thứ tự thu thập. Bộ mờ cuối dòng theo thứ tự constraint.
- Có màu: thời gian mờ; `DBG` không tô; `INF` `\033[92m`; `WRN` `\033[93m`; `ERR` `\033[91m`. Key và `=` của field sáng mờ, value sáng. `status` http tô theo mã khi kind là int/uint. `err` và `error` có value `\033[91m`. Field mờ là một span `\033[2m` bọc `key=value`. Mọi span reset bằng `\033[0m` trước field sau.
- Không màu: cùng thứ tự, không byte `0x1b`.
- Value: `error.Error()`, duration `String()`, số `FormatInt`/`FormatUint` cơ số 10, float `'g'`, bool `FormatBool`, time layout `2006-01-02T15:04:05.000Z07:00`. Panic lúc format thì value là `!PANIC`.
- Quote bằng `strconv.Quote` khi chuỗi rỗng, có space, `=`, `"`, byte `< 0x20`, ESC, hoặc rune không in được. `\` không buộc quote. `0x7f` không buộc quote.
- `WithGroup("")` trả chính handler. Tên khác rỗng, hoặc bất kỳ attr `KindGroup` sau `Resolve`, thì cả record đi `tint` (`TimeFormat` `15:04:05.000`, `NoColor: !color`).
- `Handle` trả lỗi của một lần `Write`. Writer dùng chung mutex với `tint` để hai dòng không xen byte.

- [ ] **Step 1: Write the failing test**

Tạo `server/internal/logger/text_test.go`:

```go
package logger

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"
)

func fixedRecord(level slog.Level, msg string, args ...any) slog.Record {
	r := slog.NewRecord(time.Date(2026, 10, 23, 15, 4, 5, 402_000_000, time.UTC), level, msg, 0)
	r.Add(args...)
	return r
}

func render(t *testing.T, color bool, level slog.Level, msg string, args ...any) string {
	t.Helper()
	var buf bytes.Buffer
	h := newTextHandler(&buf, slog.LevelDebug, color)
	if err := h.Handle(context.Background(), fixedRecord(level, msg, args...)); err != nil {
		t.Fatal(err)
	}
	return buf.String()
}

func stripANSI(s string) string {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		if s[i] != 0x1b {
			b.WriteByte(s[i])
			continue
		}
		j := strings.IndexByte(s[i:], 'm')
		if j < 0 {
			break
		}
		i += j
	}
	return b.String()
}

func TestTextHTTPOrderAndDimTail(t *testing.T) {
	plain := render(t, false, slog.LevelError, "http request",
		"trace_id", "aaa",
		"method", "POST",
		"path", "/chat",
		"status", 500,
		"duration", "12ms",
		"user_id", "u1",
		"room_id", "r1",
		"trace_id", "bbb",
	)
	if strings.Count(plain, "\n") != 1 {
		t.Fatalf("lines = %d\n%s", strings.Count(plain, "\n"), plain)
	}
	wantOrder := []string{
		"15:04:05.402", " ERR ", "http request",
		"method=POST", "path=/chat", "status=500", "duration=12ms",
		"user_id=u1", "room_id=r1", "trace_id=aaa", "trace_id=bbb",
	}
	pos := 0
	for _, part := range wantOrder {
		i := strings.Index(plain[pos:], part)
		if i < 0 {
			t.Fatalf("missing %q in %s", part, plain)
		}
		pos += i + len(part)
	}
	if strings.Contains(plain, "duration=") && strings.Count(plain, "duration=") != 1 {
		t.Fatalf("duration count: %s", plain)
	}

	colored := render(t, true, slog.LevelError, "http request",
		"method", "POST", "path", "/chat", "status", 500, "duration", "12ms",
		"trace_id", "tid",
	)
	uncolored := render(t, false, slog.LevelError, "http request",
		"method", "POST", "path", "/chat", "status", 500, "duration", "12ms", "trace_id", "tid")
	if stripANSI(colored) != uncolored {
		t.Fatalf("colour changed the text\ncolored %s\nplain   %s", stripANSI(colored), uncolored)
	}
	for _, seq := range []string{
		"\x1b[91mERR\x1b[0m",
		"\x1b[2mstatus=\x1b[0m\x1b[91m500\x1b[0m",
		"\x1b[2mtrace_id=tid\x1b[0m",
	} {
		if !strings.Contains(colored, seq) {
			t.Fatalf("missing %q in %q", seq, colored)
		}
	}
}

func TestTextStatusColours(t *testing.T) {
	info404 := render(t, true, slog.LevelInfo, "http request", "status", 404)
	if !strings.Contains(info404, "\x1b[92mINF\x1b[0m") || !strings.Contains(info404, "\x1b[93m404\x1b[0m") {
		t.Fatalf("soft 404 colours: %q", info404)
	}
	ok := render(t, true, slog.LevelInfo, "http request", "status", 201)
	if !strings.Contains(ok, "\x1b[92m201\x1b[0m") {
		t.Fatalf("2xx: %q", ok)
	}
	asUint := render(t, true, slog.LevelInfo, "http request", "status", uint64(200))
	if !strings.Contains(asUint, "\x1b[92m200\x1b[0m") {
		t.Fatalf("uint status: %q", asUint)
	}
	asString := render(t, true, slog.LevelError, "http request", "status", "500")
	if strings.Contains(asString, "\x1b[91m500") || strings.Contains(asString, "\x1b[91m\"500\"") {
		t.Fatalf("string status was coloured: %q", asString)
	}
	if !strings.Contains(stripANSI(asString), "status=500") {
		t.Fatalf("string status text: %q", asString)
	}
}

func TestTextWarnDimsTenantIDs(t *testing.T) {
	got := render(t, true, slog.LevelWarn, "chat: thread participants not read",
		"room_id", "r1", "error", "timeout", "organization_id", "org",
	)
	plain := stripANSI(got)
	room := strings.Index(plain, "room_id=r1")
	errAt := strings.Index(plain, "error=timeout")
	org := strings.Index(plain, "organization_id=org")
	if room < 0 || errAt < room || org < errAt {
		t.Fatalf("order: %s", plain)
	}
	if !strings.Contains(got, "\x1b[93mWRN\x1b[0m") {
		t.Fatalf("level: %q", got)
	}
	if !strings.Contains(got, "\x1b[91mtimeout\x1b[0m \x1b[2morganization_id=org\x1b[0m") {
		t.Fatalf("error red did not reset before the dim tail: %q", got)
	}
}

func TestTextQuotesNewlinesAndESC(t *testing.T) {
	for _, color := range []bool{false, true} {
		got := render(t, color, slog.LevelWarn, "x", "err", "boom\nnext", "room_id", "r1")
		if strings.Count(got, "\n") != 1 {
			t.Fatalf("color %v split the line: %q", color, got)
		}
		if !strings.Contains(stripANSI(got), `"boom\nnext"`) || !strings.Contains(stripANSI(got), "room_id=r1") {
			t.Fatalf("color %v quote: %s", color, stripANSI(got))
		}
		esc := render(t, color, slog.LevelWarn, "x", "err", "a\x1bb")
		if bytes.Contains([]byte(stripANSI(esc)), []byte{0x1b}) {
			t.Fatalf("color %v left a raw ESC in the value", color)
		}
		if !strings.Contains(esc, `\x1b`) {
			t.Fatalf("color %v did not keep the quoted escape: %q", color, esc)
		}
	}
	backslash := render(t, false, slog.LevelInfo, "x", "path", `a\b`)
	if !strings.Contains(backslash, `path=a\b`) || strings.Contains(backslash, `path="`) {
		t.Fatalf("backslash was quoted: %s", backslash)
	}
	msg := render(t, false, slog.LevelInfo, "line\nbreak")
	if strings.Count(msg, "\n") != 1 || !strings.Contains(msg, `"line\nbreak"`) {
		t.Fatalf("message not quoted: %q", msg)
	}
}

func TestTextPanicValueDoesNotDropTheRest(t *testing.T) {
	got := render(t, false, slog.LevelError, "x", "err", panicErr{}, "room_id", "r1")
	if !strings.Contains(got, "err=!PANIC") || !strings.Contains(got, "room_id=r1") {
		t.Fatalf("%s", got)
	}
	if strings.Index(got, "err=!PANIC") > strings.Index(got, "room_id=r1") {
		t.Fatalf("order: %s", got)
	}
}

type panicErr struct{}

func (panicErr) Error() string { panic("nope") }

func TestTextWithAttrsThenRecord(t *testing.T) {
	var buf bytes.Buffer
	h := newTextHandler(&buf, slog.LevelDebug, false).WithAttrs([]slog.Attr{slog.String("component", "server")})
	r := fixedRecord(slog.LevelWarn, "chat: x", "room_id", "r1", "organization_id", "org")
	if err := h.Handle(context.Background(), r); err != nil {
		t.Fatal(err)
	}
	got := buf.String()
	comp := strings.Index(got, "component=server")
	room := strings.Index(got, "room_id=r1")
	org := strings.Index(got, "organization_id=org")
	if comp < 0 || room < comp || org < room {
		t.Fatalf("order: %s", got)
	}
}

func TestTextOmitsZeroAttrAndMissingHead(t *testing.T) {
	var buf bytes.Buffer
	h := newTextHandler(&buf, slog.LevelDebug, false)
	r := fixedRecord(slog.LevelInfo, "http request", "method", "GET")
	r.AddAttrs(slog.Attr{})
	if err := h.Handle(context.Background(), r); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(buf.String(), "duration=") {
		t.Fatalf("printed an empty duration: %s", buf.String())
	}
}

func TestTextLevelOffsetAndFilter(t *testing.T) {
	got := render(t, true, slog.LevelDebug+1, "dbg")
	if !strings.Contains(got, "DBG+1") || strings.Contains(got, "\x1b[92mDBG") {
		t.Fatalf("debug offset: %q", got)
	}
	var buf bytes.Buffer
	h := newTextHandler(&buf, slog.LevelWarn, false)
	log := slog.New(h)
	log.Info("http request", "method", "GET")
	if buf.Len() != 0 {
		t.Fatalf("info passed a warn handler: %s", buf.String())
	}
	log.Warn("http request", "method", "GET")
	if !strings.Contains(buf.String(), "WRN") || !strings.Contains(buf.String(), "method=GET") {
		t.Fatalf("warn missing: %s", buf.String())
	}
}

func TestTextGroupFallsBackToTint(t *testing.T) {
	var buf bytes.Buffer
	h := newTextHandler(&buf, slog.LevelDebug, false).WithGroup("g")
	if err := h.Handle(context.Background(), fixedRecord(slog.LevelInfo, "http request", "method", "GET")); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(buf.String(), "g.method=GET") {
		t.Fatalf("with group: %s", buf.String())
	}
	buf.Reset()
	h = newTextHandler(&buf, slog.LevelDebug, true)
	r := fixedRecord(slog.LevelInfo, "nested", "ignored", "x")
	r.AddAttrs(slog.Group("g", slog.String("method", "GET")))
	if err := h.Handle(context.Background(), r); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(buf.String(), "g.method=GET") {
		t.Fatalf("kind group: %s", buf.String())
	}
}

func TestTextValueFormats(t *testing.T) {
	got := render(t, false, slog.LevelInfo, "vals",
		"took", 1500*time.Microsecond,
		"ok", true,
		"n", 1.5,
		"at", time.Date(2026, 10, 23, 1, 2, 3, 4_000_000, time.UTC),
	)
	for _, part := range []string{"took=1.5ms", "ok=true", "n=1.5", "at=2026-10-23T01:02:03.004Z"} {
		if !strings.Contains(got, part) {
			t.Fatalf("missing %s in %s", part, got)
		}
	}
}

type errWriter struct{}

func (errWriter) Write([]byte) (int, error) { return 0, io.ErrClosedPipe }

func TestTextHandleReturnsWriteError(t *testing.T) {
	h := newTextHandler(errWriter{}, slog.LevelDebug, false)
	err := h.Handle(context.Background(), fixedRecord(slog.LevelInfo, "x"))
	if !errors.Is(err, io.ErrClosedPipe) {
		t.Fatalf("err = %v", err)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && go test ./internal/logger/ -count=1 -run 'TestText'`

Expected: FAIL, `undefined: newTextHandler`

- [ ] **Step 3: Write minimal implementation**

Tạo `server/internal/logger/text.go` với đúng nội dung sau:

```go
package logger

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log/slog"
	"math"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/lmittmann/tint"
)

const (
	ansiReset        = "\u001b[0m"
	ansiFaint        = "\u001b[2m"
	ansiBrightRed    = "\u001b[91m"
	ansiBrightGreen  = "\u001b[92m"
	ansiBrightYellow = "\u001b[93m"

	textTimeFormat = "15:04:05.000"
	rfc3339Millis  = "2006-01-02T15:04:05.000Z07:00"
)

var httpHeadKeys = []string{"method", "path", "status", "duration"}

var dimKeys = []string{
	"request_id",
	"correlation_id",
	"trace_id",
	"span_id",
	"organization_id",
	"workspace_id",
	"actor_id",
	"actor_kind",
}

// lockedWriter is the single Write gate shared by the text line and the tint
// fallback, so one line is one Write.
type lockedWriter struct {
	mu *sync.Mutex
	w  io.Writer
}

func (l lockedWriter) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.w.Write(p)
}

type textHandler struct {
	w     io.Writer
	level slog.Leveler
	color bool
	pre   []slog.Attr
	group string
	tint  slog.Handler
}

func newTextHandler(w io.Writer, level slog.Leveler, color bool) slog.Handler {
	if level == nil {
		level = slog.LevelDebug
	}
	lw := lockedWriter{mu: &sync.Mutex{}, w: w}
	h := &textHandler{w: lw, level: level, color: color}
	h.tint = tint.NewTextHandler(lw, &tint.Options{
		Level:      level,
		TimeFormat: textTimeFormat,
		NoColor:    !color,
	})
	return h
}

func (h *textHandler) Enabled(_ context.Context, level slog.Level) bool {
	min := slog.LevelDebug
	if h.level != nil {
		min = h.level.Level()
	}
	return level >= min
}

func (h *textHandler) Handle(ctx context.Context, r slog.Record) error {
	attrs := h.collect(r)
	if h.group != "" || attrsHaveGroup(attrs) {
		return h.tint.Handle(ctx, r)
	}
	var buf bytes.Buffer
	h.writeLine(&buf, r, attrs)
	_, err := h.w.Write(buf.Bytes())
	return err
}

func (h *textHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	if len(attrs) == 0 {
		return h
	}
	h2 := h.clone()
	h2.pre = append(h2.pre, attrs...)
	h2.tint = h.tint.WithAttrs(attrs)
	return h2
}

func (h *textHandler) WithGroup(name string) slog.Handler {
	if name == "" {
		return h
	}
	h2 := h.clone()
	if h.group == "" {
		h2.group = name
	} else {
		h2.group = h.group + "." + name
	}
	h2.tint = h.tint.WithGroup(name)
	return h2
}

func (h *textHandler) clone() *textHandler {
	h2 := *h
	h2.pre = append([]slog.Attr(nil), h.pre...)
	return &h2
}

func (h *textHandler) collect(r slog.Record) []slog.Attr {
	out := make([]slog.Attr, 0, len(h.pre)+r.NumAttrs())
	out = append(out, h.pre...)
	r.Attrs(func(a slog.Attr) bool {
		out = append(out, a)
		return true
	})
	return out
}

func attrsHaveGroup(attrs []slog.Attr) bool {
	for _, a := range attrs {
		if kind, ok := safeKind(a.Value); ok && kind == slog.KindGroup {
			return true
		}
	}
	return false
}

func safeKind(v slog.Value) (k slog.Kind, ok bool) {
	defer func() {
		if recover() != nil {
			ok = false
		}
	}()
	return v.Resolve().Kind(), true
}

func (h *textHandler) writeLine(buf *bytes.Buffer, r slog.Record, attrs []slog.Attr) {
	writeTime(buf, r.Time, h.color)
	buf.WriteByte(' ')
	writeLevel(buf, r.Level, h.color)
	buf.WriteByte(' ')
	buf.WriteString(quoteIfNeeded(r.Message))

	var kept []slog.Attr
	for _, a := range attrs {
		if !a.Equal(slog.Attr{}) {
			kept = append(kept, a)
		}
	}
	head := map[string][]slog.Attr{}
	dim := map[string][]slog.Attr{}
	var bright []slog.Attr
	for _, a := range kept {
		switch {
		case r.Message == "http request" && listed(httpHeadKeys, a.Key):
			head[a.Key] = append(head[a.Key], a)
		case listed(dimKeys, a.Key):
			dim[a.Key] = append(dim[a.Key], a)
		default:
			bright = append(bright, a)
		}
	}
	if r.Message == "http request" {
		for _, k := range httpHeadKeys {
			for _, a := range head[k] {
				buf.WriteByte(' ')
				h.writeAttr(buf, a, r.Message, false)
			}
		}
	}
	for _, a := range bright {
		buf.WriteByte(' ')
		h.writeAttr(buf, a, r.Message, false)
	}
	for _, k := range dimKeys {
		for _, a := range dim[k] {
			buf.WriteByte(' ')
			h.writeAttr(buf, a, r.Message, true)
		}
	}
	buf.WriteByte('\n')
}

func listed(keys []string, key string) bool {
	for _, k := range keys {
		if k == key {
			return true
		}
	}
	return false
}

func (h *textHandler) writeAttr(buf *bytes.Buffer, a slog.Attr, msg string, dim bool) {
	val := quoteIfNeeded(formatValue(a.Value))
	if !h.color {
		buf.WriteString(a.Key)
		buf.WriteByte('=')
		buf.WriteString(val)
		return
	}
	if dim {
		buf.WriteString(ansiFaint)
		buf.WriteString(a.Key)
		buf.WriteByte('=')
		buf.WriteString(val)
		buf.WriteString(ansiReset)
		return
	}
	buf.WriteString(ansiFaint)
	buf.WriteString(a.Key)
	buf.WriteByte('=')
	buf.WriteString(ansiReset)
	if c := h.valueColor(msg, a); c != "" {
		buf.WriteString(c)
		buf.WriteString(val)
		buf.WriteString(ansiReset)
		return
	}
	buf.WriteString(val)
}

func (h *textHandler) valueColor(msg string, a slog.Attr) string {
	if a.Key == "err" || a.Key == "error" {
		return ansiBrightRed
	}
	if msg == "http request" && a.Key == "status" {
		if n, ok := statusCode(a.Value); ok {
			switch {
			case n >= 500:
				return ansiBrightRed
			case n >= 400:
				return ansiBrightYellow
			default:
				return ansiBrightGreen
			}
		}
	}
	return ""
}

func statusCode(v slog.Value) (int64, bool) {
	v = v.Resolve()
	switch v.Kind() {
	case slog.KindInt64:
		return v.Int64(), true
	case slog.KindUint64:
		u := v.Uint64()
		if u > uint64(math.MaxInt64) {
			return math.MaxInt64, true
		}
		return int64(u), true
	default:
		return 0, false
	}
}

func writeTime(buf *bytes.Buffer, t time.Time, color bool) {
	formatted := t.AppendFormat(nil, textTimeFormat)
	if color {
		buf.WriteString(ansiFaint)
	}
	buf.Write(formatted)
	if color {
		buf.WriteString(ansiReset)
	}
}

func writeLevel(buf *bytes.Buffer, level slog.Level, color bool) {
	label := levelLabel(level)
	c := ""
	if color {
		c = levelANSI(level)
	}
	if c != "" {
		buf.WriteString(c)
	}
	buf.WriteString(label)
	if c != "" {
		buf.WriteString(ansiReset)
	}
}

func levelANSI(level slog.Level) string {
	switch {
	case level < slog.LevelInfo:
		return ""
	case level < slog.LevelWarn:
		return ansiBrightGreen
	case level < slog.LevelError:
		return ansiBrightYellow
	default:
		return ansiBrightRed
	}
}

func levelLabel(level slog.Level) string {
	switch {
	case level < slog.LevelInfo:
		return levelDelta("DBG", level-slog.LevelDebug)
	case level < slog.LevelWarn:
		return levelDelta("INF", level-slog.LevelInfo)
	case level < slog.LevelError:
		return levelDelta("WRN", level-slog.LevelWarn)
	default:
		return levelDelta("ERR", level-slog.LevelError)
	}
}

func levelDelta(base string, d slog.Level) string {
	if d == 0 {
		return base
	}
	if d > 0 {
		return base + "+" + strconv.FormatInt(int64(d), 10)
	}
	return base + strconv.FormatInt(int64(d), 10)
}

func formatValue(v slog.Value) (s string) {
	defer func() {
		if recover() != nil {
			s = "!PANIC"
		}
	}()
	v = v.Resolve()
	switch v.Kind() {
	case slog.KindString:
		return v.String()
	case slog.KindInt64:
		return strconv.FormatInt(v.Int64(), 10)
	case slog.KindUint64:
		return strconv.FormatUint(v.Uint64(), 10)
	case slog.KindFloat64:
		return strconv.FormatFloat(v.Float64(), 'g', -1, 64)
	case slog.KindBool:
		return strconv.FormatBool(v.Bool())
	case slog.KindDuration:
		return v.Duration().String()
	case slog.KindTime:
		return v.Time().Format(rfc3339Millis)
	case slog.KindAny:
		if err, ok := v.Any().(error); ok && err != nil {
			return err.Error()
		}
		return fmt.Sprint(v.Any())
	default:
		return fmt.Sprint(v.Any())
	}
}

func quoteIfNeeded(s string) string {
	if needsQuoting(s) {
		return strconv.Quote(s)
	}
	return s
}

func needsQuoting(s string) bool {
	if s == "" || strings.Contains(s, "\u001b") {
		return true
	}
	for i := 0; i < len(s); {
		c := s[i]
		if c < utf8.RuneSelf {
			if c != '\\' && (c == ' ' || c == '=' || c == '"' || c < ' ') {
				return true
			}
			i++
			continue
		}
		r, size := utf8.DecodeRuneInString(s[i:])
		if r == utf8.RuneError || unicode.IsSpace(r) || !unicode.IsPrint(r) {
			return true
		}
		i += size
	}
	return false
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && gofmt -w internal/logger/text.go internal/logger/text_test.go && go test ./internal/logger/ -count=1 -run 'TestText|TestColorEnabled|TestParseLevel|TestNewHandler|TestRequestAttrs'`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/internal/logger/text.go server/internal/logger/text_test.go
git commit -m "$(cat <<'EOF'
feat(server): print dev logs with ids faded at the end of the line

EOF
)"
```

---

### Task 3: Gắn handler và tài liệu

**Files:**
- Modify: `server/internal/logger/logger.go`
- Modify: `server/internal/logger/text_test.go`
- Modify: `.env.example` (khối `LOG_LEVEL` / `LOG_FORMAT`)
- Modify: `docs/ops/OBSERVABILITY.md` (bảng cấu hình, hàng `LOG_FORMAT`)

**Interfaces:**
- Consumes: `colorEnabled(stderrIsTerminal bool) bool`, `newTextHandler(w io.Writer, level slog.Leveler, color bool) slog.Handler`, `parseLevel`, `isTerminal`, `telemetry.WrapLogHandler`.
- Produces: `func buildHandler(w io.Writer, stderrIsTerminal bool) slog.Handler`. `newHandler` gọi `buildHandler(os.Stderr, isTerminal(os.Stderr))`.

- [ ] **Step 1: Write the failing test**

Thêm vào cuối `server/internal/logger/text_test.go`:

```go
func TestBuildHandlerTextColorsAPipe(t *testing.T) {
	t.Setenv("LOG_FORMAT", "")
	t.Setenv("LOG_LEVEL", "debug")
	t.Setenv("LOG_COLOR", "")
	t.Setenv("NO_COLOR", "")
	var buf bytes.Buffer
	h := buildHandler(&buf, false)
	if err := h.Handle(context.Background(), fixedRecord(slog.LevelInfo, "http request",
		"method", "GET", "status", 200, "trace_id", "tid")); err != nil {
		t.Fatal(err)
	}
	got := buf.String()
	if !strings.Contains(got, "\x1b[92mINF\x1b[0m") || !strings.Contains(got, "\x1b[2mtrace_id=tid\x1b[0m") {
		t.Fatalf("pipe was not coloured: %q", got)
	}
	if !strings.Contains(got, "method=GET") || strings.Index(got, "method=GET") > strings.Index(got, "trace_id=tid") {
		t.Fatalf("order: %s", stripANSI(got))
	}
}

func TestBuildHandlerNeverAndNoColorStripANSI(t *testing.T) {
	for _, tc := range []struct{ color, no string }{
		{color: "never", no: ""},
		{color: "always", no: "1"},
	} {
		t.Run(tc.color+"/"+tc.no, func(t *testing.T) {
			t.Setenv("LOG_FORMAT", "text")
			t.Setenv("LOG_LEVEL", "debug")
			t.Setenv("LOG_COLOR", tc.color)
			t.Setenv("NO_COLOR", tc.no)
			var buf bytes.Buffer
			h := buildHandler(&buf, true)
			if err := h.Handle(context.Background(), fixedRecord(slog.LevelInfo, "http request", "method", "GET", "trace_id", "tid")); err != nil {
				t.Fatal(err)
			}
			if bytes.Contains(buf.Bytes(), []byte{0x1b}) {
				t.Fatalf("ANSI leaked: %q", buf.String())
			}
			if !strings.Contains(buf.String(), "method=GET") || strings.Index(buf.String(), "method=GET") > strings.Index(buf.String(), "trace_id=tid") {
				t.Fatalf("order: %s", buf.String())
			}
		})
	}
}

func TestBuildHandlerJSONSkipsTheTextLayout(t *testing.T) {
	t.Setenv("LOG_FORMAT", " JSON ")
	t.Setenv("LOG_LEVEL", "warn")
	t.Setenv("LOG_COLOR", "")
	t.Setenv("NO_COLOR", "")
	var buf bytes.Buffer
	h := buildHandler(&buf, false)
	log := slog.New(h)
	log.Info("http request", "method", "GET", "trace_id", "tid")
	if buf.Len() != 0 {
		t.Fatalf("info was written at warn: %s", buf.String())
	}
	log.Warn("http request", "method", "GET", "trace_id", "tid")
	line := buf.Bytes()
	if bytes.Contains(line, []byte{0x1b}) {
		t.Fatalf("json contained ANSI: %s", line)
	}
	if !bytes.HasPrefix(bytes.TrimSpace(line), []byte("{")) {
		t.Fatalf("not json: %s", line)
	}
	method := bytes.Index(line, []byte(`"method"`))
	trace := bytes.Index(line, []byte(`"trace_id"`))
	if method < 0 || trace < method {
		t.Fatalf("json field order changed: %s", line)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && go test ./internal/logger/ -count=1 -run 'TestBuildHandler'`

Expected: FAIL, `undefined: buildHandler`

- [ ] **Step 3: Write minimal implementation**

Trong `server/internal/logger/logger.go`, thay comment đầu file bằng:

```go
// Package logger configures slog for the server. LOG_FORMAT=json is one JSON
// object per line. Any other value is the dev text handler, which colours
// stderr even when it is not a terminal. NO_COLOR and LOG_COLOR=never switch
// that colour off; LOG_COLOR=auto keeps the old terminal check. LOG_LEVEL
// selects the minimum level. RequestAttrs lifts request-scoped dimensions
// into handler log lines so they match the access log.
```

Thay comment của `isTerminal` bằng:

```go
// isTerminal reports whether f is attached to a terminal. Only LOG_COLOR=auto
// consults it. The default text format colours a pipe.
```

Xóa import `github.com/lmittmann/tint` khỏi `logger.go` (tint chỉ còn ở `text.go`). Thay cả hàm `newHandler` bằng:

```go
// buildHandler is the test seam. newHandler passes os.Stderr and whether that
// file is a terminal. Colour is decided once, here, not per line.
func buildHandler(w io.Writer, stderrIsTerminal bool) slog.Handler {
	level := parseLevel(os.Getenv("LOG_LEVEL"))
	if strings.EqualFold(strings.TrimSpace(os.Getenv("LOG_FORMAT")), "json") {
		return telemetry.WrapLogHandler(slog.NewJSONHandler(w, &slog.HandlerOptions{Level: level}))
	}
	return telemetry.WrapLogHandler(newTextHandler(w, level, colorEnabled(stderrIsTerminal)))
}

// newHandler picks the sink by LOG_FORMAT and wraps it so context-aware lines
// carry trace and tenant fields.
func newHandler() slog.Handler {
	return buildHandler(os.Stderr, isTerminal(os.Stderr))
}
```

Thêm `"io"` vào import của `logger.go`.

Trong `.env.example`, thay khối comment của `LOG_FORMAT` bằng:

```
# json in production (one object per line, trace_id on every request line).
# Anything else is the dev text handler, coloured even when stderr is a pipe.
LOG_FORMAT=
# always (default, including docker logs) | auto | never.
# auto colours only when stderr is a terminal. never switches colour off.
# A non-empty NO_COLOR also switches colour off and wins over always.
LOG_COLOR=
# Non-empty disables dev-log colour. Empty or unset does not.
NO_COLOR=
```

Trong `docs/ops/OBSERVABILITY.md`, thay hàng `LOG_FORMAT` bằng hai hàng (giữ hàng `LOG_LEVEL` ngay sau):

```
| `LOG_FORMAT` | text | `json` ở production: một object mỗi dòng, không ANSI, thứ tự field không đổi. Giá trị khác là handler text cho log dev |
| `LOG_COLOR` | bật | `always` (mặc định, kể cả pipe của Docker), `auto` (chỉ khi stderr là terminal), `never` tắt màu. So sánh không phân biệt hoa thường |
| `NO_COLOR` | trống | Khác rỗng thì tắt màu và thắng `LOG_COLOR=always`. Trống không tắt |
```

Không sửa `Init`, `NewLogger`, `RequestLogger`, compose.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && gofmt -w internal/logger/logger.go internal/logger/text.go internal/logger/text_test.go && go test ./internal/logger/ -count=1 && cd .. && node --test scripts/env-example.test.mjs`

Expected: package `logger` PASS, và `env-example.test.mjs` PASS.

- [ ] **Step 5: Commit**

```bash
git add server/internal/logger/logger.go server/internal/logger/text_test.go .env.example docs/ops/OBSERVABILITY.md
git commit -m "$(cat <<'EOF'
feat(server): colour dev logs when docker captures stderr

EOF
)"
```
