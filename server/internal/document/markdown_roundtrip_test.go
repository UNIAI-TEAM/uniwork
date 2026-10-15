package document

import (
	"encoding/json"
	"fmt"
	"math/rand/v2"
	"sort"
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
			var attrs map[string]any
			if g.r.IntN(2) == 0 { // what the editor writes on every cell
				attrs = map[string]any{"colspan": 1, "rowspan": 1}
			}
			cells = append(cells, genNode(typ, attrs, genNode("paragraph", nil, runs...)))
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

// oracleOf is a second judge of "the same page", written apart from
// canonicalNode, mergeText and sortedMarks: every rune of text with the marks
// it carries (so how runs split does not matter), the node types in order, and
// each node's attrs minus the defaults the editor writes. It reads the page
// after Sanitize, so only what a stored page keeps is compared.
func oracleOf(t *testing.T, raw json.RawMessage) string {
	t.Helper()
	clean, _, err := Sanitize(raw)
	if err != nil {
		t.Fatalf("oracle: %v\n%s", err, raw)
	}
	var doc map[string]any
	if err := json.Unmarshal(clean, &doc); err != nil {
		t.Fatal(err)
	}
	return oracleNode(doc, true)
}

func oracleNode(n map[string]any, root bool) string {
	typ, _ := n["type"].(string)
	marks := oracleMarks(n["marks"])
	if typ == "text" {
		text, _ := n["text"].(string)
		var b strings.Builder
		for _, r := range text {
			fmt.Fprintf(&b, "%q%s ", r, marks)
		}
		return b.String()
	}
	kids, _ := n["content"].([]any)
	if root && len(kids) == 0 {
		kids = []any{map[string]any{"type": "paragraph"}}
	}
	var attrs []string
	raw, _ := n["attrs"].(map[string]any)
	for k, v := range raw {
		isCell := typ == "tableCell" || typ == "tableHeader"
		switch {
		case v == nil, v == "", v == false,
			typ == "orderedList" && k == "start" && v == float64(1),
			isCell && (k == "colspan" || k == "rowspan") && v == float64(1):
			continue
		}
		attrs = append(attrs, fmt.Sprintf("%s=%v", k, v))
	}
	sort.Strings(attrs)
	parts := make([]string, len(kids))
	for i, c := range kids {
		child, _ := c.(map[string]any)
		parts[i] = oracleNode(child, false)
	}
	// Text is quoted runes and a node is type{...}(...), so the parts need no separator
	// and two runs of text read as one.
	return typ + "{" + strings.Join(attrs, ",") + "}" + marks + "(" + strings.Join(parts, "") + ")"
}

func oracleMarks(v any) string {
	list, _ := v.([]any)
	out := make([]string, 0, len(list))
	for _, m := range list {
		mark, _ := m.(map[string]any)
		s, _ := mark["type"].(string)
		if attrs, ok := mark["attrs"].(map[string]any); ok {
			s += ":" + fmt.Sprint(attrs["href"])
		}
		out = append(out, s)
	}
	sort.Strings(out)
	return "<" + strings.Join(out, ",") + ">"
}

// mutated is a page the writer can spell, then changed the way a stored page
// is: attrs the editor writes and Markdown can do without (cells' colspan 1,
// rowspan 1, colwidth, a list's start 1, null attrs), text runs split, empty
// runs, marks in another order. Now and then it is changed for the worse (a
// real colspan, an image width, a blank paragraph, a key Sanitize drops), so
// both lossless and lossy pages come out, and the lossless ones are many.
func (g *pageGen) mutated() json.RawMessage {
	var doc map[string]any
	if err := json.Unmarshal(g.page(), &doc); err != nil {
		panic(err)
	}
	g.mutate(doc)
	raw, _ := json.Marshal(doc)
	return raw
}

func (g *pageGen) setAttr(n map[string]any, k string, v any) {
	attrs, _ := n["attrs"].(map[string]any)
	if attrs == nil {
		attrs = map[string]any{}
		n["attrs"] = attrs
	}
	if _, ok := attrs[k]; !ok {
		attrs[k] = v
	}
}

func (g *pageGen) mutate(n map[string]any) {
	switch n["type"] {
	case "tableCell", "tableHeader":
		if g.r.IntN(2) == 0 {
			g.setAttr(n, "colspan", 1)
			g.setAttr(n, "rowspan", 1)
			g.setAttr(n, "colwidth", nil)
		}
		if g.r.IntN(40) == 0 {
			n["attrs"] = map[string]any{"colspan": 2}
		}
	case "orderedList":
		g.setAttr(n, "start", 1)
	case "codeBlock":
		g.setAttr(n, "language", nil)
	case "heading":
		g.setAttr(n, "textAlign", nil)
	case "image":
		g.setAttr(n, "title", nil)
		if g.r.IntN(30) == 0 {
			n["attrs"].(map[string]any)["width"] = 300
		}
	case "paragraph":
		if g.r.IntN(40) == 0 {
			delete(n, "content")
		}
	}
	if g.r.IntN(60) == 0 {
		n["data-x"] = 1 // a key Sanitize drops: the stored page differs from its sanitized form
	}
	if marks, ok := n["marks"].([]any); ok {
		g.r.Shuffle(len(marks), func(i, j int) { marks[i], marks[j] = marks[j], marks[i] })
	}
	kids, _ := n["content"].([]any)
	out := make([]any, 0, len(kids))
	for _, k := range kids {
		child, _ := k.(map[string]any)
		g.mutate(child)
		text, _ := child["text"].(string)
		if rs := []rune(text); child["type"] == "text" && len(rs) > 1 && g.r.IntN(4) == 0 {
			at := g.n(1, len(rs)-1)
			second := map[string]any{"type": "text", "text": string(rs[at:])}
			if marks, ok := child["marks"]; ok {
				second["marks"] = marks
			}
			child["text"] = string(rs[:at])
			out = append(out, child, second)
			continue
		}
		out = append(out, child)
		if g.r.IntN(30) == 0 {
			out = append(out, map[string]any{"type": "text", "text": ""})
		}
	}
	if len(kids) > 0 {
		n["content"] = out
	}
}

// Pages made of what the writer can spell come back as the same page: every
// symbol, token and neighbour the generator mixes is escaped or nested so the
// reader gives it back. A failure here is a writer that lost something, not a
// page that is merely lossy.
func TestPageToMarkdownRoundTripsGeneratedPages(t *testing.T) {
	g := newPageGen(1)
	pages := 600
	if raceEnabled {
		pages = 150 // the race detector slows the parse 4-16x
	}
	for i := 0; i < pages; i++ {
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
		if a, b := oracleOf(t, page), oracleOf(t, back); a != b {
			t.Fatalf("page %d: the structure oracle sees a change:\n%s\n%s\nmd %q", i, a, b, md)
		}
		if again, lossy, _ := PageToMarkdown(back); again != md || lossy {
			t.Fatalf("page %d: the page read back writes other Markdown (lossy %v):\n%q\n%q", i, lossy, md, again)
		}
	}
}

// Whatever Sanitize accepts converts without an error, lossy says exactly
// whether the independent read-back differs (or the stored page differs from
// its sanitized form), and a page that is not lossy passes a judge apart from
// canonicalPage. Half the pages are junk shapes, half are mutated pages the
// writer can spell, so many of them are lossless and the oracle really runs.
func TestPageToMarkdownOnAnyPage(t *testing.T) {
	g := newPageGen(2)
	accepted, lossless := 0, 0
	pages := 1500
	if raceEnabled {
		pages = 300
	}
	for i := 0; i < pages; i++ {
		var raw json.RawMessage
		if i%2 == 0 {
			raw, _ = json.Marshal(genNode("doc", nil, g.wild(4), g.wild(3), g.wild(2)))
		} else {
			raw = g.mutated()
		}
		clean, _, err := Sanitize(raw)
		if err != nil {
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
		same := err == nil && string(a) == string(b) && sameAsSanitized(raw, clean)
		if lossy == same {
			t.Fatalf("page %d: lossy %v but read-back same %v\npage %s\nback %s\nmd %q", i, lossy, same, b, a, md)
		}
		if lossy {
			// What the reader makes of the Markdown always writes without error.
			if _, _, err := PageToMarkdown(back); err != nil {
				t.Fatalf("page %d: the page read back does not convert: %v", i, err)
			}
			continue
		}
		lossless++
		sameText(t, "wild page", raw, back)
		if x, y := oracleOf(t, raw), oracleOf(t, back); x != y {
			t.Fatalf("page %d: lossy is false but the structure oracle sees a change:\n%s\n%s\nmd %q\nraw %s", i, x, y, md, raw)
		}
		if utf8.RuneCountInString(md) > MaxMarkdownRunes {
			t.Fatalf("page %d: Markdown past the read cap is never lossless", i)
		}
	}
	t.Logf("%d pages accepted, %d lossless", accepted, lossless)
	if accepted < pages*2/3 {
		t.Fatalf("only %d of %d generated pages were accepted: the generator no longer reaches the writer", accepted, pages)
	}
	if lossless*4 < accepted {
		t.Fatalf("only %d of %d pages are lossless: the oracle runs on too few", lossless, accepted)
	}
}
