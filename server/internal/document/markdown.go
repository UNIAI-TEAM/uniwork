package document

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/extension"
	east "github.com/yuin/goldmark/extension/ast"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"
)

// Markdown is how the MCP connector shows a page to an AI app and reads one
// back (ADR 0033). It is a view, never storage: what is stored is always the
// page JSON Sanitize produces.

// MentionScheme is the link a mention takes in Markdown:
// [@Lan](uniwork://user/<id>), [Báo cáo](uniwork://document/<id>).
const MentionScheme = "uniwork://"

// MaxMarkdownRunes is the longest Markdown MarkdownToPage and AppendMarkdown
// read; longer input fails as document_too_large before any parsing. The tool
// layer states the same figure to the model: a longer page is written by
// appending in parts. goldmark's inline parse is quadratic in the worst case,
// so the figure also bounds the CPU one call can take (see
// TestMarkdownToPageStaysFastAtTheCap).
const MaxMarkdownRunes = 50_000

type pmNode struct {
	Type    string         `json:"type"`
	Attrs   map[string]any `json:"attrs,omitempty"`
	Content []pmNode       `json:"content,omitempty"`
	Text    string         `json:"text,omitempty"`
	Marks   []pmMark       `json:"marks,omitempty"`
}

type pmMark struct {
	Type  string         `json:"type"`
	Attrs map[string]any `json:"attrs,omitempty"`
}

var mdParser = goldmark.New(goldmark.WithExtensions(extension.Table, extension.Strikethrough, extension.TaskList)).Parser()

// MarkdownToPage parses Markdown into page JSON of the closed schema and
// sanitizes it. assets are the asset ids the page may show as images (those
// it already holds); any other image becomes a link.
func MarkdownToPage(md string, assets map[string]bool) (json.RawMessage, error) {
	if utf8.RuneCountInString(md) > MaxMarkdownRunes {
		return nil, errTooLarge(fmt.Sprintf("markdown exceeds %d characters", MaxMarkdownRunes))
	}
	if err := checkNesting(md, DefaultLimits().MaxDepth); err != nil {
		return nil, err
	}
	src := []byte(md)
	r := &mdReader{src: src, assets: foldAssets(assets)}
	doc := pmNode{Type: "doc", Content: r.blocks(mdParser.Parse(text.NewReader(src)))}
	if len(doc.Content) == 0 {
		doc.Content = []pmNode{{Type: "paragraph"}}
	}
	raw, err := json.Marshal(doc)
	if err != nil {
		// encoding/json refuses past 10000 levels, long before Sanitize's own
		// depth bound is reached; answer it the same way.
		return nil, errInvalid("document exceeds depth limit")
	}
	content, _, err := Sanitize(raw)
	return content, err
}

// AssetsOf lists the asset ids a page shows as images.
func AssetsOf(content json.RawMessage) map[string]bool {
	out := map[string]bool{}
	var doc pmNode
	if json.Unmarshal(content, &doc) != nil {
		return out
	}
	var walk func(n pmNode)
	walk = func(n pmNode) {
		if n.Type == "image" {
			if src, _ := n.Attrs["src"].(string); strings.HasPrefix(src, "asset://") {
				out[strings.TrimPrefix(src, "asset://")] = true
			}
		}
		for _, c := range n.Content {
			walk(c)
		}
	}
	walk(doc)
	return out
}

// AppendMarkdown adds the blocks of md after the page's own.
func AppendMarkdown(content json.RawMessage, md string) (json.RawMessage, error) {
	if strings.TrimSpace(md) == "" {
		return content, nil // nothing to add: not even an empty paragraph
	}
	doc := pmNode{Type: "doc"}
	if len(content) > 0 {
		if err := json.Unmarshal(content, &doc); err != nil {
			return nil, fmt.Errorf("document: page content: %w", err)
		}
	}
	added, err := MarkdownToPage(md, AssetsOf(content))
	if err != nil {
		return nil, err
	}
	var more pmNode
	if err := json.Unmarshal(added, &more); err != nil {
		return nil, err
	}
	doc.Type = "doc"
	doc.Content = append(doc.Content, more.Content...)
	raw, err := json.Marshal(doc)
	if err != nil {
		return nil, errInvalid("document exceeds depth limit")
	}
	clean, _, err := Sanitize(raw)
	return clean, err
}

type mdReader struct {
	src    []byte
	assets map[string]string // upper-cased asset id -> the id as the page spells it
}

