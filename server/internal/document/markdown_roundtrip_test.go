package document

import (
	"encoding/json"
	"math/rand/v2"
	"strings"
	"testing"
	"unicode/utf8"
)

// Generated pages for PageToMarkdown. The seeds are fixed, so a failure is the
// same failure on every run, and the counts keep the package fast.

type pageGen struct{ r *rand.Rand }

func newPageGen(seed uint64) *pageGen {
	return &pageGen{rand.New(rand.NewPCG(seed, seed^0x9e3779b97f4a7c15))}
}

func (g *pageGen) n(lo, hi int) int { return lo + g.r.IntN(hi-lo+1) }

func (g *pageGen) pick(ss ...string) string { return ss[g.r.IntN(len(ss))] }

const (
	genLetters = "abcxyzABCXYZ0189ắệđươ"
	genSymbols = " *_#>-+=~`|[]<>&!\\.):;'\"$%@^{}/😀"
)

// Whole pieces of syntax a person may type: the ones that need escaping at the
// start of a line or next to a neighbour.
var genTokens = []string{
	"&amp;", "&#35;", "&copy;", "&", ";", "<b>", "</u>", "<u>", "<br>", "![x](y)", "[x](https://a.vn)",
	"~~", "~~~", "***", "```", "1. ", "12) ", "- ", "+ ", "# ", "## ", "> ", "---", "===", "|", " | ", "_x_", "a_b",
}

var genHrefs = []string{
	"https://uniwork.vn/a", "https://uniwork.vn/a_(b)?x=1&y=2", "mailto:a@b.vn", "/path/x", "https://x.vn/&copy;&amp;",
}

func (g *pageGen) chars(lo, hi int, alphabet string) string {
	rs := []rune(alphabet)
	var b strings.Builder
	for i, n := 0, g.n(lo, hi); i < n; i++ {
		b.WriteRune(rs[g.r.IntN(len(rs))])
	}
	return b.String()
}

// plain is text as people type it, symbols and syntax tokens included.
func (g *pageGen) plain() string {
	var b strings.Builder
	for i, n := 0, g.n(1, 4); i < n; i++ {
		if g.r.IntN(3) == 0 {
			b.WriteString(genTokens[g.r.IntN(len(genTokens))])
		} else {
			b.WriteString(g.chars(1, 4, genLetters+genSymbols))
		}
	}
	return b.String()
}

// core is text a mark can wrap: a letter at each end, anything inside.
func (g *pageGen) core() string {
	return g.chars(1, 1, genLetters) + g.chars(0, 5, genLetters+genSymbols) + g.chars(1, 1, genLetters)
}

func genText(text string, marks ...map[string]any) map[string]any {
	n := map[string]any{"type": "text", "text": text}
	if len(marks) > 0 {
		n["marks"] = marks
	}
	return n
}

func genMark(kind string) map[string]any { return map[string]any{"type": kind} }

func genLink(href string) map[string]any {
	return map[string]any{"type": "link", "attrs": map[string]any{"href": href}}
}

func genNode(typ string, attrs map[string]any, kids ...any) map[string]any {
	n := map[string]any{"type": typ}
	if attrs != nil {
		n["attrs"] = attrs
	}
	if kids != nil {
		n["content"] = kids
	}
	return n
}

// inlines is one line of a paragraph, heading or cell. A mention's label is a
// word: goldmark reads a link labelled x, X or a space at the start of a list
// item as a task checkbox. Marked text has a
// letter at each edge: Markdown cannot flank a delimiter with a bracket or a
// space (the "bold with a trailing space" and "bold edge against punctuation"
// cases in TestPageToMarkdownMarksWhatItCannotCarry are the shapes it cannot
// carry).
func (g *pageGen) inlines(maxRuns int, breaks bool) []any {
	var out []any
	n := g.n(1, maxRuns)
	emphRow := 0 // adjacent marked runs in a row
	for i := 0; i < n; i++ {
		if emphRow >= 2 {
			// Three marked runs of different marks with no space between (bold,
			// italic, bold-italic) are ambiguous to CommonMark's delimiter rules.
			out = append(out, genText(" "))
			emphRow = 0
		}
		switch k := g.r.IntN(10); {
		case k < 3:
			out = append(out, genText(g.plain()))
		case k < 6:
			var marks []map[string]any
			for _, m := range []string{"bold", "italic", "strike", "underline"} {
				if g.r.IntN(2) == 0 {
					marks = append(marks, genMark(m))
				}
			}
			if len(marks) == 0 || g.r.IntN(3) == 0 {
				marks = append(marks, genLink(genHrefs[g.r.IntN(len(genHrefs))]))
			}
			run := genText(g.core(), marks...)
			if hasStrike(marks) {
				// Delimiters of two kinds side by side (**~~) cannot open next to a
				// letter, and goldmark does not open ~~ after a ~ even an escaped one,
				// so a struck run stands between spaces.
				out = append(out, genText(" "), run, genText(" "))
				break
			}
			out = append(out, run)
			emphRow++
			continue
		case k == 6:
			out = append(out, genText(g.chars(1, 6, genLetters+genSymbols), genMark("code")))
		case k == 7:
			out = append(out, genNode("mention", map[string]any{"kind": g.pick("user", "task", "document", "meeting"), "id": g.pick(testULID, testULID2), "label": g.pick("", g.core())}))
		case k == 8:
			out = append(out, genNode("image", map[string]any{"src": "asset://" + g.pick(testULID, testULID2), "alt": g.chars(0, 6, genLetters+genSymbols)}))
		case k == 9 && breaks && i > 0 && i < n-1 && out[len(out)-1].(map[string]any)["type"] != "hardBreak":
			out = append(out, genNode("hardBreak", nil))
		default:
			out = append(out, genText(g.plain()))
		}
		emphRow = 0
	}
	return out
}

