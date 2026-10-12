package ai

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	"github.com/unicomhub/uniwork/server/internal/audit"
)

// The office pack (G6-14, UNI-1369) ships as one registry entry
// office_uniwork_ai@1 with six assembled System variants. These tests pin its
// text three ways: golden files (wording), the draft's token estimator (the
// G6-D1 A2 caps) and a per-version sha256 pin (a wording change cannot ride a
// regenerated golden into @1).

func officePack(t *testing.T) Prompt {
	t.Helper()
	p, ok := LookupPrompt(PromptOfficeUniworkAI)
	if !ok {
		t.Fatalf("%s is not registered", PromptOfficeUniworkAI)
	}
	if p.ID != "office_uniwork_ai" || p.Version != 1 {
		t.Fatalf("registry entry is %s, want office_uniwork_ai@1", p.Key())
	}
	return p
}

func officeGolden(t *testing.T, name string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", "office_uniwork_ai_v1_"+name+".golden"))
	if err != nil {
		t.Fatalf("%s golden: %v", name, err)
	}
	return string(b)
}

// firstDiff names the first differing byte so a wording drift points at the
// edit instead of dumping two long texts.
func firstDiff(want, got string) string {
	n := len(want)
	if len(got) < n {
		n = len(got)
	}
	for i := 0; i < n; i++ {
		if want[i] != got[i] {
			return fmt.Sprintf("byte %d: want %q, got %q", i, clip(want[i:]), clip(got[i:]))
		}
	}
	if len(want) != len(got) {
		return fmt.Sprintf("length %d != %d", len(want), len(got))
	}
	return "identical"
}

func clip(s string) string {
	if len(s) > 40 {
		return s[:40] + "…"
	}
	return s
}

// TestOfficePackGoldens pins every section verbatim (one golden per section)
// and the assembled system text: COMMON + "\n\n" + MODULE[section] + "\n" +
// UntrustedFooter (draft §0).
func TestOfficePackGoldens(t *testing.T) {
	p := officePack(t)

	t.Run("common", func(t *testing.T) {
		common := officeGolden(t, "common")
		if common != p.System {
			t.Errorf("common section drift: %s", firstDiff(common, p.System))
		}
		if strings.HasPrefix(common, "\n") || strings.HasSuffix(common, "\n") {
			t.Error("common golden carries a leading or trailing blank line")
		}
	})

	for _, m := range officeModuleSections {
		t.Run(m.section, func(t *testing.T) {
			section := officeGolden(t, m.section)
			if section != p.Sections[m.section] {
				t.Errorf("%s section drift: %s", m.section, firstDiff(section, p.Sections[m.section]))
			}
			if strings.HasPrefix(section, "\n") || strings.HasSuffix(section, "\n") {
				t.Errorf("%s golden carries a leading or trailing blank line", m.section)
			}
			got, err := OfficeSystemPrompt(m.module)
			if err != nil {
				t.Fatalf("%s: %v", m.module, err)
			}
			want := p.System + "\n\n" + p.Sections[m.section] + "\n" + UntrustedFooter
			if got != want {
				t.Errorf("%s assembled drift: %s", m.module, firstDiff(want, got))
			}
		})
	}

	// Every section is reachable from a module key and no section is orphaned.
	if len(p.Sections) != len(officeModuleSections) {
		t.Errorf("Sections has %d entries, %d module keys", len(p.Sections), len(officeModuleSections))
	}
}

// TestOfficeSystemPromptUnknownModule: the module key is the contract; an
// unroutable name is an error, never a silently defaulted section.
func TestOfficeSystemPromptUnknownModule(t *testing.T) {
	for _, module := range []string{"", "sheets", "doc", "XLSX", "csv", "unknown"} {
		if got, err := OfficeSystemPrompt(module); err == nil {
			t.Errorf("%q accepted; returned %d bytes", module, len(got))
		}
	}
	seen := map[string]bool{}
	for _, m := range officeModuleSections {
		text, err := OfficeSystemPrompt(m.module)
		if err != nil {
			t.Fatalf("%s: %v", m.module, err)
		}
		if seen[text] {
			t.Errorf("%s assembles a text another module already produced", m.module)
		}
		seen[text] = true
	}
}

