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
