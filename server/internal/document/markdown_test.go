package document

import (
	"bytes"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

const (
	testULID  = "01J8X4ABCDEFGHJKMNPQRSTVWX"
	testULID2 = "01J8X4ABCDEFGHJKMNPQRSTVWY"
)

func mustSame(t *testing.T, label string, got json.RawMessage, want string) {
	t.Helper()
	if !samePage(got, json.RawMessage(want)) {
		g, _ := canonicalPage(got)
		w, _ := canonicalPage(json.RawMessage(want))
		t.Errorf("%s:\n got %s\nwant %s", label, g, w)
	}
}

func TestMarkdownToPage(t *testing.T) {
	cases := []struct{ name, md, want string }{
		{"paragraph and marks", "**Gấp** và *nghiêng*, ~~gạch~~, `mã`, <u>gạch dưới</u>, [link](https://uniwork.vn)",
			`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Gấp","marks":[{"type":"bold"}]},{"type":"text","text":" và "},{"type":"text","text":"nghiêng","marks":[{"type":"italic"}]},{"type":"text","text":", "},{"type":"text","text":"gạch","marks":[{"type":"strike"}]},{"type":"text","text":", "},{"type":"text","text":"mã","marks":[{"type":"code"}]},{"type":"text","text":", "},{"type":"text","text":"gạch dưới","marks":[{"type":"underline"}]},{"type":"text","text":", "},{"type":"text","text":"link","marks":[{"type":"link","attrs":{"href":"https://uniwork.vn"}}]}]}]}`},
		{"headings clamp at 3", "# Một\n\n#### Bốn",
			`{"type":"doc","content":[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":"Một"}]},{"type":"heading","attrs":{"level":3},"content":[{"type":"text","text":"Bốn"}]}]}`},
		{"lists", "- a\n  - b\n\n3. c\n4. d",
			`{"type":"doc","content":[{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"a"}]},{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"b"}]}]}]}]}]},{"type":"orderedList","attrs":{"start":3},"content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"c"}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"d"}]}]}]}]}`},
		{"task list", "- [x] xong\n- [ ] chưa",
			`{"type":"doc","content":[{"type":"taskList","content":[{"type":"taskItem","attrs":{"checked":true},"content":[{"type":"paragraph","content":[{"type":"text","text":"xong"}]}]},{"type":"taskItem","attrs":{"checked":false},"content":[{"type":"paragraph","content":[{"type":"text","text":"chưa"}]}]}]}]}`},
		{"quote, code, rule", "> trích\n\n```go\nx := 1\n```\n\n---",
			`{"type":"doc","content":[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"trích"}]}]},{"type":"codeBlock","attrs":{"language":"go"},"content":[{"type":"text","text":"x := 1"}]},{"type":"horizontalRule"}]}`},
		{"mentions", "[@Lan](uniwork://user/" + testULID + ") xem [Báo cáo](uniwork://document/" + testULID + ")",
			`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"mention","attrs":{"kind":"user","id":"` + testULID + `","label":"Lan"}},{"type":"text","text":" xem "},{"type":"mention","attrs":{"kind":"document","id":"` + testULID + `","label":"Báo cáo"}}]}]}`},
		{"table", "| A | B |\n| --- | --- |\n| 1 | 2 |",
			`{"type":"doc","content":[{"type":"table","content":[{"type":"tableRow","content":[{"type":"tableHeader","content":[{"type":"paragraph","content":[{"type":"text","text":"A"}]}]},{"type":"tableHeader","content":[{"type":"paragraph","content":[{"type":"text","text":"B"}]}]}]},{"type":"tableRow","content":[{"type":"tableCell","content":[{"type":"paragraph","content":[{"type":"text","text":"1"}]}]},{"type":"tableCell","content":[{"type":"paragraph","content":[{"type":"text","text":"2"}]}]}]}]}]}`},
		{"escapes and hard break", `Giá \*50%\* \[mới\]\` + "\nA_B",
			`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Giá *50%* [mới]"},{"type":"hardBreak"},{"type":"text","text":"A_B"}]}]}`},
		{"html is text", "<script>alert(1)</script>",
			`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"<script>alert(1)</script>"}]}]}`},
		{"unsafe link keeps its text", "[bấm](javascript:alert(1))",
			`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"bấm"}]}]}`},
		{"empty", "", `{"type":"doc","content":[{"type":"paragraph"}]}`},
	}
	for _, c := range cases {
		got, err := MarkdownToPage(c.md, nil)
		if err != nil {
			t.Errorf("%s: %v", c.name, err)
			continue
		}
		mustSame(t, c.name, got, c.want)
	}
}

// An image survives only as an asset the page already holds; any other image
// becomes a link, so Markdown can never pull a remote picture into a page.
func TestMarkdownToPageImages(t *testing.T) {
	md := "![sơ đồ](asset://" + testULID + ") ![ngoài](https://evil.test/x.png)"
	got, err := MarkdownToPage(md, map[string]bool{testULID: true})
	if err != nil {
		t.Fatal(err)
	}
	mustSame(t, "images", got, `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"image","attrs":{"src":"asset://`+testULID+`","alt":"sơ đồ"}},{"type":"text","text":" "},{"type":"text","text":"ngoài","marks":[{"type":"link","attrs":{"href":"https://evil.test/x.png"}}]}]}]}`)
	// An asset the page does not hold is no image: its alt text stays (the
	// asset:// link is not one the schema keeps), the outside image is a link.
	got, err = MarkdownToPage(md, nil)
	if err != nil {
		t.Fatal(err)
	}
	mustSame(t, "unheld", got, `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"sơ đồ "},{"type":"text","text":"ngoài","marks":[{"type":"link","attrs":{"href":"https://evil.test/x.png"}}]}]}]}`)
}

// A held asset may be named in either case; the image keeps the page's spelling.
func TestMarkdownToPageAssetIDCase(t *testing.T) {
	got, err := MarkdownToPage("![a](asset://"+strings.ToLower(testULID)+")", map[string]bool{testULID: true})
	if err != nil {
		t.Fatal(err)
	}
	mustSame(t, "lower-case id", got, `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"image","attrs":{"src":"asset://`+testULID+`","alt":"a"}}]}]}`)
}

func TestAppendMarkdownKeepsThePage(t *testing.T) {
	page := json.RawMessage(`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Đầu"}]},{"type":"paragraph","content":[{"type":"image","attrs":{"src":"asset://` + testULID + `"}}]}]}`)
	got, err := AppendMarkdown(page, "## Rủi ro\n\n![lại](asset://"+testULID+")")
	if err != nil {
		t.Fatal(err)
	}
	mustSame(t, "append", got, `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Đầu"}]},{"type":"paragraph","content":[{"type":"image","attrs":{"src":"asset://`+testULID+`"}}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Rủi ro"}]},{"type":"paragraph","content":[{"type":"image","attrs":{"src":"asset://`+testULID+`","alt":"lại"}}]}]}`)
}

// Cases the tree walk could get wrong without the main table noticing: text a
// closing line holds, a line break in a code span, an email autolink, and an
// input nested past what JSON can hold.
func TestMarkdownToPageEdges(t *testing.T) {
	cases := []struct{ name, md, want string }{
		{"html block keeps its closing line", "<script>\nalert(1)\n</script>",
			`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"<script>\nalert(1)\n</script>"}]}]}`},
		{"html comment keeps its closing line", "<!-- x\ny -->",
			`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"<!-- x\ny -->"}]}]}`},
		{"code span line break is a space", "`a\nb`",
			`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"a b","marks":[{"type":"code"}]}]}]}`},
		{"email autolink", "<a@b.vn>",
			`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"a@b.vn","marks":[{"type":"link","attrs":{"href":"mailto:a@b.vn"}}]}]}]}`},
	}
	for _, c := range cases {
		got, err := MarkdownToPage(c.md, nil)
		if err != nil {
			t.Errorf("%s: %v", c.name, err)
			continue
		}
		mustSame(t, c.name, got, c.want)
	}

	_, err := MarkdownToPage(strings.Repeat(">", 20000)+" x", nil)
	var de *Error
	if !errors.As(err, &de) || de.Code != ErrCodeInvalid {
		t.Fatalf("a quote nested past JSON's depth must fail as %s, got %v", ErrCodeInvalid, err)
	}
}

// Foreign syntax a model writes often must not vanish or lose state.
func TestMarkdownToPageKeepsWhatItCannotMap(t *testing.T) {
	cases := []struct{ name, md, want string }{
		{"image without alt is a link to itself", "![](https://x.test/a.png)",
			`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"https://x.test/a.png","marks":[{"type":"link","attrs":{"href":"https://x.test/a.png"}}]}]}]}`},
		{"asset not held, no alt, stays as text", "![](asset://" + testULID + ")",
			`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"asset://` + testULID + `"}]}]}`},
		{"mixed task list keeps each box as text", "- [x] a\n- b\n- [ ] c",
			`{"type":"doc","content":[{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"[x] a"}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"b"}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"[ ] c"}]}]}]}]}`},
		{"linked image badge has one link", "[![build](https://img.test/b.svg)](https://ci.test)",
			`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"build","marks":[{"type":"link","attrs":{"href":"https://ci.test"}}]}]}]}`},
		{"unclosed <u> underlines to the end of the paragraph", "a <u>b *c*",
			`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"a "},{"type":"text","text":"b ","marks":[{"type":"underline"}]},{"type":"text","text":"c","marks":[{"type":"italic"},{"type":"underline"}]}]}]}`},
		{"table with an empty header row has no header", "|  |  |\n| --- | --- |\n| 1 | 2 |",
			`{"type":"doc","content":[{"type":"table","content":[{"type":"tableRow","content":[{"type":"tableCell","content":[{"type":"paragraph","content":[{"type":"text","text":"1"}]}]},{"type":"tableCell","content":[{"type":"paragraph","content":[{"type":"text","text":"2"}]}]}]}]}]}`},
	}
	for _, c := range cases {
		got, err := MarkdownToPage(c.md, nil)
		if err != nil {
			t.Errorf("%s: %v", c.name, err)
			continue
		}
		mustSame(t, c.name, got, c.want)
	}
}

func TestMarkdownToPageTableWiderThanTheSchemaFails(t *testing.T) {
	row := "|" + strings.Repeat(" a |", 21)
	_, err := MarkdownToPage(row+"\n|"+strings.Repeat(" --- |", 21)+"\n"+row, nil)
	var de *Error
	if !errors.As(err, &de) || de.Code != ErrCodeInvalid {
		t.Fatalf("a 21-column table must fail as %s, got %v", ErrCodeInvalid, err)
	}
}

func TestMarkdownToPageCapsItsInput(t *testing.T) {
	var de *Error
	for _, f := range []func(string) error{
		func(md string) error { _, err := MarkdownToPage(md, nil); return err },
		func(md string) error { _, err := AppendMarkdown(nil, md); return err },
	} {
		if err := f(strings.Repeat("a", MaxMarkdownRunes+1)); !errors.As(err, &de) || de.Code != ErrCodeTooLarge {
			t.Fatalf("over the cap must fail as %s, got %v", ErrCodeTooLarge, err)
		}
		// The cap counts runes, not bytes: this is twice as many bytes.
		if err := f(strings.Repeat("Đ", MaxMarkdownRunes)); err != nil {
			t.Fatalf("at the cap: %v", err)
		}
	}
}

// goldmark's block parse is quadratic in the markers a line opens; the input
// must fail on a scan, not after the parse. Each of these took 2-15 s before.
func TestMarkdownToPageRefusesPathologicalNestingFast(t *testing.T) {
	var indented strings.Builder
	for i := 0; i < 400; i++ {
		indented.WriteString(strings.Repeat("  ", i) + "- x\n")
	}
	cases := map[string]string{
		"- x50000":           strings.Repeat("- ", 50000) + "x",
		"- x99999":           strings.Repeat("- ", 99999) + "x",
		"1. x60000":          strings.Repeat("1. ", 60000) + "x",
		"> - x49999":         strings.Repeat("> - ", 49999) + "x",
		"> x99999":           strings.Repeat("> ", 99999) + "x",
		">x199990":           strings.Repeat(">", 199990) + " x",
		"indent 400 levels":  indented.String(),
		"after a CRLF":       "a\r\n" + strings.Repeat("> ", 50000) + "x",
		"inside a list item": "- a\n  " + strings.Repeat("> ", 50000) + "x",
	}
	for name, md := range cases {
		start := time.Now()
		_, err := MarkdownToPage(md, nil)
		var de *Error
		if !errors.As(err, &de) || de.Code != ErrCodeInvalid {
			t.Errorf("%s: want %s, got %v", name, ErrCodeInvalid, err)
		}
		if d := time.Since(start); d > time.Second {
			t.Errorf("%s: took %s", name, d)
		}
	}
}

// Nesting the schema allows still parses; the scan only refuses what
// Sanitize would.
func TestMarkdownToPageKeepsNestingWithinTheLimit(t *testing.T) {
	var indented, ordered strings.Builder
	for i := 0; i < 24; i++ {
		indented.WriteString(strings.Repeat("  ", i) + "- x\n")
		ordered.WriteString(strings.Repeat("   ", i) + "1. x\n")
	}
	cases := map[string]string{
		"24 bullet lists by indentation":  indented.String(),
		"24 ordered lists by indentation": ordered.String(),
		"24 lists on one line":            strings.Repeat("- ", 24) + "x",
		"48 quotes":                       strings.Repeat(">", 48) + " x",
		"16 quote-and-list pairs":         strings.Repeat("> - ", 16) + "x",
		"markers in code inside an item":  "- a\n\n      " + strings.Repeat("- ", 60),
		"markers in indented code":        "    " + strings.Repeat("> ", 60),
		"a long rule":                     strings.Repeat("-", 5000),
	}
	for name, md := range cases {
		if _, err := MarkdownToPage(md, nil); err != nil {
			t.Errorf("%s: %v", name, err)
		}
	}
	for name, md := range map[string]string{
		"25 bullet lists": strings.Repeat("- ", 25) + "x",
		"17 pairs":        strings.Repeat("> - ", 17) + "x",
	} {
		if _, err := MarkdownToPage(md, nil); err == nil {
			t.Errorf("%s: want a depth error", name)
		}
	}
}

func TestAppendMarkdownEdges(t *testing.T) {
	page := json.RawMessage(`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"image","attrs":{"src":"asset://` + testULID + `"}}]}]}`)
	// An asset the page does not hold stays text, even though another one is held.
	got, err := AppendMarkdown(page, "![nơi khác](asset://"+testULID2+")")
	if err != nil {
		t.Fatal(err)
	}
	mustSame(t, "unheld asset", got, `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"image","attrs":{"src":"asset://`+testULID+`"}}]},{"type":"paragraph","content":[{"type":"text","text":"nơi khác"}]}]}`)
	// Nothing to append is not an empty paragraph.
	for _, md := range []string{"", " \n\t\n"} {
		got, err := AppendMarkdown(page, md)
		if err != nil || !bytes.Equal(got, page) {
			t.Errorf("append %q: got %s, %v", md, got, err)
		}
	}
}

// The page a caller already stored is not rewritten by an append: every old
// node comes back byte for byte (mustSame canonicalises, so it cannot see this).
func TestAppendMarkdownLeavesOldNodesByteForByte(t *testing.T) {
	old, _, err := Sanitize([]byte(`{"type":"doc","content":[
		{"type":"paragraph","content":[
			{"type":"text","text":"a < b & c \u2028","marks":[{"type":"link","attrs":{"href":"https://uniwork.vn"}},{"type":"bold"}]},
			{"type":"text","text":" "},{"type":"text","text":"b"}]},
		{"type":"paragraph"},
		{"type":"orderedList","attrs":{"start":3},"content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"c"}]}]}]},
		{"type":"horizontalRule"},
		{"type":"paragraph","content":[{"type":"mention","attrs":{"kind":"user","id":"` + testULID + `","label":"Lan"}},{"type":"image","attrs":{"src":"asset://` + testULID + `","width":300}}]},
		{"type":"table","content":[{"type":"tableRow","content":[{"type":"tableCell","attrs":{"colspan":2},"content":[{"type":"paragraph"}]}]}]}]}`))
	if err != nil {
		t.Fatal(err)
	}
	got, err := AppendMarkdown(old, "# Mới\n\n![](asset://"+testULID+")")
	if err != nil {
		t.Fatal(err)
	}
	var before, after struct {
		Content []json.RawMessage `json:"content"`
	}
	if err := json.Unmarshal(old, &before); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(got, &after); err != nil {
		t.Fatal(err)
	}
	if len(after.Content) != len(before.Content)+2 {
		t.Fatalf("want %d nodes, got %d", len(before.Content)+2, len(after.Content))
	}
	for i, n := range before.Content {
		if !bytes.Equal(n, after.Content[i]) {
			t.Errorf("node %d rewritten:\n was %s\n now %s", i, n, after.Content[i])
		}
	}
}
