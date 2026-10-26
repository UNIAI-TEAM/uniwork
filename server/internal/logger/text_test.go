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

func TestTextMessageQuoting(t *testing.T) {
	httpLine := render(t, false, slog.LevelInfo, "http request", "method", "GET")
	if strings.Contains(httpLine, `"http request"`) {
		t.Fatalf("http message quoted: %q", httpLine)
	}
	chatLine := render(t, false, slog.LevelWarn, "chat: thread participants not read", "room_id", "r1")
	if strings.Contains(chatLine, `"chat:`) {
		t.Fatalf("chat message quoted: %q", chatLine)
	}
	for _, tc := range []struct {
		msg      string
		forbid   string
		contains string
	}{
		{"", `""`, " INF "},
		{`a\b`, `"a\\b"`, `a\b`},
		{"a=b", `"a=b"`, "a=b"},
		{`say "hi"`, `"say \"hi\""`, `say "hi"`},
	} {
		got := render(t, false, slog.LevelInfo, tc.msg)
		if tc.forbid != "" && strings.Contains(got, tc.forbid) {
			t.Fatalf("msg %q quoted as %q: %q", tc.msg, tc.forbid, got)
		}
		if tc.contains != "" && !strings.Contains(got, tc.contains) {
			t.Fatalf("msg %q missing %q: %q", tc.msg, tc.contains, got)
		}
	}
	for _, color := range []bool{false, true} {
		msgNL := render(t, color, slog.LevelInfo, "line\nbreak")
		if strings.Count(msgNL, "\n") != 1 || !strings.Contains(stripANSI(msgNL), `"line\nbreak"`) {
			t.Fatalf("color %v newline message: %q", color, msgNL)
		}
		msgEsc := render(t, color, slog.LevelInfo, "a\x1bb")
		if bytes.Contains([]byte(stripANSI(msgEsc)), []byte{0x1b}) {
			t.Fatalf("color %v raw ESC in message", color)
		}
		if !strings.Contains(stripANSI(msgEsc), `\x1b`) {
			t.Fatalf("color %v message escape not quoted: %q", color, stripANSI(msgEsc))
		}
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
}

type countingErr struct {
	n   *int
	msg string
}

func (e countingErr) Error() string {
	*e.n++
	return e.msg
}

func TestTextPlainErrorLogValuePanickedMessage(t *testing.T) {
	var n int
	err := countingErr{n: &n, msg: "LogValue panicked: real"}
	got := render(t, false, slog.LevelError, "x", "err", err)
	if strings.Contains(got, "!PANIC") {
		t.Fatalf("rewrote plain error to panic: %s", got)
	}
	if !strings.Contains(got, "LogValue panicked: real") {
		t.Fatalf("missing error text: %s", got)
	}
	if n != 1 {
		t.Fatalf("Error() calls = %d, want 1", n)
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

func TestTextGroupPrefixesKeys(t *testing.T) {
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
	if !strings.Contains(stripANSI(buf.String()), "g.method=GET") {
		t.Fatalf("kind group: %s", buf.String())
	}

	for _, color := range []bool{false, true} {
		buf.Reset()
		h = newTextHandler(&buf, slog.LevelDebug, color).WithGroup("g")
		if err := h.Handle(context.Background(), fixedRecord(slog.LevelWarn, "x", "err", "boom\nnext", "err", "a\x1bb")); err != nil {
			t.Fatal(err)
		}
		got := buf.String()
		if strings.Count(got, "\n") != 1 {
			t.Fatalf("color %v split line: %q", color, got)
		}
		plain := stripANSI(got)
		if color == false && bytes.Contains([]byte(plain), []byte{0x1b}) {
			t.Fatalf("color off has raw ESC: %q", plain)
		}
		if !strings.Contains(plain, `"boom\nnext"`) || !strings.Contains(plain, `\x1b`) {
			t.Fatalf("color %v group err quote: %q", color, plain)
		}
	}

	buf.Reset()
	h = newTextHandler(&buf, slog.LevelDebug, false).WithGroup("g").WithGroup("inner")
	if err := h.Handle(context.Background(), fixedRecord(slog.LevelInfo, "x", "method", "GET")); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(buf.String(), "g.inner.method=GET") {
		t.Fatalf("nested group: %s", buf.String())
	}

	buf.Reset()
	h = newTextHandler(&buf, slog.LevelDebug, false).
		WithAttrs([]slog.Attr{slog.String("component", "server")}).
		WithGroup("g")
	if err := h.Handle(context.Background(), fixedRecord(slog.LevelInfo, "x", "method", "GET")); err != nil {
		t.Fatal(err)
	}
	got := buf.String()
	if !strings.Contains(got, "component=server") || !strings.Contains(got, "g.method=GET") {
		t.Fatalf("with attrs then group: %s", got)
	}
	if strings.Contains(got, "g.component") {
		t.Fatalf("prefixed earlier attr: %s", got)
	}
	comp := strings.Index(got, "component=server")
	gmeth := strings.Index(got, "g.method=GET")
	if comp < 0 || gmeth < comp {
		t.Fatalf("order: %s", got)
	}

	buf.Reset()
	h = newTextHandler(&buf, slog.LevelDebug, false)
	r = fixedRecord(slog.LevelInfo, "anon group")
	r.AddAttrs(slog.Group("", slog.String("method", "GET")))
	if err := h.Handle(context.Background(), r); err != nil {
		t.Fatal(err)
	}
	got = buf.String()
	if !strings.Contains(got, "method=GET") || strings.Contains(got, ".method=") {
		t.Fatalf("empty group name: %s", got)
	}

	buf.Reset()
	h = newTextHandler(&buf, slog.LevelDebug, false)
	r = fixedRecord(slog.LevelInfo, "empty group", "room_id", "r1")
	r.AddAttrs(slog.Group("empty"))
	if err := h.Handle(context.Background(), r); err != nil {
		t.Fatal(err)
	}
	got = buf.String()
	if strings.Contains(got, "empty=") || !strings.Contains(got, "room_id=r1") {
		t.Fatalf("empty named group: %s", got)
	}

	buf.Reset()
	h = newTextHandler(&buf, slog.LevelDebug, false)
	r = fixedRecord(slog.LevelInfo, "zero in group")
	r.AddAttrs(slog.Group("g", slog.Attr{}, slog.String("method", "GET")))
	if err := h.Handle(context.Background(), r); err != nil {
		t.Fatal(err)
	}
	got = buf.String()
	if !strings.Contains(got, "g.method=GET") || strings.Contains(got, "g.=") {
		t.Fatalf("zero attr in group: %s", got)
	}

	buf.Reset()
	h = newTextHandler(&buf, slog.LevelDebug, true).WithGroup("g")
	if err := h.Handle(context.Background(), fixedRecord(slog.LevelInfo, "scoped dim",
		"request_id", "01H", "organization_id", "org")); err != nil {
		t.Fatal(err)
	}
	got = buf.String()
	if !strings.Contains(got, "\x1b[2mg.request_id=\x1b[0m") {
		t.Fatalf("group-prefixed request_id tint: %q", got)
	}
	if strings.Contains(got, "\x1b[2mg.request_id=01H") {
		t.Fatalf("value must not stay faint: %q", got)
	}
	req := strings.Index(got, "g.request_id")
	org := strings.Index(got, "organization_id")
	if req < 0 || org < 0 || req >= org {
		t.Fatalf("order g.request_id before organization_id: %q", got)
	}
}

type groupLogValuer struct{}

func (groupLogValuer) LogValue() slog.Value {
	return slog.GroupValue(slog.String("method", "GET"))
}

type panicLogValuer struct{}

func (panicLogValuer) LogValue() slog.Value {
	panic("nope")
}

type errorLogValuer struct {
	err error
}

func (v errorLogValuer) LogValue() slog.Value {
	return slog.AnyValue(v.err)
}

func TestTextLogValuerErrorCallsErrorOnce(t *testing.T) {
	var n int
	err := countingErr{n: &n, msg: "timeout"}
	got := render(t, false, slog.LevelError, "x", slog.Any("err", errorLogValuer{err: err}))
	if n != 1 {
		t.Fatalf("Error() calls = %d, want 1", n)
	}
	if !strings.Contains(got, "timeout") {
		t.Fatalf("missing error text: %s", got)
	}
	if strings.Contains(got, "!PANIC") {
		t.Fatalf("unexpected panic marker: %s", got)
	}
}

func TestTextLogValuerPanickingErrorDoesNotEscapeHandle(t *testing.T) {
	var buf bytes.Buffer
	h := newTextHandler(&buf, slog.LevelDebug, false)
	r := fixedRecord(slog.LevelError, "x",
		slog.Any("err", errorLogValuer{err: panicErr{}}),
		"room_id", "r1",
	)
	if err := h.Handle(context.Background(), r); err != nil {
		t.Fatal(err)
	}
	got := buf.String()
	if !strings.Contains(got, "!PANIC") {
		t.Fatalf("missing panic marker: %s", got)
	}
	if !strings.Contains(got, "room_id=r1") {
		t.Fatalf("dropped trailing attr: %s", got)
	}
}

func TestTextLogValuerGroupAndPanic(t *testing.T) {
	got := render(t, false, slog.LevelInfo, "valuer group", slog.Any("g", groupLogValuer{}))
	if !strings.Contains(got, "g.method=GET") {
		t.Fatalf("group valuer: %s", got)
	}
	got = render(t, false, slog.LevelError, "valuer panic",
		slog.Any("bad", panicLogValuer{}), "room_id", "r1")
	if !strings.Contains(got, "bad=!PANIC") || !strings.Contains(got, "room_id=r1") {
		t.Fatalf("panic valuer: %s", got)
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
	plain := stripANSI(got)
	if !strings.Contains(plain, "method=GET") || !strings.Contains(plain, "trace_id=tid") ||
		strings.Index(plain, "method=GET") > strings.Index(plain, "trace_id=tid") {
		t.Fatalf("order: %s", plain)
	}
	if !strings.Contains(got, "\x1b[2mmethod=\x1b[0mGET") {
		t.Fatalf("method key should reset before value: %q", got)
	}
	if strings.Contains(got, "\x1b[2mmethod=GET\x1b[0m") {
		t.Fatalf("method value should not be faint: %q", got)
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