// foldAssets lets Markdown name a held asset in either case (isULID accepts
// both) while the image keeps the spelling the page already stores.
func foldAssets(assets map[string]bool) map[string]string {
	out := make(map[string]string, len(assets))
	for id, held := range assets {
		if held {
			out[strings.ToUpper(id)] = id
		}
	}
	return out
}

// checkNesting refuses Markdown whose containers nest past what Sanitize
// accepts, before goldmark spends time on it: goldmark's block parse is
// quadratic in the markers a line opens (200 KB of "- " took 15 s) and
// Sanitize's depth bound only applies after the parse. A quote adds one level
// of page depth and a list item two (list + item), so a document past
// maxDepth is certain to fail Sanitize and no valid page is refused. It
// follows the containers as CommonMark does, line by line: a line continues a
// quote by its ">" and a list item by its indentation, and text indented 4+
// columns past the innermost container is code, not a marker.
// Shortcuts: a fence or thematic break holding 25+ "- " or 50+ ">" on one
// line is refused too (upgrade only if a real page does that); and an
// under-indented paragraph line (a lazy continuation) is read as ending the
// containers it really keeps open, so some over-deep input passes here and
// fails in Sanitize after the parse, which costs no more than the byte cap
// lets it (that nesting takes one line per level).
func checkNesting(md string, maxDepth int) error {
	var stack []container
	for len(md) > 0 {
		var line string
		line, md, _ = strings.Cut(md, "\n") // as goldmark: a lone "\r" is no line break
		var err error
		if stack, err = scanLine(line, stack, maxDepth); err != nil {
			return err
		}
	}
	return nil
}

// container is an open quote, or a list item whose content starts at column
// offset.
type container struct {
	list   bool
	offset int
}

func scanLine(line string, stack []container, maxDepth int) ([]container, error) {
	col, i, base := 0, 0, 0 // base: where the innermost container's content starts
	skip := func() {
		for ; i < len(line) && (line[i] == ' ' || line[i] == '\t'); i++ {
			if line[i] == '\t' {
				col += 4 - col%4
			} else {
				col++
			}
		}
	}
	quote := func() { // line[i] is ">"
		i++
		col++
		if i < len(line) && line[i] == ' ' {
			i++
			col++
		}
		base = col
	}
	kept := 0
	for ; kept < len(stack); kept++ {
		skip()
		c := stack[kept]
		if c.list {
			if col < c.offset && i < len(line) {
				break // not indented into the item: it ends here
			}
			base = c.offset
		} else if i == len(line) || line[i] != '>' || col-base >= 4 {
			break // a quote needs its ">"; a blank line ends it
		} else {
			quote()
		}
	}
	stack = stack[:kept]
	depth := 0
	for _, c := range stack {
		depth += 1 + b2i(c.list)
	}
	for {
		skip()
		if i == len(line) || col-base >= 4 {
			return stack, nil
		}
		if line[i] == '>' {
			stack = append(stack, container{})
			depth++
			quote()
		} else {
			w := listMarker(line[i:])
			if w == 0 {
				return stack, nil
			}
			start := col + w
			i += w
			col = start
			skip()
			if i == len(line) {
				return stack, nil // an empty item holds nothing the next lines nest under
			}
			offset := col
			if col-start >= 5 {
				offset = start + 1
				i = len(line) // the rest is code inside the item
			}
			stack = append(stack, container{list: true, offset: offset})
			depth += 2
			base = offset
		}
		if depth > maxDepth {
			return nil, errInvalid("document exceeds depth limit")
		}
	}
}

func b2i(b bool) int {
	if b {
		return 1
	}
	return 0
}

// listMarker is the width of the list marker s starts with ("-", "*", "+",
// "12." or "12)", then a space, tab or the end of the line), or 0.
func listMarker(s string) int {
	n := 0
	switch s[0] {
	case '-', '*', '+':
		n = 1
	default:
		for n < len(s) && n < 10 && s[n] >= '0' && s[n] <= '9' {
			n++
		}
		if n == 0 || n > 9 || n == len(s) || (s[n] != '.' && s[n] != ')') {
			return 0
		}
		n++
	}
	if n < len(s) && s[n] != ' ' && s[n] != '\t' {
		return 0
	}
	return n
}

func (r *mdReader) blocks(parent ast.Node) []pmNode {
	out := []pmNode{}
	for n := parent.FirstChild(); n != nil; n = n.NextSibling() {
		out = append(out, r.block(n)...)
	}
	return out
}