// officePieceRE is the estimator's token model: one word, one number or one
// punctuation mark counts as one piece. The text deliberately avoids
// snake_case parameter and op names, so every snake_case token in the pack is
// a tool name for the tool-name check (G6-14 script worker).
var officePieceRE = regexp.MustCompile(`\p{L}+|\p{N}+|[^\s\p{L}\p{N}]`)

// officeEstimate ports the draft's estimator (g6-14-count-tokens.mjs):
// est = max(ceil(chars/3.5), pieces) over Unicode code points.
func officeEstimate(s string) int {
	chars := utf8.RuneCountInString(s)
	c35 := (2*chars + 6) / 7 // ceil(chars / 3.5)
	pieces := len(officePieceRE.FindAllStringIndex(s, -1))
	if pieces > c35 {
		return pieces
	}
	return c35
}

// TestOfficePackTokenCaps holds the G6-D1 A2 caps: common + footer <= 800,
// each module <= 1200, every assembled variant <= 2000 — with the draft's
// estimator, pinned on purpose: the provider tokenizer of the target models
// is not vendored in the repo, and the estimator over-counts English BPE
// (chars/3.5 is ~15% above ~4 chars/token). The numbers must equal the draft
// §3 table; wording changes move them and fail here too.
func TestOfficePackTokenCaps(t *testing.T) {
	p := officePack(t)
	wantEst := map[string]int{
		"common": 721, "sheets": 977, "docs": 552, "slides": 236, "pdf": 252, "markdown": 214, "html": 164,
	}
	commonVariant := p.System + "\n" + UntrustedFooter
	if got := officeEstimate(commonVariant); got != wantEst["common"] || got > 800 {
		t.Errorf("common+footer estimate %d (draft %d), cap 800", got, wantEst["common"])
	}
	for _, m := range officeModuleSections {
		if got := officeEstimate(p.Sections[m.section]); got != wantEst[m.section] || got > 1200 {
			t.Errorf("%s estimate %d (draft %d), cap 1200", m.section, got, wantEst[m.section])
		}
	}
	// The A2 cap is on the assembled turn: common + the largest module + the
	// join separators. Each variant is counted whole, so the separators are
	// measured, not assumed.
	worst := 0
	for _, m := range officeModuleSections {
		text, err := OfficeSystemPrompt(m.module)
		if err != nil {
			t.Fatalf("%s: %v", m.module, err)
		}
		if got := officeEstimate(text); got > 2000 {
			t.Errorf("%s assembled estimate %d, cap 2000", m.module, got)
		} else if got > worst {
			worst = got
		}
	}
	if worst != 1698 {
		t.Errorf("worst assembled estimate %d, draft §3 says 1698", worst)
	}
}

// officePackPins pins the released text of every office pack version: one
// sha256 over the common variant and all assembled module variants.
// Regenerating the goldens does not re-pin a version — to change wording,
// bump office_uniwork_ai to @2 and add its pin, so a usage row's prompt_id
// keeps explaining the text that was actually sent.
var officePackPins = map[string]string{
	"office_uniwork_ai@1": "40aa47c1b45ce3776a780f40b46dbef94e9f362aa0b64066727395c2cd465187",
}

// officePackDigest is sha256 over the released text of one pack version in
// officeModuleSections order — the common variant and every assembled module
// variant — each text length-prefixed so no two texts can collide by
// concatenation. It hashes the Prompt's own fields (not OfficeSystemPrompt),
// so a mutation check can prove the digest moves with the text.
func officePackDigest(t *testing.T, p Prompt) string {
	t.Helper()
	h := sha256.New()
	add := func(text string) { fmt.Fprintf(h, "%d\x00%s\x00", len(text), text) }
	add(p.System + "\n" + UntrustedFooter)
	for _, m := range officeModuleSections {
		add(p.System + "\n\n" + p.Sections[m.section] + "\n" + UntrustedFooter)
	}
	return hex.EncodeToString(h.Sum(nil))
}

