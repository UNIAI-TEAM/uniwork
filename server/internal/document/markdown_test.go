package document

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

const testULID = "01J8X4ABCDEFGHJKMNPQRSTVWX"

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
	got, _ = MarkdownToPage(md, nil)
	if string(got) == "" || samePage(got, json.RawMessage(`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"image","attrs":{"src":"asset://`+testULID+`"}}]}]}`)) {
		t.Fatal("an asset the page does not hold became an image")
	}
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