func textNodes(s string, marks []pmMark) []pmNode {
	if s == "" {
		return nil
	}
	var m []pmMark
	if len(marks) > 0 {
		m = append(m, marks...)
	}
	return []pmNode{{Type: "text", Text: s, Marks: m}}
}

// withMark adds m to marks. A mark is on or off, so one already there stays
// as it is (an outer link wins over the one around an image inside it); that
// also keeps a run at six marks however deep the emphasis nests.
func withMark(marks []pmMark, m pmMark) []pmMark {
	for _, e := range marks {
		if e.Type == m.Type {
			return marks
		}
	}
	out := make([]pmMark, 0, len(marks)+1)
	return append(append(out, marks...), m)
}

// lines is the raw text of a block whose lines are code or HTML.
func (r *mdReader) lines(n ast.Node) string {
	var b strings.Builder
	l := n.Lines()
	for i := 0; i < l.Len(); i++ {
		seg := l.At(i)
		b.Write(seg.Value(r.src))
	}
	return strings.TrimSuffix(b.String(), "\n")
}

func (r *mdReader) block(n ast.Node) []pmNode {
	switch v := n.(type) {
	case *ast.Paragraph, *ast.TextBlock:
		return []pmNode{{Type: "paragraph", Content: r.inlines(n, nil)}}
	case *ast.Heading:
		level := min(v.Level, 3)
		return []pmNode{{Type: "heading", Attrs: map[string]any{"level": level}, Content: r.inlines(n, nil)}}
	case *ast.List:
		return []pmNode{r.list(v)}
	case *ast.Blockquote:
		return []pmNode{{Type: "blockquote", Content: r.blocks(n)}}
	case *ast.FencedCodeBlock:
		node := pmNode{Type: "codeBlock", Content: textNodes(r.lines(n), nil)}
		if lang := string(v.Language(r.src)); lang != "" {
			node.Attrs = map[string]any{"language": lang}
		}
		return []pmNode{node}
	case *ast.CodeBlock:
		return []pmNode{{Type: "codeBlock", Content: textNodes(r.lines(n), nil)}}
	case *ast.ThematicBreak:
		return []pmNode{{Type: "horizontalRule"}}
	case *east.Table:
		return []pmNode{r.table(v)}
	case *ast.HTMLBlock:
		// Raw HTML is not part of the schema: it stays, as the text it is.
		// goldmark keeps the line that closes a block (</script>, -->) apart
		// from the others.
		html := r.lines(n)
		if v.HasClosure() {
			html += "\n" + strings.TrimSuffix(string(v.ClosureLine.Value(r.src)), "\n")
		}
		return []pmNode{{Type: "paragraph", Content: textNodes(html, nil)}}
	default:
		return r.blocks(n)
	}
}

func checkBox(item ast.Node) *east.TaskCheckBox {
	first := item.FirstChild()
	if first == nil {
		return nil
	}
	cb, _ := first.FirstChild().(*east.TaskCheckBox)
	return cb
}

func (r *mdReader) list(v *ast.List) pmNode {
	task := v.FirstChild() != nil
	for item := v.FirstChild(); item != nil; item = item.NextSibling() {
		task = task && checkBox(item) != nil
	}
	node := pmNode{Type: "bulletList"}
	switch {
	case task:
		node.Type = "taskList"
	case v.IsOrdered():
		node.Type = "orderedList"
		if v.Start != 1 {
			node.Attrs = map[string]any{"start": v.Start}
		}
	}
	for item := v.FirstChild(); item != nil; item = item.NextSibling() {
		li := pmNode{Type: "listItem"}
		if task {
			// The box becomes the checked attr. In a list that mixes task and
			// plain items it stays where it is and is read as text ("[x] "),
			// so no state is lost.
			cb := checkBox(item)
			li.Type = "taskItem"
			li.Attrs = map[string]any{"checked": cb.IsChecked}
			cb.Parent().RemoveChild(cb.Parent(), cb)
		}
		li.Content = r.blocks(item)
		if len(li.Content) == 0 {
			li.Content = []pmNode{{Type: "paragraph"}}
		}
		node.Content = append(node.Content, li)
	}
	return node
}

