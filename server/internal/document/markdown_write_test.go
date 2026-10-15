package document

import (
	"encoding/json"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestPageToMarkdown(t *testing.T) {
	cases := []struct{ name, page, want string }{
		{"marks", `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Gấp","marks":[{"type":"bold"}]},{"type":"text","text":" và "},{"type":"text","text":"dưới","marks":[{"type":"underline"}]}]}]}`,
			"**Gấp** và <u>dưới</u>"},
		{"heading and list", `{"type":"doc","content":[{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Việc"}]},{"type":"orderedList","attrs":{"start":3},"content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"a"}]}]}]}]}`,
			"## Việc\n\n3. a"},
		{"task list", `{"type":"doc","content":[{"type":"taskList","content":[{"type":"taskItem","attrs":{"checked":true},"content":[{"type":"paragraph","content":[{"type":"text","text":"xong"}]}]}]}]}`,
			"- [x] xong"},
		{"mention", `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"mention","attrs":{"kind":"user","id":"` + testULID + `","label":"Lan"}}]}]}`,
			"[@Lan](uniwork://user/" + testULID + ")"},
		{"code with a fence inside", "{\"type\":\"doc\",\"content\":[{\"type\":\"codeBlock\",\"content\":[{\"type\":\"text\",\"text\":\"a\\n```\\nb\"}]}]}",
			"````\na\n```\nb\n````"},
	}
	for _, c := range cases {
		md, lossy, err := PageToMarkdown(json.RawMessage(c.page))
		if err != nil || md != c.want || lossy {
			t.Errorf("%s: md %q lossy %v err %v, want %q", c.name, md, lossy, err, c.want)
		}
	}
}

// Text people typed, with Markdown's own symbols, Vietnamese and emoji, comes
// back word for word.
func TestPageToMarkdownRoundTripsTypedSymbols(t *testing.T) {
	text := "Giá *khuyến mãi* 50% [mới] | A_B #1 ~ <tag> & `x` 😀 Tiếng Việt có dấu"
	page := json.RawMessage(`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":` + strconvQuote(text) + `}]},{"type":"paragraph","content":[{"type":"text","text":"- không phải danh sách"}]},{"type":"paragraph","content":[{"type":"text","text":"1. cũng không"}]}]}`)
	md, lossy, err := PageToMarkdown(page)
	if err != nil || lossy {
		t.Fatalf("lossy %v err %v for %q", lossy, err, md)
	}
	back, err := MarkdownToPage(md, nil)
	if err != nil || !samePage(back, page) {
		t.Fatalf("round trip changed the page:\n%s", md)
	}
}

func TestPageToMarkdownRoundTripsEveryNode(t *testing.T) {
	page := json.RawMessage(`{"type":"doc","content":[
		{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":"Kế hoạch"}]},
		{"type":"paragraph","content":[{"type":"text","text":"đậm","marks":[{"type":"bold"}]},{"type":"text","text":" "},{"type":"text","text":"nghiêng","marks":[{"type":"italic"}]},{"type":"text","text":" "},{"type":"text","text":"gạch","marks":[{"type":"strike"}]},{"type":"text","text":" "},{"type":"text","text":"mã","marks":[{"type":"code"}]},{"type":"text","text":" "},{"type":"text","text":"link","marks":[{"type":"link","attrs":{"href":"https://uniwork.vn/a"}}]},{"type":"hardBreak"},{"type":"text","text":"dòng hai"}]},
		{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"a"}]},{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"b"}]}]}]}]}]},
		{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"trích"}]}]},
		{"type":"codeBlock","attrs":{"language":"sql"},"content":[{"type":"text","text":"SELECT 1;"}]},
		{"type":"horizontalRule"},
		{"type":"paragraph","content":[{"type":"image","attrs":{"src":"asset://` + testULID + `","alt":"sơ đồ"}}]},
		{"type":"table","content":[{"type":"tableRow","content":[{"type":"tableCell","content":[{"type":"paragraph","content":[{"type":"text","text":"không tiêu đề"}]}]}]}]}
	]}`)
	md, lossy, err := PageToMarkdown(page)
	if err != nil || lossy {
		t.Fatalf("lossy %v err %v:\n%s", lossy, err, md)
	}
}

// A table cell with two paragraphs has no Markdown spelling: the page is
// lossy, so it is never written back over itself.
func TestPageToMarkdownMarksALossyPage(t *testing.T) {
	page := json.RawMessage(`{"type":"doc","content":[{"type":"table","content":[{"type":"tableRow","content":[{"type":"tableHeader","content":[{"type":"paragraph","content":[{"type":"text","text":"a"}]},{"type":"paragraph","content":[{"type":"text","text":"b"}]}]}]}]}]}`)
	if _, lossy, err := PageToMarkdown(page); err != nil || !lossy {
		t.Fatalf("lossy = %v, err %v; want lossy", lossy, err)
	}
}

func strconvQuote(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

// Page builders for the tables below.
func textJSON(s string, marks ...string) string {
	m := ""
	if len(marks) > 0 {
		ms := make([]string, len(marks))
		for i, k := range marks {
			ms[i] = `{"type":"` + k + `"}`
			if strings.HasPrefix(k, "link:") {
				ms[i] = `{"type":"link","attrs":{"href":` + strconvQuote(strings.TrimPrefix(k, "link:")) + `}}`
			}
		}
		m = `,"marks":[` + strings.Join(ms, ",") + `]`
	}
	return `{"type":"text","text":` + strconvQuote(s) + m + `}`
}

func nodeJSON(typ string, kids ...string) string {
	return `{"type":"` + typ + `","content":[` + strings.Join(kids, ",") + `]}`
}

func paraJSON(kids ...string) string { return nodeJSON("paragraph", kids...) }

func pageJSON(blocks ...string) json.RawMessage {
	return json.RawMessage(`{"type":"doc","content":[` + strings.Join(blocks, ",") + `]}`)
}

// checkRoundTrip is the arbiter outside PageToMarkdown: it reads the Markdown
// back itself and compares the canonical bytes.
func checkRoundTrip(t *testing.T, page json.RawMessage) (md string, same bool) {
	t.Helper()
	md, _, err := PageToMarkdown(page)
	if err != nil {
		t.Fatalf("PageToMarkdown: %v\n%s", err, page)
	}
	back, err := MarkdownToPage(md, AssetsOf(page))
	if err != nil {
		return md, false
	}
	a, err1 := canonicalPage(back)
	b, err2 := canonicalPage(page)
	return md, err1 == nil && err2 == nil && string(a) == string(b)
}

// Only what reads as syntax is escaped, and where it does: "Task #1" and
// "50 > 30" stay as typed, "# x" at the start of a line does not.
func TestPageToMarkdownEscapesWhatReadsAsSyntax(t *testing.T) {
	cases := []struct{ text, want string }{
		{"Task #1 xong! Giá 1.5 triệu, a < b, 50 > 30, $5 (x) {y} @z", "Task #1 xong! Giá 1.5 triệu, a < b, 50 > 30, $5 (x) {y} @z"},
		{"snake_case_name", "snake_case_name"},
		{"_x_ và __y__", `\_x\_ và \_\_y\_\_`},
		{"a * b ** c", `a \* b \*\* c`},
		{"# không phải tiêu đề", `\# không phải tiêu đề`},
		{"#hashtag", "#hashtag"},
		{"###", `\###`},
		{"> không phải trích", `\> không phải trích`},
		{"- không", `\- không`},
		{"-", `\-`},
		{"---", `\---`},
		{"-- -", `\-- -`},
		{"-a", "-a"},
		{"+ không", `\+ không`},
		{"===", `\===`},
		{"1. không", `1\. không`},
		{"12) không", `12\) không`},
		{"2024. năm", `2024\. năm`},
		{"1.5 triệu", "1.5 triệu"},
		{"<b>x</b> <https://x.vn> <!-- c --> <9@8> <3 <<", `\<b>x\</b> \<https://x.vn> \<!-- c --> \<9@8> \<3 <<`},
		{"AT&T &amp; &copy; &#35;", "AT&T &amp;amp; &amp;copy; &amp;#35;"},
		{"~~x~~ ~~~ ~5tr 5~6", `\~\~x\~\~ \~\~\~ \~5tr 5\~6`},
		{"```go", "\\`\\`\\`go"},
		{"a|b", `a\|b`},
		{`C:\Users\x`, `C:\\Users\\x`},
		{"[x](https://uniwork.vn) ![y](z)", `\[x\](https://uniwork.vn) !\[y\](z)`},
		{"[link]: /url", `\[link\]: /url`},
		{"😀 Tiếng Việt có dấu", "😀 Tiếng Việt có dấu"},
	}
	for _, c := range cases {
		page := pageJSON(paraJSON(textJSON(c.text)))
		md, lossy, err := PageToMarkdown(page)
		if err != nil || lossy || md != c.want {
			t.Errorf("%q: md %q lossy %v err %v, want %q", c.text, md, lossy, err, c.want)
		}
	}
}

// A line that starts after a hard break is a line start too, and the spaces at
// the edge of a paragraph, heading or cell survive as character references.
func TestPageToMarkdownKeepsLineAndEdgeSpaces(t *testing.T) {
	cases := []struct {
		name string
		page json.RawMessage
		want string
	}{
		{"line after a break", pageJSON(paraJSON(textJSON("a"), `{"type":"hardBreak"}`, textJSON("- b"), `{"type":"hardBreak"}`, textJSON("---"))), "a\\\n\\- b\\\n\\---"},
		{"setext after a break", pageJSON(paraJSON(textJSON("a"), `{"type":"hardBreak"}`, textJSON("==="))), "a\\\n\\==="},
		{"trailing space", pageJSON(paraJSON(textJSON("Xin chào "))), "Xin chào&#32;"},
		{"leading space", pageJSON(paraJSON(textJSON("  chào"))), "&#32;&#32;chào"},
		{"space after a break", pageJSON(paraJSON(textJSON("a"), `{"type":"hardBreak"}`, textJSON(" b"))), "a\\\n&#32;b"},
		{"backslash before a break", pageJSON(paraJSON(textJSON("a\\"), `{"type":"hardBreak"}`, textJSON("b"))), "a&#92;\\\nb"},
		{"space before a break stays", pageJSON(paraJSON(textJSON("a "), `{"type":"hardBreak"}`, textJSON("b"))), "a \\\nb"},
		{"tab", pageJSON(paraJSON(textJSON("\ta"))), "&#9;a"},
		{"only spaces", pageJSON(paraJSON(textJSON("  "))), "&#32;&#32;"},
		{"heading", pageJSON(`{"type":"heading","attrs":{"level":2},"content":[` + textJSON(" Việc ") + `]}`), "## &#32;Việc&#32;"},
		{"heading ends in #", pageJSON(`{"type":"heading","attrs":{"level":1},"content":[` + textJSON("C #") + `]}`), `# C \#`},
		{"cell", pageJSON(nodeJSON("table", nodeJSON("tableRow", nodeJSON("tableCell", paraJSON(textJSON(" a "))), nodeJSON("tableCell", paraJSON(textJSON("b|c")))))), "|  |  |\n| --- | --- |\n| &#32;a&#32; | b\\|c |"},
	}
	for _, c := range cases {
		md, lossy, err := PageToMarkdown(c.page)
		if err != nil || lossy || md != c.want {
			t.Errorf("%s: md %q lossy %v err %v, want %q", c.name, md, lossy, err, c.want)
		}
	}
}

// Marks open and close the way a Markdown reader does: one that continues
// across runs stays open, and whitespace at a run's edge goes outside.
func TestPageToMarkdownNestsMarks(t *testing.T) {
	cases := []struct {
		name string
		page json.RawMessage
		want string
	}{
		{"italic inside bold", pageJSON(paraJSON(textJSON("a", "bold"), textJSON("b", "bold", "italic"), textJSON("c", "bold"))), "**a*b*c**"},
		{"bold inside italic", pageJSON(paraJSON(textJSON("a", "italic"), textJSON("b", "bold", "italic"), textJSON("c", "italic"))), "*a**b**c*"},
		{"bold then italic", pageJSON(paraJSON(textJSON("a", "bold"), textJSON("b", "italic"))), "**a***b*"},
		{"italic then bold", pageJSON(paraJSON(textJSON("a", "italic"), textJSON("b", "bold"))), "*a***b**"},
		{"all marks on one run", pageJSON(paraJSON(textJSON("x", "strike", "italic", "bold", "underline"))), "<u>***~~x~~***</u>"},
		{"space around a mark", pageJSON(paraJSON(textJSON(" "), textJSON("a", "bold"), textJSON(" b"))), "&#32;**a** b"},
		{"link with emphasis", pageJSON(paraJSON(textJSON("a", "link:https://uniwork.vn", "bold"), textJSON("b", "link:https://uniwork.vn", "italic"))), "[**a***b*](https://uniwork.vn)"},
		{"two links", pageJSON(paraJSON(textJSON("a", "link:https://uniwork.vn/1"), textJSON("b", "link:https://uniwork.vn/2"))), "[a](https://uniwork.vn/1)[b](https://uniwork.vn/2)"},
		{"link address with parens and an entity", pageJSON(paraJSON(textJSON("a", "link:https://uniwork.vn/a_(b)?x=1&y=2&copy;"))), `[a](https://uniwork.vn/a_\(b\)?x=1&y=2&amp;copy;)`},
		{"bang before a link", pageJSON(paraJSON(textJSON("Wow!"), textJSON("x", "link:https://uniwork.vn"))), `Wow\![x](https://uniwork.vn)`},
		{"bang before a mention", pageJSON(paraJSON(textJSON("Hi!"), `{"type":"mention","attrs":{"kind":"task","id":"`+testULID+`","label":"Việc"}}`)), `Hi\![Việc](uniwork://task/` + testULID + `)`},
		{"code keeps its edge spaces", pageJSON(paraJSON(textJSON(" a ", "code"), textJSON("b ", "code", "bold"))), "`  a  `**`b `**"},
		{"code with a backtick", pageJSON(paraJSON(textJSON("a`b", "code"), textJSON("`", "code", "italic"))), "``a`b``*`` ` ``*"},
		{"code of spaces", pageJSON(paraJSON(textJSON("  ", "code"))), "`  `"},
		{"emphasis closes before a link opens", pageJSON(paraJSON(textJSON("ệ", "italic"), textJSON("9", "italic", "link:https://uniwork.vn"), textJSON("1"))), "*ệ*[*9*](https://uniwork.vn)1"},
		{"underline is outermost", pageJSON(paraJSON(textJSON("ơx", "bold"), textJSON("1ắ", "bold", "italic", "underline"), textJSON("Ac", "italic"))), "**ơx**<u>***1ắ***</u>*Ac*"},
		{"marks around a break", pageJSON(paraJSON(textJSON("a", "bold"), `{"type":"hardBreak"}`, textJSON("b", "bold"))), "**a**\\\n**b**"},
		{"emphasised text with symbols", pageJSON(paraJSON(textJSON("a*b_c#1", "bold"))), `**a\*b_c#1**`},
	}
	for _, c := range cases {
		md, lossy, err := PageToMarkdown(c.page)
		if err != nil || lossy || md != c.want {
			t.Errorf("%s: md %q lossy %v err %v, want %q", c.name, md, lossy, err, c.want)
		}
	}
}

// Two lists that only a blank line separates would read as one: the second
// takes the other marker.
func TestPageToMarkdownKeepsAdjacentListsApart(t *testing.T) {
	li := func(s string) string { return nodeJSON("listItem", paraJSON(textJSON(s))) }
	ti := func(s string) string {
		return `{"type":"taskItem","attrs":{"checked":true},"content":[` + paraJSON(textJSON(s)) + `]}`
	}
	cases := []struct {
		name string
		page json.RawMessage
		want string
	}{
		{"bullet bullet bullet", pageJSON(nodeJSON("bulletList", li("a")), nodeJSON("bulletList", li("b")), nodeJSON("bulletList", li("c"))), "- a\n\n* b\n\n- c"},
		{"ordered ordered", pageJSON(nodeJSON("orderedList", li("a")), nodeJSON("orderedList", li("b"))), "1. a\n\n1) b"},
		{"bullet task", pageJSON(nodeJSON("bulletList", li("a")), nodeJSON("taskList", ti("b"))), "- a\n\n* [x] b"},
		{"separated by a paragraph", pageJSON(nodeJSON("bulletList", li("a")), paraJSON(textJSON("x")), nodeJSON("bulletList", li("b"))), "- a\n\nx\n\n- b"},
		{"bullet ordered", pageJSON(nodeJSON("bulletList", li("a")), nodeJSON("orderedList", li("b"))), "- a\n\n1. b"},
		{"blank paragraph between", pageJSON(nodeJSON("bulletList", li("a")), paraJSON(), nodeJSON("bulletList", li("b"))), "- a\n\n* b"},
	}
	for _, c := range cases {
		md, same := checkRoundTrip(t, c.page)
		_, lossy, _ := PageToMarkdown(c.page)
		if c.name == "blank paragraph between" {
			if !lossy {
				t.Errorf("%s: a blank paragraph has no Markdown, want lossy", c.name)
			}
		} else if lossy || !same {
			t.Errorf("%s: lossy %v same %v for %q", c.name, lossy, same, md)
		}
		if md != c.want {
			t.Errorf("%s: md %q, want %q", c.name, md, c.want)
		}
	}
}

// Containers nest: what a quote, list item or task item holds is prefixed or
// indented under the marker alone, never under the checkbox.
func TestPageToMarkdownNestsBlocks(t *testing.T) {
	li := func(kids ...string) string { return nodeJSON("listItem", kids...) }
	task := func(checked bool, kids ...string) string {
		return `{"type":"taskItem","attrs":{"checked":` + map[bool]string{true: "true", false: "false"}[checked] + `},"content":[` + strings.Join(kids, ",") + `]}`
	}
	code := `{"type":"codeBlock","attrs":{"language":"go"},"content":[` + textJSON("a := 1\n\n  b := 2  ") + `]}`
	table := nodeJSON("table", nodeJSON("tableRow", nodeJSON("tableHeader", paraJSON(textJSON("A"))), nodeJSON("tableHeader", paraJSON(textJSON("B")))), nodeJSON("tableRow", nodeJSON("tableCell", paraJSON(textJSON("1"))), nodeJSON("tableCell", paraJSON(textJSON("2")))))
	cases := []struct {
		name string
		page json.RawMessage
		want string
	}{
		{"nested list under a task item", pageJSON(nodeJSON("taskList", task(true, paraJSON(textJSON("a")), nodeJSON("bulletList", li(paraJSON(textJSON("b"))))))), "- [x] a\n\n  - b"},
		{"two paragraphs in an item", pageJSON(nodeJSON("bulletList", li(paraJSON(textJSON("a")), paraJSON(textJSON("b"))), li(paraJSON(textJSON("c"))))), "- a\n\n  b\n- c"},
		{"quote of list and code", pageJSON(nodeJSON("blockquote", paraJSON(textJSON("q")), nodeJSON("bulletList", li(paraJSON(textJSON("a")))), code)), "> q\n>\n> - a\n>\n> ```go\n> a := 1\n>\n>   b := 2  \n> ```"},
		{"code in an item", pageJSON(nodeJSON("orderedList", li(paraJSON(textJSON("a")), code))), "1. a\n\n   ```go\n   a := 1\n\n     b := 2  \n   ```"},
		{"table in an item", pageJSON(nodeJSON("bulletList", li(paraJSON(textJSON("t")), table))), "- t\n\n  | A | B |\n  | --- | --- |\n  | 1 | 2 |"},
		{"two quotes", pageJSON(nodeJSON("blockquote", paraJSON(textJSON("a"))), nodeJSON("blockquote", paraJSON(textJSON("b")))), "> a\n\n> b"},
		{"quote in a quote", pageJSON(nodeJSON("blockquote", nodeJSON("blockquote", paraJSON(textJSON("a"))))), "> > a"},
		{"wide ordered numbers", pageJSON(`{"type":"orderedList","attrs":{"start":9},"content":[` + li(paraJSON(textJSON("a")), nodeJSON("bulletList", li(paraJSON(textJSON("x"))))) + `,` + li(paraJSON(textJSON("b"))) + `]}`), "9. a\n\n   - x\n10. b"},
		{"empty items", pageJSON(nodeJSON("bulletList", li(paraJSON()), li(paraJSON(textJSON("b"))))), "-\n- b"},
		{"item opening with a symbol", pageJSON(nodeJSON("bulletList", li(paraJSON(textJSON("- x"))), li(paraJSON(textJSON("1. y"))))), "- \\- x\n- 1\\. y"},
	}
	for _, c := range cases {
		md, same := checkRoundTrip(t, c.page)
		_, lossy, _ := PageToMarkdown(c.page)
		if lossy || !same || md != c.want {
			t.Errorf("%s: lossy %v same %v md %q, want %q", c.name, lossy, same, md, c.want)
		}
	}
}

// Shapes Markdown cannot carry come back lossy, never as a quietly different
// page. Each case says why; the independent read-back must differ too.
func TestPageToMarkdownMarksWhatItCannotCarry(t *testing.T) {
	cell := func(kids ...string) string {
		return nodeJSON("table", nodeJSON("tableRow", nodeJSON("tableHeader", paraJSON(textJSON("h"))), nodeJSON("tableCell", kids...)))
	}
	cases := []struct {
		name, why string
		page      json.RawMessage
	}{
		{"blank paragraph", "no Markdown for an empty block", pageJSON(paraJSON(textJSON("a")), paraJSON(), paraJSON(textJSON("b")))},
		{"two paragraphs in a cell", "a cell is one paragraph", pageJSON(cell(paraJSON(textJSON("a")), paraJSON(textJSON("b"))))},
		{"list in a cell", "a cell is one paragraph", pageJSON(cell(nodeJSON("bulletList", nodeJSON("listItem", paraJSON(textJSON("a"))))))},
		{"break in a cell", "<br> reads back as text", pageJSON(cell(paraJSON(textJSON("a"), `{"type":"hardBreak"}`, textJSON("b"))))},
		{"break in a heading", "a heading is one line", pageJSON(`{"type":"heading","attrs":{"level":1},"content":[` + textJSON("a") + `,{"type":"hardBreak"},` + textJSON("b") + `]}`)},
		{"break last in a paragraph", "no break at the end of a block", pageJSON(paraJSON(textJSON("a"), `{"type":"hardBreak"}`))},
		{"bold mention", "marks on a mention", pageJSON(paraJSON(`{"type":"mention","attrs":{"kind":"user","id":"` + testULID + `"},"marks":[{"type":"bold"}]}`))},
		{"image width", "no width in Markdown", pageJSON(paraJSON(`{"type":"image","attrs":{"src":"asset://` + testULID + `","width":300}}`))},
		{"colspan", "no span in GFM", pageJSON(`{"type":"table","content":[{"type":"tableRow","content":[{"type":"tableCell","attrs":{"colspan":2},"content":[` + paraJSON(textJSON("a")) + `]}]}]}`)},
		{"header row below a body row", "a header is the first row", pageJSON(nodeJSON("table", nodeJSON("tableRow", nodeJSON("tableCell", paraJSON(textJSON("a")))), nodeJSON("tableRow", nodeJSON("tableHeader", paraJSON(textJSON("b"))))))},
		{"empty header row", "an empty header row reads as none", pageJSON(nodeJSON("table", nodeJSON("tableRow", nodeJSON("tableHeader", paraJSON()))))},
		{"code language with a space", "an info string is one word", pageJSON(`{"type":"codeBlock","attrs":{"language":"a b"},"content":[` + textJSON("x") + `]}`)},
		{"list start of ten digits", "a list number has nine digits", pageJSON(`{"type":"orderedList","attrs":{"start":1000000000},"content":[` + nodeJSON("listItem", paraJSON(textJSON("a"))) + `]}`)},
		{"list without items", "no Markdown for nothing", pageJSON(nodeJSON("bulletList"), paraJSON(textJSON("a")))},
		{"item without a paragraph", "an item always holds a block", pageJSON(nodeJSON("bulletList", nodeJSON("listItem")))},
		{"bold with a trailing space", "the space cannot stay inside the mark, so it reads back unmarked", pageJSON(paraJSON(textJSON("a ", "bold"), textJSON("b")))},
		{"bold edge against punctuation", "a delimiter cannot flank a letter and a bracket", pageJSON(paraJSON(textJSON("(a)", "bold"), textJSON("b")))},
		{"nested paragraphs", "a paragraph holds no paragraph", pageJSON(paraJSON(paraJSON(textJSON("a"))))},
		{"bare text in the doc", "text outside a block reads back in a paragraph", pageJSON(textJSON("a"))},
		{"emphasis that zig-zags", "adjacent bold, italic and bold-italic runs read as another nesting (rule of 3)", pageJSON(paraJSON(textJSON("ơ9ư", "bold"), textJSON("C1", "italic"), textJSON("ắư&", "bold", "italic")))},
		{"link x opens an item", "goldmark reads [x] at the start of an item as a checkbox", pageJSON(nodeJSON("bulletList", nodeJSON("listItem", paraJSON(textJSON("x", "link:https://uniwork.vn")))))},
		{"blank line of spaces in code in an item", "goldmark keeps no space on a blank line inside an item", pageJSON(nodeJSON("bulletList", nodeJSON("listItem", paraJSON(textJSON("a")), `{"type":"codeBlock","content":[`+textJSON("a\n \nb")+`]}`)))},
		{"strike after a tilde", "goldmark opens no ~~ after a ~, escaped or not", pageJSON(paraJSON(textJSON("a~"), textJSON("b", "strike")))},
		{"newline in a code span", "a newline in code reads back as a space", pageJSON(paraJSON(textJSON("a\nb", "code")))},
	}
	for _, c := range cases {
		md, lossy, err := PageToMarkdown(c.page)
		if err != nil || !lossy {
			t.Errorf("%s (%s): lossy %v err %v md %q, want lossy", c.name, c.why, lossy, err, md)
		}
		if _, same := checkRoundTrip(t, c.page); same {
			t.Errorf("%s (%s): the read-back equals the page, so it is not lossy", c.name, c.why)
		}
	}
}

// An empty page is empty Markdown and not lossy: a new document holds no
// blocks, and the reader gives a single empty paragraph for no text.
func TestPageToMarkdownOfAnEmptyPage(t *testing.T) {
	for _, page := range []string{``, `{"type":"doc","content":[]}`, `{"type":"doc"}`, `{"type":"doc","content":[{"type":"paragraph"}]}`} {
		md, lossy, err := PageToMarkdown(json.RawMessage(page))
		if err != nil || lossy || md != "" {
			t.Errorf("%q: md %q lossy %v err %v", page, md, lossy, err)
		}
	}
	for _, page := range []string{`{`, `[]`, `{"type":"paragraph"}`, `{"type":"doc","content":"x"}`} {
		if _, _, err := PageToMarkdown(json.RawMessage(page)); err == nil {
			t.Errorf("%q: want an error", page)
		}
	}
}

// The read side has no cap: a page past MaxMarkdownRunes still converts, whole,
// and is lossy because MarkdownToPage refuses that much text.
func TestPageToMarkdownPastTheReadCap(t *testing.T) {
	line := strings.Repeat("Đ", 1000)
	blocks := make([]string, 0, MaxMarkdownRunes/1000+2)
	for i := 0; i < MaxMarkdownRunes/1000+2; i++ {
		blocks = append(blocks, paraJSON(textJSON(line)))
	}
	md, lossy, err := PageToMarkdown(pageJSON(blocks...))
	if err != nil || !lossy {
		t.Fatalf("lossy %v err %v", lossy, err)
	}
	if n := utf8.RuneCountInString(md); n <= MaxMarkdownRunes || strings.Count(md, line) != len(blocks) {
		t.Fatalf("Markdown has %d runes and %d of %d paragraphs", n, strings.Count(md, line), len(blocks))
	}
	// Under the cap the same page is not lossy.
	if _, lossy, err := PageToMarkdown(pageJSON(blocks[:MaxMarkdownRunes/1000-2]...)); err != nil || lossy {
		t.Fatalf("under the cap: lossy %v err %v", lossy, err)
	}
}

// A page that carries images is read back with its own assets, so asset://
// ids do not make it lossy; an asset another page holds would.
func TestPageToMarkdownUsesThePagesOwnAssets(t *testing.T) {
	page := pageJSON(paraJSON(`{"type":"image","attrs":{"src":"asset://`+testULID+`","alt":"a"}}`, textJSON(" "), `{"type":"image","attrs":{"src":"asset://`+strings.ToLower(testULID2)+`"}}`))
	md, lossy, err := PageToMarkdown(page)
	if err != nil || lossy {
		t.Fatalf("lossy %v err %v for %q", lossy, err, md)
	}
	if want := "![a](asset://" + testULID + ") ![](asset://" + strings.ToLower(testULID2) + ")"; md != want {
		t.Fatalf("md %q, want %q", md, want)
	}
	// Read back without those assets the images fall away.
	back, err := MarkdownToPage(md, nil)
	if err != nil || samePage(back, page) {
		t.Fatalf("without its assets the page must differ: %v", err)
	}
}

// A page Sanitize drops pieces of is converted from what it keeps; Markdown
// of the stored page is Markdown of the sanitized page.
func TestPageToMarkdownSanitizesFirst(t *testing.T) {
	page := json.RawMessage(`{"type":"doc","content":[1,"x",{"type":"script"},{"type":"paragraph","content":[{"type":"text","text":"a","marks":[{"type":"highlight"},{"type":"bold"}]},{"type":"text"}]}]}`)
	md, lossy, err := PageToMarkdown(page)
	if err != nil || lossy || md != "**a**" {
		t.Fatalf("md %q lossy %v err %v", md, lossy, err)
	}
}
