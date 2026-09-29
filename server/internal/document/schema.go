// Package document owns the closed page-JSON schema and the server-side
// sanitizer for Documents (C-01 §3.7; UNI-675). The package is a leaf: it
// imports no service, storage or files package so the same rules can be
// shared with packages/core/documents (TypeScript) through the parity
// fixtures in docs/parity/document-schema.json.
package document

import (
	"math"
	"unicode"
)

// Limits bound what a page document may contain. The defaults are the
// contract values from C-01 §3.7; tests and future callers may tighten them
// through SanitizeWithLimits.
type Limits struct {
	// MaxInputBytes rejects obviously oversized payloads before parsing.
	MaxInputBytes int64
	// MaxBytes is the cap on the sanitized JSON (2 MiB on the wire).
	MaxBytes int64
	// MaxDepth is the deepest allowed node nesting; the doc root is depth 0.
	MaxDepth int
	// MaxNodes is the total node count including the doc root.
	MaxNodes int
	// MaxTableRows / MaxTableCols bound one table's shape.
	MaxTableRows int
	MaxTableCols int
}

// DefaultLimits returns the C-01 §3.7 contract bounds.
func DefaultLimits() Limits {
	return Limits{
		MaxInputBytes: 8 << 20, // 8 MiB raw input
		MaxBytes:      2 << 20, // 2 MiB after sanitize
		MaxDepth:      50,
		MaxNodes:      50000,
		MaxTableRows:  200,
		MaxTableCols:  20,
	}
}

// Error is the sanitizer's typed failure. Code is the stable wire code the
// service maps to an HTTP status (document_too_large -> 413,
// document_invalid -> 400).
type Error struct {
	Code string
	Msg  string
}

func (e *Error) Error() string { return e.Code + ": " + e.Msg }

const (
	ErrCodeInvalid  = "document_invalid"
	ErrCodeTooLarge = "document_too_large"
)

func errInvalid(msg string) *Error  { return &Error{Code: ErrCodeInvalid, Msg: msg} }
func errTooLarge(msg string) *Error { return &Error{Code: ErrCodeTooLarge, Msg: msg} }

// attrRule validates one JSON attr value already decoded to `any`. A failed
// optional attr is dropped; a failed required attr drops the whole node.
type attrRule func(v any) bool

// nodeSpec is one entry of the closed node set.
type nodeSpec struct {
	attrs    map[string]attrRule // nil: no attrs allowed
	required []string            // attrs that must validate or the node drops
	leaf     bool                // never carries `content`
	inline   bool                // joins siblings without a newline in text
}

// markSpec mirrors nodeSpec for marks; only `link` carries attrs today.
type markSpec struct {
	attrs    map[string]attrRule
	required []string
}

// NodeTypes is the closed node vocabulary, exported so the TypeScript mirror
// and tests can assert the same set without duplicating it by hand.
var NodeTypes = []string{
	"paragraph", "heading", "bulletList", "orderedList", "listItem",
	"taskList", "taskItem", "blockquote", "codeBlock", "horizontalRule",
	"hardBreak", "image", "table", "tableRow", "tableCell", "tableHeader",
	"mention", "text",
}

// MarkTypes is the closed mark vocabulary.
var MarkTypes = []string{
	"bold", "italic", "underline", "strike", "code", "link",
}

// MentionKinds is the closed mention kind vocabulary (C-01 §3.7).
var MentionKinds = []string{"user", "task", "document", "meeting"}

var nodeSpecs = map[string]nodeSpec{
	"paragraph": {},
	"heading": {
		attrs:    map[string]attrRule{"level": isIntBetween(1, 3)},
		required: []string{"level"},
	},
	"bulletList": {},
	"orderedList": {
		attrs: map[string]attrRule{"start": isIntBetween(1, maxListStart)},
	},
	"listItem":       {},
	"taskList":       {},
	"taskItem":       {attrs: map[string]attrRule{"checked": isBool}},
	"blockquote":     {},
	"codeBlock":      {attrs: map[string]attrRule{"language": isStringLen(64)}},
	"horizontalRule": {leaf: true},
	"hardBreak":      {leaf: true, inline: true},
	"image": {
		attrs: map[string]attrRule{
			"src":   isAssetRef,
			"alt":   isStringLen(512),
			"width": isIntBetween(1, maxImageWidth),
		},
		required: []string{"src"},
		leaf:     true,
		inline:   true,
	},
	"table":       {},
	"tableRow":    {},
	"tableCell":   {attrs: map[string]attrRule{"colspan": isIntBetween(1, maxColspan), "rowspan": isIntBetween(1, maxRowspan)}},
	"tableHeader": {attrs: map[string]attrRule{"colspan": isIntBetween(1, maxColspan), "rowspan": isIntBetween(1, maxRowspan)}},
	"mention": {
		attrs: map[string]attrRule{
			"kind":  isMentionKind,
			"id":    isULID,
			"label": isStringLen(256),
		},
		required: []string{"kind", "id"},
		leaf:     true,
		inline:   true,
	},
	"text": {leaf: true, inline: true},
}

