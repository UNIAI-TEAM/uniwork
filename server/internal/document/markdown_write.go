package document

import (
	"bytes"
	"encoding/json"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

// PageToMarkdown renders a page as Markdown for an AI app. lossy is true when
// reading that Markdown back (MarkdownToPage with the page's own assets) would
// not give the same page: a table cell of several blocks, a blank paragraph, a
// span Markdown cannot spell. The caller must then never write the Markdown
// back over the page. lossy is measured, not predicted: the writer escapes and
// nests as well as it can, and the round trip below is the only judge, so a
// wrong "false" cannot come from a rule the writer forgot.
//
// The read side has no length cap: a page whose Markdown is longer than
// MaxMarkdownRunes still converts, and is lossy because MarkdownToPage refuses
// that much text.
func PageToMarkdown(content json.RawMessage) (md string, lossy bool, err error) {
	if len(content) == 0 {
		return "", false, nil
	}
	clean, _, err := Sanitize(content)
	if err != nil {
		return "", false, fmt.Errorf("document: page content: %w", err)
	}
	var doc pmNode
	if err := json.Unmarshal(clean, &doc); err != nil {
		return "", false, fmt.Errorf("document: page content: %w", err)
	}
	md = strings.Trim((&mdWriter{}).blocks(doc.Content), "\n")
	back, err := MarkdownToPage(md, AssetsOf(clean))
	// The Markdown is of the sanitized page: a stored page Sanitize would
	// change has parts the Markdown never shows, so it is lossy too.
	return md, err != nil || !samePage(back, clean) || !sameAsSanitized(content, clean), nil
}

func sameAsSanitized(content, clean []byte) bool {
	a, err1 := canonicalBytes(content)
	b, err2 := canonicalBytes(clean)
	return err1 == nil && err2 == nil && bytes.Equal(a, b)
}

type mdWriter struct{}

// Where an inline run is written decides how a line break and a pipe are
// spelled: a heading or a table cell is one line.
type inlineCtx int

const (
	ctxParagraph inlineCtx = iota
	ctxHeading
	ctxCell
)

// lineBreak is a hard break in a paragraph and, where the line cannot end,
// the <br> GFM tables use. MarkdownToPage reads <br> back as text, so a break
// in a heading or a cell makes the page lossy.
func (c inlineCtx) lineBreak() string {
	if c == ctxParagraph {
		return "\\\n"
	}
	return "<br>"
}

// listFamily tells which lists run into each other when only a blank line
// separates them: bullet and task lists (one "-" marker), and ordered lists.
func listFamily(typ string) int {
	switch typ {
	case "bulletList", "taskList":
		return 1
	case "orderedList":
		return 2
	}
	return 0
}

func intAttr(attrs map[string]any, key string, def int) int {
	if f, ok := attrs[key].(float64); ok {
		return int(f)
	}
	return def
}

func stringAttr(attrs map[string]any, key string) string {
	s, _ := attrs[key].(string)
	return s
}

func (w *mdWriter) blocks(nodes []pmNode) string {
	parts := make([]string, 0, len(nodes))
	prevFamily, prevAlt := 0, false
	for _, n := range nodes {
		// A list that follows a list of its family would merge into it, so it
		// takes the other marker ("*", ")"), which CommonMark reads as a new list.
		family := listFamily(n.Type)
		alt := family != 0 && family == prevFamily && !prevAlt
		s := w.block(n, alt)
		if s == "" {
			continue // a blank paragraph has no Markdown: the round trip marks the page lossy
		}
		parts = append(parts, s)
		prevFamily, prevAlt = family, alt
	}
	return strings.Join(parts, "\n\n")
}

func (w *mdWriter) block(n pmNode, alt bool) string {
	switch n.Type {
	case "paragraph":
		return escapeLineStarts(edgeSpace(w.inline(n.Content, ctxParagraph)))
	case "heading":
		hashes := strings.Repeat("#", min(max(intAttr(n.Attrs, "level", 1), 1), 3))
		s := edgeSpace(w.inline(n.Content, ctxHeading))
		if s == "" {
			return hashes
		}
		if strings.HasSuffix(s, "#") { // a closing run of # is not text
			s = s[:len(s)-1] + `\#`
		}
		return hashes + " " + s
	case "bulletList", "orderedList", "taskList":
		return w.list(n, alt)
	case "blockquote":
		return prefixLines(w.blocks(n.Content), "> ")
	case "codeBlock":
		var b strings.Builder
		for _, c := range n.Content {
			b.WriteString(c.Text)
		}
		code := b.String()
		fence := strings.Repeat("`", max(3, longestBackticks(code)+1))
		lang := stringAttr(n.Attrs, "language")
		if strings.ContainsAny(lang, " \t\r\n`") {
			lang = "" // an info string is one word: the page reads back without it, so lossy
		}
		return fence + lang + "\n" + code + "\n" + fence
	case "horizontalRule":
		return "---"
	case "table":
		return w.table(n)
	default: // an inline node outside a paragraph: it reads back inside one
		return escapeLineStarts(edgeSpace(w.inline([]pmNode{n}, ctxParagraph)))
	}
}

func (w *mdWriter) list(n pmNode, alt bool) string {
	bullet, delim := "-", "."
	if alt {
		bullet, delim = "*", ")"
	}
	start := intAttr(n.Attrs, "start", 1)
	lines := make([]string, 0, len(n.Content))
	for i, item := range n.Content {
		marker := bullet + " "
		if n.Type == "orderedList" {
			marker = strconv.Itoa(start+i) + delim + " "
		}
		content := w.blocks(item.Content)
		if n.Type == "taskList" {
			// The box is text of the first paragraph, not part of the marker:
			// nested blocks indent under the marker alone.
			if checked, _ := item.Attrs["checked"].(bool); checked {
				content = "[x] " + content
			} else {
				content = "[ ] " + content
			}
		}
		if content == "" {
			lines = append(lines, strings.TrimRight(marker, " "))
			continue
		}
		lines = append(lines, marker+indentRest(content, len(marker)))
	}
	return strings.Join(lines, "\n")
}

func indentRest(s string, n int) string {
	pad := strings.Repeat(" ", n)
	ls := strings.Split(s, "\n")
	for i := 1; i < len(ls); i++ {
		if ls[i] != "" {
			ls[i] = pad + ls[i]
		}
	}
	return strings.Join(ls, "\n")
}

func prefixLines(s, prefix string) string {
	ls := strings.Split(s, "\n")
	for i, l := range ls {
		if l == "" {
			ls[i] = strings.TrimRight(prefix, " ") // a blank line inside the quote keeps it open
		} else {
			ls[i] = prefix + l
		}
	}
	return strings.Join(ls, "\n")
}

// table writes GFM. A table whose first row is not a header gets an empty
// header row, which MarkdownToPage drops again. A cell holds one paragraph:
// any other cell has no spelling and the page reads back lossy.
func (w *mdWriter) table(n pmNode) string {
	if len(n.Content) == 0 {
		return ""
	}
	cols := max(len(n.Content[0].Content), 1)
	row := func(r pmNode) string {
		cells := make([]string, 0, len(r.Content))
		for _, c := range r.Content {
			parts := make([]string, 0, len(c.Content))
			for _, b := range c.Content {
				parts = append(parts, w.inline(b.Content, ctxCell))
			}
			cells = append(cells, edgeSpace(strings.Join(parts, " ")))
		}
		return "| " + strings.Join(cells, " | ") + " |"
	}
	rows := n.Content
	var head string
	if len(rows[0].Content) > 0 && rows[0].Content[0].Type == "tableHeader" {
		head, rows = row(rows[0]), rows[1:]
	} else {
		head = "|" + strings.Repeat("  |", cols)
	}
	lines := []string{head, "|" + strings.Repeat(" --- |", cols)}
	for _, r := range rows {
		lines = append(lines, row(r))
	}
	return strings.Join(lines, "\n")
}

// mdMark is one open emphasis or link. Two links to different places are two
// marks.
type mdMark struct{ kind, href string }

var markRank = map[string]int{"link": 0, "underline": 1, "bold": 2, "italic": 3, "strike": 4}

// inlineMarks is a run's marks outside code, one per kind, outermost first; code
// is written inside its own backticks.
func inlineMarks(marks []pmMark) (out []mdMark, code bool) {
	for _, m := range marks {
		k := mdMark{kind: m.Type}
		switch m.Type {
		case "code":
			code = true
			continue
		case "link":
			k.href = stringAttr(m.Attrs, "href")
		case "bold", "italic", "underline", "strike":
		default:
			continue
		}
		if !slices.ContainsFunc(out, func(e mdMark) bool { return e.kind == k.kind }) {
			out = append(out, k)
		}
	}
	slices.SortStableFunc(out, func(a, b mdMark) int { return markRank[a.kind] - markRank[b.kind] })
	return out, code
}

func openMark(m mdMark) string {
	switch m.kind {
	case "bold":
		return "**"
	case "italic":
		return "*"
	case "strike":
		return "~~"
	case "underline":
		return "<u>"
	}
	return "["
}

func closeMark(m mdMark) string {
	switch m.kind {
	case "bold":
		return "**"
	case "italic":
		return "*"
	case "strike":
		return "~~"
	case "underline":
		return "</u>"
	}
	return "](" + linkDest(m.href) + ")"
}

// inline writes a run of inline nodes. Marks nest the way a Markdown reader
// opens and closes them: a mark stays open across runs that carry it, so
// **a*b*c** is one bold with an italic inside.
//
// The loop carries this state; every piece of it answers one CommonMark
// flanking rule. A delimiter run opens only if no whitespace follows it and,
// when punctuation follows it, whitespace or punctuation precedes it; it closes
// by the mirror rule.
//
//   - active is the stack of open marks, outermost first. A run keeps the
//     prefix it still carries (keep) and closes the rest in reverse, so nesting
//     is proper and a "**" is never closed by a "*".
//   - leading and trailing are the whitespace taken off a run's edge when a
//     mark opens or closes beside it (a delimiter may not touch a space on its
//     inner side). Trailing is written after the marks that close, leading
//     before the marks that open, so the space ends up outside both.
//   - keep drops to 0 when a link or underline opens: it must be outermost,
//     because emphasis closing right after a link's ")" or a "</u>" has
//     punctuation on its inner side and cannot close before a letter.
//   - bang marks text ending in "!": before a link opener it is escaped, since
//     "![" would read as an image; everywhere else "!" is plain text.
//
// What no choice of nesting can flank (bold ending in punctuation against a
// letter, three overlapping runs side by side) is left to the round trip in
// PageToMarkdown to report as lossy.
func (w *mdWriter) inline(nodes []pmNode, ctx inlineCtx) string {
	nodes = mergeText(nodes)
	var parts []string
	bang := false // the last part is text ending in a literal "!"
	add := func(s string, text bool) {
		if s == "" {
			return
		}
		if bang && s[0] == '[' { // "!" before a link opener would read as an image
			p := parts[len(parts)-1]
			parts[len(parts)-1] = p[:len(p)-1] + `\!`
		}
		parts = append(parts, s)
		bang = text && s[len(s)-1] == '!'
	}
	var active []mdMark
	trailing := ""
	for i := 0; i <= len(nodes); i++ {
		var n pmNode
		var want []mdMark
		isText, code := false, false
		if i < len(nodes) {
			if n = nodes[i]; n.Type == "text" {
				isText = true
				want, code = inlineMarks(n.Marks)
			}
		}
		text := n.Text
		leading := trailing
		trailing = ""
		if isText && !code {
			if !containsAll(active, want) { // a mark opens here
				t := strings.TrimLeftFunc(text, unicode.IsSpace)
				leading += text[:len(text)-len(t)]
				text = t
			}
			if text != "" {
				var next []mdMark
				if i+1 < len(nodes) && nodes[i+1].Type == "text" {
					next, _ = inlineMarks(nodes[i+1].Marks)
				}
				if !containsAll(next, want) { // a mark closes here
					t := strings.TrimRightFunc(text, unicode.IsSpace)
					trailing = text[len(t):]
					text = t
				}
			}
			if text == "" {
				want = active // only whitespace was left: no mark opens or closes for it
			}
		} else if !isText {
			want = nil
		}

		keep := 0
		for keep < len(active) && slices.Contains(want, active[keep]) {
			keep++
		}
		// A link or underline that opens must be outermost: emphasis closing
		// right after a link's ")" or a "</u>" has punctuation on its inner side
		// and cannot close before a letter.
		if slices.ContainsFunc(want, func(m mdMark) bool { return isBarrier(m) && !slices.Contains(active, m) }) {
			keep = 0
		}
		for j := len(active) - 1; j >= keep; j-- {
			add(closeMark(active[j]), false)
		}
		active = active[:keep]
		add(w.text(leading, ctx), true)
		if isText && text != "" {
			for _, m := range want {
				if !slices.Contains(active, m) {
					add(openMark(m), false)
					active = append(active, m)
				}
			}
			if code {
				add(codeSpan(text, ctx == ctxCell), false)
			} else {
				add(w.text(text, ctx), true)
			}
		}
		if i < len(nodes) && !isText {
			if last := len(parts) - 1; n.Type == "hardBreak" && ctx == ctxParagraph && last >= 0 && strings.HasSuffix(parts[last], `\\`) {
				// goldmark does not count backslash pairs: a text that ends in "\\"
				// before a hard break ("\" and a newline) reads as no break, so the
				// text's own last backslash is written as a character reference.
				parts[last] = strings.TrimSuffix(parts[last], `\\`) + "&#92;"
			}
			add(w.node(n, ctx), false)
		}
	}
	return strings.Join(parts, "")
}

func isBarrier(m mdMark) bool { return m.kind == "link" || m.kind == "underline" }

func containsAll(have, want []mdMark) bool {
	for _, m := range want {
		if !slices.Contains(have, m) {
			return false
		}
	}
	return true
}

// node writes a mention, an image or a hard break. Marks on them are not
// written: Markdown has no spelling for a bold mention, so the page is lossy.
func (w *mdWriter) node(n pmNode, ctx inlineCtx) string {
	switch n.Type {
	case "hardBreak":
		return ctx.lineBreak()
	case "mention":
		kind, label := stringAttr(n.Attrs, "kind"), stringAttr(n.Attrs, "label")
		if kind == "user" {
			label = "@" + label
		}
		return "[" + w.text(label, ctx) + "](" + MentionScheme + kind + "/" + stringAttr(n.Attrs, "id") + ")"
	case "image":
		return "![" + w.text(stringAttr(n.Attrs, "alt"), ctx) + "](" + stringAttr(n.Attrs, "src") + ")"
	}
	return ""
}

// text is plain text as Markdown: escaped, a newline as the context's break.
func (w *mdWriter) text(s string, ctx inlineCtx) string {
	return strings.ReplaceAll(escapeText(s), "\n", ctx.lineBreak())
}

func isWord(r rune) bool { return unicode.IsLetter(r) || unicode.IsDigit(r) }

// escapeText escapes what would read as Markdown inside a line. What is only
// syntax at the start of a line (#, >, -, 1.) is left to escapeLineStarts, so
// "Task #1" and "50 > 30" stay as people typed them.
func escapeText(s string) string {
	var b strings.Builder
	for i, r := range s {
		prev, next := rune(0), rune(0) // 0 at either end of the run
		if i > 0 {
			prev, _ = utf8.DecodeLastRuneInString(s[:i])
		}
		if i+utf8.RuneLen(r) < len(s) {
			next, _ = utf8.DecodeRuneInString(s[i+utf8.RuneLen(r):])
		}
		switch {
		case r == '&' && entityAhead(s[i+1:]):
			b.WriteString("&amp;") // "&amp;amp;" reads back as the text "&amp;"; "\&amp;" would read as "&"
			continue
		case strings.ContainsRune("\\`*[]|~", r),
			r == '_' && !(isWord(prev) && isWord(next)),
			r == '<' && next != 0 && next != '<' && !unicode.IsSpace(next): // a tag, a comment or an autolink, <a@b.vn> included
			b.WriteByte('\\')
		}
		b.WriteRune(r)
	}
	return b.String()
}

// entityAhead reports whether s, what follows an "&", would make a character
// reference or an entity name.
func entityAhead(s string) bool {
	if strings.HasPrefix(s, "#") {
		return true
	}
	n := 0
	for n < len(s) && (s[n] >= 'a' && s[n] <= 'z' || s[n] >= 'A' && s[n] <= 'Z' || s[n] >= '0' && s[n] <= '9') {
		n++
	}
	return n > 0 && n < len(s) && s[n] == ';'
}

func linkDest(href string) string {
	var b strings.Builder
	for i := 0; i < len(href); i++ {
		switch c := href[i]; {
		case c == '(' || c == ')' || c == '<' || c == '>':
			b.WriteByte('\\')
			b.WriteByte(c)
		case c == '&' && entityAhead(href[i+1:]):
			b.WriteString("&amp;")
			continue
		default:
			b.WriteByte(c)
		}
	}
	return b.String()
}

var codeNewlines = strings.NewReplacer("\r\n", " ", "\n", " ", "\r", " ")

// longestBackticks is the length of the longest run of backticks in s. A fence
// or a span's ticks one longer cannot be closed by anything inside; growing
// them until s no longer contains them is quadratic on a block of backticks.
func longestBackticks(s string) int {
	best, run := 0, 0
	for i := 0; i < len(s); i++ {
		if s[i] == '`' {
			run++
			best = max(best, run)
		} else {
			run = 0
		}
	}
	return best
}

// codeSpan writes text as inline code. Edge spaces stay inside: a span keeps
// them (it strips one pair only when both ends are spaces, so that case and a
// backtick at an end get one more of each).
func codeSpan(s string, cell bool) string {
	s = codeNewlines.Replace(s)
	if cell {
		s = strings.ReplaceAll(s, "|", `\|`) // GFM reads \| as a pipe inside a span too
	}
	ticks := strings.Repeat("`", longestBackticks(s)+1) // a run of its own length would close the span
	pad := ""
	if strings.HasPrefix(s, "`") || strings.HasSuffix(s, "`") ||
		strings.HasPrefix(s, " ") && strings.HasSuffix(s, " ") && strings.Trim(s, " ") != "" {
		pad = " "
	}
	return ticks + pad + s + pad + ticks
}

// edgeSpace spells the spaces at the edge of each line as character
// references: a paragraph, heading or cell line loses them otherwise.
func edgeSpace(s string) string {
	ls := strings.Split(s, "\n")
	for i, l := range ls {
		t := strings.TrimLeft(l, " \t")
		lead := l[:len(l)-len(t)]
		core := strings.TrimRight(t, " \t")
		if core == "" {
			core, lead = "", l
		}
		ls[i] = spaceRefs(lead) + core + spaceRefs(t[len(core):])
	}
	return strings.Join(ls, "\n")
}

var spaceRefs = strings.NewReplacer(" ", "&#32;", "\t", "&#9;").Replace

// escapeLineStarts keeps a paragraph line from reading as a heading, quote,
// list item, rule or setext underline. Lines start after a hard break too.
func escapeLineStarts(s string) string {
	ls := strings.Split(s, "\n")
	for i, l := range ls {
		ls[i] = escapeLineStart(l)
	}
	return strings.Join(ls, "\n")
}

func escapeLineStart(l string) string {
	if l == "" {
		return l
	}
	blankAfter := func(n int) bool { return n >= len(l) || l[n] == ' ' || l[n] == '\t' }
	switch c := l[0]; {
	case c == '>':
		return `\` + l
	case c == '#':
		n := len(l) - len(strings.TrimLeft(l, "#"))
		if blankAfter(n) {
			return `\` + l
		}
	case c == '-':
		if blankAfter(1) || strings.Trim(l, "- \t") == "" {
			return `\` + l
		}
	case c == '+':
		if blankAfter(1) {
			return `\` + l
		}
	case c == '=':
		if strings.Trim(l, "=") == "" {
			return `\` + l
		}
	case c >= '0' && c <= '9':
		n := len(l) - len(strings.TrimLeft(l, "0123456789"))
		if n <= 9 && n < len(l) && (l[n] == '.' || l[n] == ')') && blankAfter(n+1) {
			return l[:n] + `\` + l[n:]
		}
	}
	return l
}