func hasStrike(marks []map[string]any) bool {
	for _, m := range marks {
		if m["type"] == "strike" {
			return true
		}
	}
	return false
}

func (g *pageGen) paragraph() any { return genNode("paragraph", nil, g.inlines(5, true)...) }

func (g *pageGen) block(depth int) any {
	k := g.r.IntN(10)
	if depth == 0 && (k == 3 || k == 4) {
		k = 0
	}
	switch k {
	case 2:
		return genNode("heading", map[string]any{"level": g.n(1, 3)}, g.inlines(4, false)...)
	case 3:
		return g.list(depth)
	case 4:
		kids := []any{g.block(depth - 1)}
		if g.r.IntN(3) == 0 {
			kids = append(kids, g.block(depth-1))
		}
		return genNode("blockquote", nil, kids...)
	case 5:
		return g.code()
	case 6:
		return genNode("horizontalRule", nil)
	case 7:
		return g.table()
	}
	return g.paragraph()
}

func (g *pageGen) code() any {
	var attrs map[string]any
	if lang := g.pick("", "go", "sql", "c#", "js"); lang != "" {
		attrs = map[string]any{"language": lang}
	}
	line := func() string {
		// goldmark keeps no space on a blank line inside a list item or a quote.
		if l := g.chars(0, 8, genLetters+genSymbols); strings.TrimSpace(l) != "" {
			return l
		}
		return ""
	}
	text := ""
	for i, n := 0, g.n(0, 4); i < n; i++ {
		text += line() + "\n"
	}
	text += line()
	if text == "" {
		return genNode("codeBlock", attrs)
	}
	return genNode("codeBlock", attrs, genText(text))
}

func (g *pageGen) list(depth int) any {
	typ := g.pick("bulletList", "orderedList", "taskList")
	var attrs map[string]any
	if typ == "orderedList" && g.r.IntN(2) == 0 {
		attrs = map[string]any{"start": g.n(1, 130)}
	}
	var items []any
	for i, n := 0, g.n(1, 3); i < n; i++ {
		kids := []any{g.paragraph()}
		for j, m := 0, g.n(0, 2); j < m; j++ {
			kids = append(kids, g.block(depth-1))
		}
		if typ == "taskList" {
			items = append(items, genNode("taskItem", map[string]any{"checked": g.r.IntN(2) == 0}, kids...))
		} else {
			items = append(items, genNode("listItem", nil, kids...))
		}
	}
	return genNode(typ, attrs, items...)
}

func (g *pageGen) table() any {
	cols := g.n(1, 4)
	var rows []any
	for i, n := 0, g.n(1, 3); i < n; i++ {
		header := i == 0 && g.r.IntN(2) == 0
		var cells []any
		for c := 0; c < cols; c++ {
			var runs []any
			if header || g.r.IntN(5) != 0 {
				runs = g.inlines(2, false)
			}
			typ := "tableCell"
			if header {
				typ = "tableHeader"
			}
			cells = append(cells, genNode(typ, nil, genNode("paragraph", nil, runs...)))
		}
		rows = append(rows, genNode("tableRow", nil, cells...))
	}
	return genNode("table", nil, rows...)
}

func (g *pageGen) page() json.RawMessage {
	var blocks []any
	for i, n := 0, g.n(1, 5); i < n; i++ {
		blocks = append(blocks, g.block(2))
	}
	raw, _ := json.Marshal(genNode("doc", nil, blocks...))
	return raw
}