var markSpecs = map[string]markSpec{
	"bold":      {},
	"italic":    {},
	"underline": {},
	"strike":    {},
	"code":      {},
	"link": {
		attrs:    map[string]attrRule{"href": isSafeHref},
		required: []string{"href"},
	},
}

// Product bounds for numeric attrs, shared with the TypeScript mirror
// (schema.ts must keep the same values). They sit far above anything a page
// shows and far below the float64/int64 edge where the two languages used to
// disagree.
const (
	maxListStart  = 1_000_000_000
	maxImageWidth = 10_000
	maxColspan    = 20  // a span can never exceed the table column bound
	maxRowspan    = 200 // nor the table row bound
)

func isBool(v any) bool {
	_, ok := v.(bool)
	return ok
}

// isIntBetween accepts a JSON number with an integral value inside [lo, hi].
// The bounds are compared in float64 first: int() on a value outside the int
// range is implementation-defined, so the conversion only happens once f is
// known to fit.
func isIntBetween(lo, hi int) attrRule {
	return func(v any) bool {
		f, ok := v.(float64)
		if !ok || f < float64(lo) || f > float64(hi) || f != math.Trunc(f) {
			return false
		}
		return true
	}
}

// isStringLen accepts a string of at most n runes.
func isStringLen(n int) attrRule {
	return func(v any) bool {
		s, ok := v.(string)
		return ok && len([]rune(s)) <= n
	}
}

var ulidPattern = []byte("0123456789ABCDEFGHJKMNPQRSTVWXYZ")

// isULID accepts the canonical 26-char Crockford-base32 ULID, upper or lower
// case (the mirror in TypeScript applies the same character set).
func isULID(v any) bool {
	s, ok := v.(string)
	if !ok || len(s) != 26 {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= 'a' && c <= 'z' {
			c -= 'a' - 'A'
		}
		found := false
		for _, b := range ulidPattern {
			if c == b {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}

// isAssetRef accepts image sources of the form asset://{ulid}.
func isAssetRef(v any) bool {
	s, ok := v.(string)
	const prefix = "asset://"
	if !ok || len(s) <= len(prefix) || s[:len(prefix)] != prefix {
		return false
	}
	return isULID(s[len(prefix):])
}

func isMentionKind(v any) bool {
	s, ok := v.(string)
	if !ok {
		return false
	}
	for _, k := range MentionKinds {
		if s == k {
			return true
		}
	}
	return false
}

// isSafeHref allows https:// URLs, mailto: addresses and root-absolute
// internal paths (C-01 §3.7). Everything else - javascript:, data:,
// protocol-relative //, bare http: - is rejected. So is any byte the browser
// rewrites before navigation: backslash (WHATWG URL parsing turns `/\x` into
// `//x`, smuggling an external host past the root-absolute rule), ASCII
// control characters, and Unicode whitespace.
func isSafeHref(v any) bool {
	s, ok := v.(string)
	if !ok || s == "" || len([]rune(s)) > 2048 || hasUnsafeHrefChar(s) {
		return false
	}
	switch {
	case hasPrefix(s, "https://"):
		return len(s) > len("https://")
	case hasPrefix(s, "mailto:"):
		return len(s) > len("mailto:")
	case hasPrefix(s, "/"):
		return !hasPrefix(s, "//")
	default:
		return false
	}
}

func hasPrefix(s, p string) bool {
	return len(s) >= len(p) && s[:len(p)] == p
}

// hasUnsafeHrefChar reports whether s carries a character a browser would
// strip or reinterpret inside a URL: backslash, C0/C1 control characters
// (including DEL and NEL U+0085), the BOM/ZWNBSP U+FEFF and any Unicode
// whitespace. The set is identical to the TypeScript mirror — Go's
// unicode.IsSpace covers NEL but not U+FEFF, JS \s covers U+FEFF but not
// NEL, so both are named explicitly (R2-1).
func hasUnsafeHrefChar(s string) bool {
	for _, c := range s {
		if c == '\\' || c < 0x20 || c == 0x7f || (c >= 0x80 && c <= 0x9f) || c == 0xfeff || unicode.IsSpace(c) {
			return true
		}
	}
	return false
}
