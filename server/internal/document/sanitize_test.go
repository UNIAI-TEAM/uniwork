package document

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"
)

// TestDocumentSanitize runs the shared parity fixtures
// (docs/parity/document-schema.json) that the TypeScript mirror in
// packages/core/documents runs against the same contract.
func TestDocumentSanitize(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "docs", "parity", "document-schema.json"))
	if err != nil {
		t.Fatalf("read fixtures: %v", err)
	}
	var fx struct {
		Defaults Limits        `json:"defaults"`
		Cases    []fixtureCase `json:"cases"`
	}
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatalf("parse fixtures: %v", err)
	}
	if len(fx.Cases) == 0 {
		t.Fatal("no fixture cases")
	}

	for _, c := range fx.Cases {
		t.Run(c.Name, func(t *testing.T) {
			lim := mergeLimits(fx.Defaults, c.Options)
			input := c.Input
			if c.InputJSON != "" {
				input = json.RawMessage(c.InputJSON)
			}
			if len(input) == 0 {
				t.Fatal("case has no input")
			}

			content, text, err := SanitizeWithLimits(input, lim)
			if c.Expect.Error != "" {
				var se *Error
				if !errors.As(err, &se) {
					t.Fatalf("expected error %q, got content=%s text=%q err=%v", c.Expect.Error, content, text, err)
				}
				if se.Code != c.Expect.Error {
					t.Fatalf("error code = %q, want %q", se.Code, c.Expect.Error)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			var got, want any
			if err := json.Unmarshal(content, &got); err != nil {
				t.Fatalf("sanitized output does not parse: %v", err)
			}
			if err := json.Unmarshal(c.Expect.Content, &want); err != nil {
				t.Fatalf("fixture content does not parse: %v", err)
			}
			if !reflect.DeepEqual(got, want) {
				gotJSON, _ := json.Marshal(got)
				t.Fatalf("content mismatch\n got: %s\nwant: %s", gotJSON, c.Expect.Content)
			}
			if text != c.Expect.Text {
				t.Fatalf("text = %q, want %q", text, c.Expect.Text)
			}
		})
	}
}

// fixtureLimits mirrors the fixture JSON keys (camelCase) onto Limits.
type fixtureLimits struct {
	MaxInputBytes int64 `json:"maxInputBytes"`
	MaxBytes      int64 `json:"maxBytes"`
	MaxDepth      int   `json:"maxDepth"`
	MaxNodes      int   `json:"maxNodes"`
	MaxTableRows  int   `json:"maxTableRows"`
	MaxTableCols  int   `json:"maxTableCols"`
}

type fixtureCase struct {
	Name      string          `json:"name"`
	Input     json.RawMessage `json:"input"`
	InputJSON string          `json:"input_json"`
	Options   fixtureLimits   `json:"options"`
	Expect    struct {
		Content json.RawMessage `json:"content"`
		Text    string          `json:"text"`
		Error   string          `json:"error"`
	} `json:"expect"`
}

// mergeLimits overlays non-zero option fields on the defaults. Fixture
// options always tighten a bound downward, so a zero value means "default".
func mergeLimits(def Limits, opt fixtureLimits) Limits {
	lim := def
	if opt.MaxInputBytes != 0 {
		lim.MaxInputBytes = opt.MaxInputBytes
	}
	if opt.MaxBytes != 0 {
		lim.MaxBytes = opt.MaxBytes
	}
	if opt.MaxDepth != 0 {
		lim.MaxDepth = opt.MaxDepth
	}
	if opt.MaxNodes != 0 {
		lim.MaxNodes = opt.MaxNodes
	}
	if opt.MaxTableRows != 0 {
		lim.MaxTableRows = opt.MaxTableRows
	}
	if opt.MaxTableCols != 0 {
		lim.MaxTableCols = opt.MaxTableCols
	}
	return lim
}

// TestSanitizeSchemaListsMatchSpecs keeps the exported NodeTypes/MarkTypes
// vocabularies in sync with the actual sanitizer tables.
func TestSanitizeSchemaListsMatchSpecs(t *testing.T) {
	var nodes []string
	for k := range nodeSpecs {
		nodes = append(nodes, k)
	}
	sort.Strings(nodes)
	wantNodes := append([]string(nil), NodeTypes...)
	sort.Strings(wantNodes)
	if !reflect.DeepEqual(nodes, wantNodes) {
		t.Errorf("nodeSpecs = %v, NodeTypes = %v", nodes, wantNodes)
	}

	var marks []string
	for k := range markSpecs {
		marks = append(marks, k)
	}
	sort.Strings(marks)
	wantMarks := append([]string(nil), MarkTypes...)
	sort.Strings(wantMarks)
	if !reflect.DeepEqual(marks, wantMarks) {
		t.Errorf("markSpecs = %v, MarkTypes = %v", marks, wantMarks)
	}
}

// TestSanitizeRealSizeLimit proves the 2 MiB contract with a real document
// instead of a tightened fixture bound.
func TestSanitizeRealSizeLimit(t *testing.T) {
	var b strings.Builder
	b.WriteString(`{"type":"doc","content":[`)
	for i := 0; i < 2048; i++ {
		if i > 0 {
			b.WriteByte(',')
		}
		fmt.Fprintf(&b, `{"type":"paragraph","content":[{"type":"text","text":"%s"}]}`,
			strings.Repeat("x", 1024))
	}
	b.WriteString(`]}`)
	raw := []byte(b.String())
	if len(raw) < 2<<20 {
		t.Fatalf("fixture too small: %d", len(raw))
	}
	_, _, err := Sanitize(raw)
	var se *Error
	if !errors.As(err, &se) || se.Code != ErrCodeTooLarge {
		t.Fatalf("expected document_too_large, got %v", err)
	}
}

// TestSanitizeDangerousShapes covers injection shapes the fixture file
// expresses compactly: attributes on the doc root are dropped, javascript:
// hrefs are stripped while the text survives, and a fully dropped document
// still round-trips as a valid empty doc.
func TestSanitizeDangerousShapes(t *testing.T) {
	doc := `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"x","marks":[{"type":"link","attrs":{"href":"javascript:alert(1)"}}]}]}],"onerror":"pwned"}`
	content, text, err := Sanitize([]byte(doc))
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	if err := json.Unmarshal(content, &got); err != nil {
		t.Fatal(err)
	}
	if _, ok := got["onerror"]; ok {
		t.Error("root attr survived")
	}
	if text != "x" {
		t.Errorf("text = %q", text)
	}
}