func TestOfficePackVersionPins(t *testing.T) {
	registered := 0
	for _, k := range PromptKeys() {
		if !strings.HasPrefix(k, "office_uniwork_ai@") {
			continue
		}
		registered++
		p, _ := LookupPrompt(k)
		got := officePackDigest(t, p)
		if *update {
			t.Logf("officePackPins[%q] = %q", k, got)
		}
		want, ok := officePackPins[k]
		if !ok {
			t.Fatalf("%s has no pin in officePackPins; add one", k)
		}
		if !*update && got != want {
			t.Fatalf("%s text changed (digest %s, pinned %s): bump office_uniwork_ai to @2 and add its pin", k, got, want)
		}
	}
	if registered == 0 {
		t.Fatal("no office_uniwork_ai version is registered")
	}
	for k := range officePackPins {
		if _, ok := LookupPrompt(k); !ok {
			t.Errorf("pin for %s, which is not registered", k)
		}
	}

	// The pin really is the failing path for a text edit at @1, even with a
	// regenerated golden: one byte moved in any variant moves the digest.
	p := officePack(t)
	base := officePackDigest(t, p)
	mutated := p
	mutated.System = p.System + " "
	if officePackDigest(t, mutated) == base {
		t.Fatal("digest ignores a change in the common section")
	}
	mutated = p
	mutated.Sections = map[string]string{}
	for k, v := range p.Sections {
		mutated.Sections[k] = v
	}
	mutated.Sections["html"] = p.Sections["html"] + " "
	if officePackDigest(t, mutated) == base {
		t.Fatal("digest ignores a change in a module section")
	}
}

// officeProvisionalEntry is one row of the provisional trace: a Product
// question (draft §6) and the pack text (or code symbol) that answers it.
type officeProvisionalEntry struct {
	Question string `json:"question"`
	Section  string `json:"section"`
	Text     string `json:"text"`
}

var officeQuestionRE = regexp.MustCompile(`^Q[1-9]$`)

// TestOfficePackProvisionalMap holds the trace from the 9 open Product
// questions (draft §6) to the provisional text: every entry is checked
// against its section, so when Product answers, the diff is this map plus the
// text it points at — not a hunt through the pack. Q1 is code (the registry
// shape) and Q9 is the whole pack (English); both are checked structurally.
func TestOfficePackProvisionalMap(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("testdata", "office_uniwork_ai_v1_provisional.json"))
	if err != nil {
		t.Fatal(err)
	}
	var entries []officeProvisionalEntry
	if err := json.Unmarshal(raw, &entries); err != nil {
		t.Fatal(err)
	}
	p := officePack(t)

	// Q1 (registry shape, option (a)): sections on the prompt plus an
	// assemble function. Both symbols must exist for the entry to hold.
	codeChecks := map[string]func() bool{
		"Prompt.Sections": func() bool {
			_, ok := reflect.TypeOf(Prompt{}).FieldByName("Sections")
			return ok
		},
		"OfficeSystemPrompt": func() bool {
			_, err := OfficeSystemPrompt("xlsx")
			return err == nil
		},
	}

	sections := map[string]string{"common": p.System}
	for _, m := range officeModuleSections {
		sections[m.section] = p.Sections[m.section]
	}

	seen := map[string]int{}
	for _, e := range entries {
		if !officeQuestionRE.MatchString(e.Question) {
			t.Errorf("entry question %q is not Q1..Q9", e.Question)
		}
		seen[e.Question]++
		if strings.TrimSpace(e.Text) == "" {
			t.Errorf("%s: empty text", e.Question)
		}
		switch {
		case strings.HasPrefix(e.Text, "code:"):
			if e.Section != "code" {
				t.Errorf("%s: code entry in section %q", e.Question, e.Section)
			}
			sym := strings.TrimPrefix(e.Text, "code:")
			check, ok := codeChecks[sym]
			if !ok {
				t.Errorf("%s: code:%s is not one of the registry-shape symbols", e.Question, sym)
				continue
			}
			if !check() {
				t.Errorf("%s: code:%s does not exist", e.Question, sym)
			}
		case e.Section == "whole-pack":
			// Q9 (language, English): there is no single substring to point
			// at, so the entry covers the whole pack and the check is that
			// every section is English.
			if e.Text != "whole-pack" {
				t.Errorf("%s: whole-pack entry text %q", e.Question, e.Text)
			}
			for name, text := range sections {
				assertEnglish(t, e.Question, name, text)
			}
		default:
			text, ok := sections[e.Section]
			if !ok {
				t.Errorf("%s: unknown section %q", e.Question, e.Section)
				continue
			}
			if !strings.Contains(text, e.Text) {
				t.Errorf("%s: %q is not in the %s section", e.Question, e.Text, e.Section)
			}
		}
	}
	for q := 1; q <= 9; q++ {
		id := fmt.Sprintf("Q%d", q)
		if seen[id] == 0 {
			t.Errorf("%s of draft §6 has no provisional entry", id)
		}
	}
}

