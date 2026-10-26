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

// lockedWriter serializes Write so concurrent Handle calls do not interleave lines.
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
}

func newTextHandler(w io.Writer, level slog.Leveler, color bool) slog.Handler {
	if level == nil {
		level = slog.LevelDebug
	}
	lw := lockedWriter{mu: &sync.Mutex{}, w: w}
	return &textHandler{w: lw, level: level, color: color}
}

func (h *textHandler) Enabled(_ context.Context, level slog.Level) bool {
	min := slog.LevelDebug
	if h.level != nil {
		min = h.level.Level()
	}
	return level >= min
}

func (h *textHandler) Handle(_ context.Context, r slog.Record) error {
	var buf bytes.Buffer
	h.writeLine(&buf, r, h.collect(r))
	_, err := h.w.Write(buf.Bytes())
	return err
}

func (h *textHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	if len(attrs) == 0 {
		return h
	}
	h2 := h.clone()
	h2.pre = append(h2.pre, flattenAttrs(h.group, attrs)...)
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
	var rec []slog.Attr
	r.Attrs(func(a slog.Attr) bool {
		rec = append(rec, a)
		return true
	})
	out = append(out, flattenAttrs(h.group, rec)...)
	return out
}

// logFormatPanic makes formatValue emit !PANIC when slog.Resolve already absorbed a LogValue panic.
type logFormatPanic struct{}

func (logFormatPanic) Error() string { panic("nope") }

func logValueResolveFailed(v slog.Value) bool {
	if v.Kind() != slog.KindAny {
		return false
	}
	err, ok := v.Any().(error)
	if !ok {
		return false
	}
	var msg string
	func() {
		defer func() {
			if recover() != nil {
				msg = ""
			}
		}()
		msg = err.Error()
	}()
	return strings.HasPrefix(msg, "LogValue panicked")
}

func joinPrefix(prefix, key string) string {
	if prefix == "" {
		return key
	}
	if key == "" {
		return prefix
	}
	return prefix + "." + key
}

func flattenAttrs(prefix string, attrs []slog.Attr) []slog.Attr {
	var out []slog.Attr
	for _, a := range attrs {
		if a.Equal(slog.Attr{}) {
			continue
		}
		key := joinPrefix(prefix, a.Key)
		val := a.Value
		if val.Kind() == slog.KindLogValuer {
			resolved := val.Resolve()
			if logValueResolveFailed(resolved) {
				out = append(out, slog.Attr{Key: key, Value: slog.AnyValue(logFormatPanic{})})
				continue
			}
			if resolved.Kind() == slog.KindGroup {
				children := resolved.Group()
				if len(children) == 0 {
					continue
				}
				out = append(out, flattenAttrs(joinPrefix(prefix, a.Key), children)...)
				continue
			}
			if resolved.Kind() == slog.KindAny {
				if err, ok := resolved.Any().(error); ok && err != nil {
					out = append(out, slog.Attr{Key: key, Value: slog.StringValue(err.Error())})
					continue
				}
			}
			out = append(out, slog.Attr{Key: key, Value: resolved})
			continue
		}
		if val.Kind() == slog.KindGroup {
			children := val.Group()
			if len(children) == 0 {
				continue
			}
			out = append(out, flattenAttrs(joinPrefix(prefix, a.Key), children)...)
			continue
		}
		out = append(out, slog.Attr{Key: key, Value: val})
	}
	return out
}

func attrBaseKey(key string) string {
	if i := strings.LastIndex(key, "."); i >= 0 {
		return key[i+1:]
	}
	return key
}

func (h *textHandler) writeLine(buf *bytes.Buffer, r slog.Record, attrs []slog.Attr) {
	writeTime(buf, r.Time, h.color)
	buf.WriteByte(' ')
	writeLevel(buf, r.Level, h.color)
	buf.WriteByte(' ')
	buf.WriteString(quoteMessage(r.Message))

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
	base := attrBaseKey(a.Key)
	if base == "err" || base == "error" {
		return ansiBrightRed
	}
	if msg == "http request" && base == "status" {
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

func quoteMessage(s string) string {
	if messageNeedsQuoting(s) {
		return strconv.Quote(s)
	}
	return s
}

func messageNeedsQuoting(s string) bool {
	for i := 0; i < len(s); {
		c := s[i]
		if c < utf8.RuneSelf {
			if c < 0x20 {
				return true
			}
			i++
			continue
		}
		r, size := utf8.DecodeRuneInString(s[i:])
		if r == utf8.RuneError || !unicode.IsPrint(r) {
			return true
		}
		i += size
	}
	return false
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