func (r *mdReader) table(t *east.Table) pmNode {
	node := pmNode{Type: "table"}
	for row := t.FirstChild(); row != nil; row = row.NextSibling() {
		cellType := "tableCell"
		_, header := row.(*east.TableHeader)
		if header {
			cellType = "tableHeader"
		}
		tr := pmNode{Type: "tableRow"}
		empty := true
		for cell := row.FirstChild(); cell != nil; cell = cell.NextSibling() {
			inl := r.inlines(cell, nil)
			empty = empty && len(inl) == 0
			tr.Content = append(tr.Content, pmNode{Type: cellType, Content: []pmNode{{Type: "paragraph", Content: inl}}})
		}
		// PageToMarkdown writes an empty header row for a table that has none.
		if header && empty {
			continue
		}
		node.Content = append(node.Content, tr)
	}
	return node
}

func unescape(b []byte) string {
	b = util.UnescapePunctuations(b)
	b = util.ResolveNumericReferences(b)
	return string(util.ResolveEntityNames(b))
}

// plain is the text under n, for a link label or an image's alt.
func (r *mdReader) plain(n ast.Node) string {
	var b strings.Builder
	for c := n.FirstChild(); c != nil; c = c.NextSibling() {
		switch v := c.(type) {
		case *ast.Text:
			b.WriteString(unescape(v.Segment.Value(r.src)))
		case *ast.String:
			b.Write(v.Value)
		default:
			b.WriteString(r.plain(c))
		}
	}
	return b.String()
}

func (r *mdReader) rawHTML(v *ast.RawHTML) string {
	var b strings.Builder
	for i := 0; i < v.Segments.Len(); i++ {
		seg := v.Segments.At(i)
		b.Write(seg.Value(r.src))
	}
	return b.String()
}

// inlines is the inline content of parent as page nodes, text runs merged.
func (r *mdReader) inlines(parent ast.Node, marks []pmMark) []pmNode {
	out := []pmNode{}
	r.appendInlines(&out, parent, marks)
	return mergeText(out)
}

// appendInlines adds parent's inline children to out. Nested emphasis and
// links append to the same slice and the runs are merged once, by inlines:
// each level copying and merging its children's output was cubic in the
// nesting depth.
func (r *mdReader) appendInlines(out *[]pmNode, parent ast.Node, marks []pmMark) {
	under := false
	for n := parent.FirstChild(); n != nil; n = n.NextSibling() {
		if h, ok := n.(*ast.RawHTML); ok {
			// <u> is the one tag the page schema has (underline); any other
			// tag is kept as its text.
			switch tag := r.rawHTML(h); strings.ToLower(tag) {
			case "<u>":
				under = true
			case "</u>":
				under = false
			default:
				*out = append(*out, textNodes(tag, marks)...)
			}
			continue
		}
		m := marks
		if under {
			m = withMark(marks, pmMark{Type: "underline"})
		}
		r.inline(out, n, m)
	}
}

func mentionOf(dest, label string) (pmNode, bool) {
	rest, ok := strings.CutPrefix(dest, MentionScheme)
	if !ok {
		return pmNode{}, false
	}
	kind, id, ok := strings.Cut(rest, "/")
	if !ok || !isMentionKind(kind) || !isULID(id) {
		return pmNode{}, false
	}
	if kind == "user" {
		label = strings.TrimPrefix(label, "@")
	}
	attrs := map[string]any{"kind": kind, "id": id}
	if label != "" {
		attrs["label"] = label
	}
	return pmNode{Type: "mention", Attrs: attrs}, true
}