// assertEnglish is the Q9 check: the pack ships in English. The only
// non-ASCII text it may carry is the ellipsis of the tool-output marker and
// the two Vietnamese examples the sheets section quotes on purpose.
func assertEnglish(t *testing.T, question, section, text string) {
	t.Helper()
	prose := strings.NewReplacer("…", "", "Doanh thu", "", "Tổng công ty", "").Replace(text)
	for i, r := range prose {
		if r > 127 {
			t.Errorf("%s: %s is not English: non-ASCII %q at byte %d", question, section, r, i)
			return
		}
	}
}

// TestGatewayOfficeUniworkUsageRow pins G6-A10's trace: a UniWork AI turn
// through the Gateway leaves prompt_id office_uniwork_ai@1 on its usage row.
// Like every gateway test it needs a reachable test database (TEST_DATABASE_URL
// or the default on localhost): it SKIPs locally and the cloud round runs it.
//
// G6-03a will pass the turn's module so the Gateway sends the assembled
// System text; until that wiring lands, Prompt.System is the common section
// and the smallest test-visible path is a tool-result turn (no rendered user
// message, so no façade-side template). The row's prompt_id — what this test
// pins — is written from Request.PromptID either way.
func TestGatewayOfficeUniworkUsageRow(t *testing.T) {
	ctx := context.Background()
	fp := &provider.Fake{Reply: func(provider.CompletionRequest) provider.CompletionResponse {
		return provider.CompletionResponse{Text: "3 rows in column A.", Model: "fake", InputTokens: 40, OutputTokens: 8}
	}}
	g, q := gatewayFixture(t, fp, &fakeQuota{})
	resp, err := g.Complete(ctx, Request{
		Actor: audit.User("u1"), OrganizationID: "org1", WorkspaceID: "ws1",
		Capability: CapOfficeUniworkAI, PromptID: PromptOfficeUniworkAI,
		ToolResultTurn: true,
		History: []provider.Message{
			{Role: "user", Content: "how many rows does column A have?"},
			{Role: "assistant", ToolCalls: []provider.ToolCall{{ID: "call_1", Name: "read_range", Input: json.RawMessage(`{"range":"A:A"}`)}}},
			{Role: "tool", ToolCallID: "call_1", Content: `{"rows":3}`},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	row, err := q.AiGetUsageEvent(ctx, resp.UsageEventID)
	if err != nil {
		t.Fatal(err)
	}
	if row.PromptID != PromptOfficeUniworkAI {
		t.Fatalf("usage row prompt_id = %q, want %q", row.PromptID, PromptOfficeUniworkAI)
	}
	if row.Capability != string(CapOfficeUniworkAI) {
		t.Fatalf("usage row capability = %q, want %q", row.Capability, CapOfficeUniworkAI)
	}
	if fp.Calls != 1 {
		t.Fatalf("provider called %d times", fp.Calls)
	}
}