// wild is any node anywhere: leaves with content, lists in paragraphs, text
// with newlines and control characters, unknown marks and out-of-range attrs.
func (g *pageGen) wild(depth int) any {
	typ := NodeTypes[g.r.IntN(len(NodeTypes))]
	n := map[string]any{"type": typ}
	if g.r.IntN(2) == 0 {
		n["attrs"] = g.pickAttrs()
	}
	if typ == "text" {
		n["text"] = g.chars(0, 6, genLetters+genSymbols+"\n\r\t\u0000  ") + g.pick("", "\n", "  ", " ")
	}
	if g.r.IntN(3) == 0 {
		var marks []any
		for i, c := 0, g.n(1, 3); i < c; i++ {
			switch m := g.pick("bold", "italic", "underline", "strike", "code", "link", "highlight"); m {
			case "link":
				marks = append(marks, genLink(genHrefs[g.r.IntN(len(genHrefs))]))
			default:
				marks = append(marks, genMark(m))
			}
		}
		n["marks"] = marks
	}
	if depth > 0 && g.r.IntN(3) != 0 {
		kids := []any{}
		for i, c := 0, g.n(0, 4); i < c; i++ {
			kids = append(kids, g.wild(depth-1))
		}
		n["content"] = kids
	}
	return n
}

func (g *pageGen) pickAttrs() map[string]any {
	switch g.r.IntN(8) {
	case 0:
		return map[string]any{"level": g.n(0, 4)}
	case 1:
		return map[string]any{"start": g.n(1, 3)}
	case 2:
		return map[string]any{"checked": g.r.IntN(2) == 0}
	case 3:
		return map[string]any{"language": g.pick("go", "a b", "c`d", "")}
	case 4:
		return map[string]any{"src": "asset://" + testULID, "alt": g.plain(), "width": 120}
	case 5:
		return map[string]any{"kind": g.pick("user", "task"), "id": testULID, "label": g.plain()}
	case 6:
		return map[string]any{"colspan": 2}
	}
	return map[string]any{"x": 1}
}

// sameText is an oracle apart from canonicalPage: the plain text a page
// searches by (Sanitize's content_text) must survive a lossless round trip.
func sameText(t *testing.T, label string, page, back json.RawMessage) {
	t.Helper()
	_, a, err1 := Sanitize(page)
	_, b, err2 := Sanitize(back)
	if err1 != nil || err2 != nil || a != b {
		t.Fatalf("%s: the text changed in a lossless round trip: %q -> %q (%v, %v)", label, a, b, err1, err2)
	}
}

// Pages made of what the writer can spell come back as the same page: every
// symbol, token and neighbour the generator mixes is escaped or nested so the
// reader gives it back. A failure here is a writer that lost something, not a
// page that is merely lossy.
func TestPageToMarkdownRoundTripsGeneratedPages(t *testing.T) {
	g := newPageGen(1)
	for i := 0; i < 600; i++ {
		page := g.page()
		md, lossy, err := PageToMarkdown(page)
		if err != nil {
			t.Fatalf("page %d: %v\n%s", i, err, page)
		}
		back, _ := MarkdownToPage(md, AssetsOf(page))
		if lossy {
			a, _ := canonicalPage(back)
			b, _ := canonicalPage(page)
			t.Fatalf("page %d is lossy:\npage %s\nback %s\nmd %q\n%s", i, b, a, md, md)
		}
		sameText(t, "generated page", page, back)
		if again, lossy, _ := PageToMarkdown(back); again != md || lossy {
			t.Fatalf("page %d: the page read back writes other Markdown (lossy %v):\n%q\n%q", i, lossy, md, again)
		}
	}
}

// Whatever Sanitize accepts converts without an error, and lossy says exactly
// whether the independent read-back differs.
func TestPageToMarkdownOnAnyPage(t *testing.T) {
	g := newPageGen(2)
	accepted, lossyPages := 0, 0
	for i := 0; i < 1500; i++ {
		raw, _ := json.Marshal(genNode("doc", nil, g.wild(4), g.wild(3), g.wild(2)))
		if _, _, err := Sanitize(raw); err != nil {
			continue
		}
		accepted++
		md, lossy, err := PageToMarkdown(raw)
		if err != nil {
			t.Fatalf("page %d: %v\n%s", i, err, raw)
		}
		if again, _, _ := PageToMarkdown(raw); again != md {
			t.Fatalf("page %d: not deterministic", i)
		}
		back, err := MarkdownToPage(md, AssetsOf(raw))
		a, _ := canonicalPage(back)
		b, _ := canonicalPage(raw)
		same := err == nil && string(a) == string(b)
		if lossy == same {
			t.Fatalf("page %d: lossy %v but read-back same %v\npage %s\nback %s\nmd %q", i, lossy, same, b, a, md)
		}
		if lossy {
			lossyPages++
			// What the reader makes of the Markdown always writes without error.
			if _, _, err := PageToMarkdown(back); err != nil {
				t.Fatalf("page %d: the page read back does not convert: %v", i, err)
			}
			continue
		}
		sameText(t, "wild page", raw, back)
		if utf8.RuneCountInString(md) > MaxMarkdownRunes {
			t.Fatalf("page %d: Markdown past the read cap is never lossless", i)
		}
	}
	t.Logf("%d pages accepted, %d lossy", accepted, lossyPages)
	if accepted < 1000 {
		t.Fatalf("only %d of 1500 generated pages were accepted: the generator no longer reaches the writer", accepted)
	}
}