func (r *mdReader) inline(out *[]pmNode, n ast.Node, marks []pmMark) {
	add := func(nodes ...pmNode) { *out = append(*out, nodes...) }
	switch v := n.(type) {
	case *ast.Text:
		add(textNodes(unescape(v.Segment.Value(r.src)), marks)...)
		switch {
		case v.HardLineBreak():
			add(pmNode{Type: "hardBreak"})
		case v.SoftLineBreak():
			add(textNodes(" ", marks)...)
		}
	case *ast.String:
		add(textNodes(string(v.Value), marks)...)
	case *ast.CodeSpan:
		var b strings.Builder
		for c := v.FirstChild(); c != nil; c = c.NextSibling() {
			if t, ok := c.(*ast.Text); ok {
				b.Write(t.Segment.Value(r.src))
			}
		}
		add(textNodes(strings.ReplaceAll(b.String(), "\n", " "), withMark(marks, pmMark{Type: "code"}))...)
	case *ast.Emphasis:
		m := "italic"
		if v.Level == 2 {
			m = "bold"
		}
		r.appendInlines(out, v, withMark(marks, pmMark{Type: m}))
	case *east.Strikethrough:
		r.appendInlines(out, v, withMark(marks, pmMark{Type: "strike"}))
	case *ast.Link:
		dest := unescape(v.Destination)
		if strings.HasPrefix(dest, MentionScheme) {
			if mention, ok := mentionOf(dest, r.plain(v)); ok {
				add(mention)
				return
			}
		}
		r.appendInlines(out, v, withMark(marks, pmMark{Type: "link", Attrs: map[string]any{"href": dest}}))
	case *ast.AutoLink:
		href := string(v.URL(r.src))
		if v.AutoLinkType == ast.AutoLinkEmail {
			href = "mailto:" + href // goldmark's URL() leaves the scheme to its HTML renderer
		}
		add(textNodes(string(v.Label(r.src)), withMark(marks, pmMark{Type: "link", Attrs: map[string]any{"href": href}}))...)
	case *ast.Image:
		dest, alt := unescape(v.Destination), r.plain(v)
		if id, ok := strings.CutPrefix(dest, "asset://"); ok && r.assets[strings.ToUpper(id)] != "" {
			attrs := map[string]any{"src": "asset://" + r.assets[strings.ToUpper(id)]}
			if alt != "" {
				attrs["alt"] = alt
			}
			add(pmNode{Type: "image", Attrs: attrs})
			return
		}
		// Any other image is a link to it; without alt text its address is the
		// text, so an image the model wrote never leaves nothing behind. Inside
		// a link ([![badge](img)](url)) the outer link stays: withMark.
		label := alt
		if label == "" {
			label = dest
		}
		add(textNodes(label, withMark(marks, pmMark{Type: "link", Attrs: map[string]any{"href": dest}}))...)
	case *east.TaskCheckBox:
		if v.IsChecked {
			add(textNodes("[x] ", marks)...)
		} else {
			add(textNodes("[ ] ", marks)...)
		}
	default:
		r.appendInlines(out, n, marks)
	}
}

func sortedMarks(ms []pmMark) []pmMark {
	out := append([]pmMark(nil), ms...)
	sort.SliceStable(out, func(i, j int) bool { return out[i].Type < out[j].Type })
	return out
}

func sameMarks(a, b []pmMark) bool {
	ja, _ := json.Marshal(sortedMarks(a))
	jb, _ := json.Marshal(sortedMarks(b))
	return bytes.Equal(ja, jb)
}

// mergeText joins adjacent runs of text that carry the same marks and drops
// empty ones, as the editor stores them.
func mergeText(nodes []pmNode) []pmNode {
	out := make([]pmNode, 0, len(nodes))
	for _, n := range nodes {
		if n.Type == "text" && n.Text == "" {
			continue
		}
		if last := len(out) - 1; last >= 0 && n.Type == "text" && out[last].Type == "text" && sameMarks(out[last].Marks, n.Marks) {
			out[last].Text += n.Text
			continue
		}
		out = append(out, n)
	}
	return out
}

// canonicalPage is a page in one spelling: sanitized, marks sorted, text
// runs merged, attrs holding their default dropped. Two pages that read the
// same canonicalize to the same bytes.
func canonicalPage(content json.RawMessage) ([]byte, error) {
	clean, _, err := Sanitize(content)
	if err != nil {
		return nil, err
	}
	var doc pmNode
	if err := json.Unmarshal(clean, &doc); err != nil {
		return nil, err
	}
	canonicalNode(&doc)
	return json.Marshal(doc)
}

func canonicalNode(n *pmNode) {
	for k, v := range n.Attrs {
		if v == nil || v == "" || v == false || (n.Type == "orderedList" && k == "start" && v == float64(1)) {
			delete(n.Attrs, k)
		}
	}
	if len(n.Attrs) == 0 {
		n.Attrs = nil
	}
	n.Marks = sortedMarks(n.Marks)
	if len(n.Marks) == 0 {
		n.Marks = nil
	}
	for i := range n.Content {
		canonicalNode(&n.Content[i])
	}
	n.Content = mergeText(n.Content)
	if len(n.Content) == 0 {
		n.Content = nil
	}
}

func samePage(a, b json.RawMessage) bool {
	ca, err := canonicalPage(a)
	if err != nil {
		return false
	}
	cb, err := canonicalPage(b)
	return err == nil && bytes.Equal(ca, cb)
}
