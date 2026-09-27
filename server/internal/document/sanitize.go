package document

import (
	"encoding/json"
	"fmt"
	"strings"
)

// Sanitize parses raw page JSON, drops every node/mark/attr outside the
// closed schema, and returns the sanitized document plus the extracted
// content_text. See SanitizeWithLimits for the rules; the defaults are the
// C-01 §3.7 contract values.
func Sanitize(raw []byte) (content json.RawMessage, text string, err error) {
	return SanitizeWithLimits(raw, DefaultLimits())
}

// SanitizeWithLimits applies the closed schema under the given bounds:
//
//   - input larger than MaxInputBytes, or a sanitized document that re-encodes
//     past MaxBytes, fails with ErrCodeTooLarge;
//   - malformed JSON, a root that is not {type:"doc"}, a non-array content,
//     and depth/node/table bounds are ErrCodeInvalid;
//   - anything else foreign is silently dropped: unknown nodes (with their
//     children), marks, attrs, leaf-node content, and values of the wrong
//     shape.
func SanitizeWithLimits(raw []byte, lim Limits) (json.RawMessage, string, error) {
	if int64(len(raw)) > lim.MaxInputBytes {
		return nil, "", errTooLarge(fmt.Sprintf("input exceeds %d bytes", lim.MaxInputBytes))
	}
	var root any
	if err := json.Unmarshal(raw, &root); err != nil {
		return nil, "", errInvalid("malformed JSON")
	}
	doc, ok := root.(map[string]any)
	if !ok {
		return nil, "", errInvalid("root is not an object")
	}
	if t, _ := doc["type"].(string); t != "doc" {
		return nil, "", errInvalid("root type is not \"doc\"")
	}
	var children []any
	switch c := doc["content"].(type) {
	case nil:
	case []any:
		children = c
	default:
		return nil, "", errInvalid("doc content is not an array")
	}

	w := &walker{lim: lim, nodes: 1} // the doc root counts
	out, err := w.children(children, 1)
	if err != nil {
		return nil, "", err
	}
	outDoc := map[string]any{"type": "doc", "content": out}
	enc, err := json.Marshal(outDoc)
	if err != nil {
		return nil, "", errInvalid("sanitized document does not encode")
	}
	if int64(len(enc)) > lim.MaxBytes {
		return nil, "", errTooLarge(fmt.Sprintf("sanitized document exceeds %d bytes", lim.MaxBytes))
	}
	return json.RawMessage(enc), textOf(outDoc), nil
}

// walker carries the bounds and the running counters through one sanitize.
type walker struct {
	lim   Limits
	nodes int
}

// children sanitizes a content array at the given depth (the doc root is 0).
func (w *walker) children(in []any, depth int) ([]any, error) {
	out := make([]any, 0, len(in))
	for _, item := range in {
		n, err := w.node(item, depth)
		if err != nil {
			return nil, err
		}
		if n != nil {
			out = append(out, n)
		}
	}
	return out, nil
}

// node sanitizes one node; nil means the node (and its children) was dropped.
func (w *walker) node(item any, depth int) (map[string]any, error) {
	obj, ok := item.(map[string]any)
	if !ok {
		return nil, nil
	}
	name, _ := obj["type"].(string)
	spec, ok := nodeSpecs[name]
	if !ok {
		return nil, nil
	}
	w.nodes++
	if w.nodes > w.lim.MaxNodes {
		return nil, errInvalid("document exceeds node limit")
	}
	if depth > w.lim.MaxDepth {
		return nil, errInvalid("document exceeds depth limit")
	}

	out := map[string]any{"type": name}
	if !w.attrs(obj, spec, out, name == "text") {
		return nil, nil // a required attr failed: drop the node
	}

	// Marks live on any node; unknown types drop.
	if marks, ok := obj["marks"].([]any); ok {
		if kept := w.marks(marks); len(kept) > 0 {
			out["marks"] = kept
		}
	}

	if spec.leaf {
		// Leaf nodes never emit content - whatever they carried is gone.
		return out, nil
	}

	if raw, ok := obj["content"]; ok {
		arr, ok := raw.([]any)
		if !ok {
			return nil, errInvalid("node content is not an array")
		}
		children, err := w.children(arr, depth+1)
		if err != nil {
			return nil, err
		}
		out["content"] = children
		if name == "table" {
			if err := w.checkTable(children); err != nil {
				return nil, err
			}
		}
	} else {
		out["content"] = []any{}
	}
	return out, nil
}

// attrs validates the node's attrs (or the text key on text nodes) through
// the allowlist. It returns false when a required attr fails or is absent -
// the node is then dropped. A failed optional attr just drops the attr.
func (w *walker) attrs(obj map[string]any, spec nodeSpec, out map[string]any, isText bool) bool {
	if isText {
		s, ok := obj["text"].(string)
		if !ok {
			return false
		}
		out["text"] = s
		return true
	}
	raw, _ := obj["attrs"].(map[string]any)
	kept := map[string]any{}
	for k, v := range raw {
		if rule, ok := spec.attrs[k]; ok && rule(v) {
			kept[k] = v
		}
	}
	for _, req := range spec.required {
		if _, ok := kept[req]; !ok {
			return false
		}
	}
	if len(kept) > 0 {
		out["attrs"] = kept
	}
	return true
}

// marks filters a marks array through the closed mark set.
func (w *walker) marks(in []any) []any {
	out := make([]any, 0, len(in))
	for _, item := range in {
		obj, ok := item.(map[string]any)
		if !ok {
			continue
		}
		name, _ := obj["type"].(string)
		spec, ok := markSpecs[name]
		if !ok {
			continue
		}
		m := map[string]any{"type": name}
		raw, _ := obj["attrs"].(map[string]any)
		kept := map[string]any{}
		for k, v := range raw {
			if rule, ok := spec.attrs[k]; ok && rule(v) {
				kept[k] = v
			}
		}
		missing := false
		for _, req := range spec.required {
			if _, ok := kept[req]; !ok {
				missing = true
				break
			}
		}
		if missing {
			continue
		}
		if len(kept) > 0 {
			m["attrs"] = kept
		}
		out = append(out, m)
	}
	return out
}

// checkTable enforces the per-table row/column bounds on an already
// sanitized table's children.
func (w *walker) checkTable(children []any) error {
	if len(children) > w.lim.MaxTableRows {
		return errInvalid("table exceeds row limit")
	}
	for _, row := range children {
		r, _ := row.(map[string]any)
		cells, _ := r["content"].([]any)
		if len(cells) > w.lim.MaxTableCols {
			return errInvalid("table exceeds column limit")
		}
	}
	return nil
}

// textOf extracts content_text from a sanitized document: text nodes give
// their text, mentions their label, images their alt, hardBreak a newline;
// inline children join directly, anything else is newline-separated.
func textOf(doc map[string]any) string {
	return fragOf(doc)
}

// fragOf renders one sanitized node's text fragment.
func fragOf(node map[string]any) string {
	name, _ := node["type"].(string)
	_, isNode := nodeSpecs[name]

	switch name {
	case "text":
		s, _ := node["text"].(string)
		return s
	case "hardBreak":
		return "\n"
	case "mention", "image":
		attrs, _ := node["attrs"].(map[string]any)
		key := "label"
		if name == "image" {
			key = "alt"
		}
		s, _ := attrs[key].(string)
		return s
	}

	if !isNode && name != "doc" {
		return ""
	}
	children, _ := node["content"].([]any)
	type frag struct {
		s      string
		inline bool
	}
	var parts []frag
	for _, c := range children {
		child, _ := c.(map[string]any)
		if child == nil {
			continue
		}
		s := fragOf(child)
		if s == "" {
			continue
		}
		cn, _ := child["type"].(string)
		parts = append(parts, frag{s: s, inline: nodeSpecs[cn].inline})
	}
	var b strings.Builder
	prevInline := true // first child never takes a separator
	for i, p := range parts {
		if i > 0 && !(p.inline && prevInline) {
			b.WriteByte('\n')
		}
		b.WriteString(p.s)
		prevInline = p.inline
	}
	return b.String()
}
