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

// The office pack (G6-14, UNI-1369; tuned in G6-08, UNI-1373) ships as
// versioned registry entries office_uniwork_ai@1 and office_uniwork_ai@2 with
// six assembled System variants. These tests pin their text three ways: golden
// files (wording), the draft's token estimator (the G6-D1 A2 caps) and a
// per-version sha256 pin (a wording change cannot ride a regenerated golden
// into an existing version).

func officePack(t *testing.T) Prompt {
	t.Helper()
	p, ok := LookupPrompt(PromptOfficeUniworkAI)
	if !ok {
		t.Fatalf("%s is not registered", PromptOfficeUniworkAI)
	}
	if p.ID != "office_uniwork_ai" || p.Version != 2 {
		t.Fatalf("registry entry is %s, want office_uniwork_ai@2", p.Key())
	}
	return p
}

func officeGoldenVersion(t *testing.T, version int, name string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", fmt.Sprintf("office_uniwork_ai_v%d_%s.golden", version, name)))
	if err != nil {
		t.Fatalf("v%d %s golden: %v", version, name, err)
	}
	return string(b)
}

func officeGolden(t *testing.T, name string) string {
	t.Helper()
	return officeGoldenVersion(t, 2, name)
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
// UntrustedFooter (draft §0), for both @1 and @2.
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

	// @1 stays registered and matches its v1 goldens untouched.
	p1, ok := LookupPrompt("office_uniwork_ai@1")
	if !ok {
		t.Fatal("office_uniwork_ai@1 is not registered")
	}
	if c1 := officeGoldenVersion(t, 1, "common"); c1 != p1.System {
		t.Errorf("v1 common section drift: %s", firstDiff(c1, p1.System))
	}
	for _, m := range officeModuleSections {
		if s1 := officeGoldenVersion(t, 1, m.section); s1 != p1.Sections[m.section] {
			t.Errorf("v1 %s section drift: %s", m.section, firstDiff(s1, p1.Sections[m.section]))
		}
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

	// A routed module whose section key is missing is an error, never a
	// module-less prompt (BE14-3).
	p := officePack(t)
	for _, m := range officeModuleSections {
		missing := p
		missing.Sections = map[string]string{}
		for k, v := range p.Sections {
			if k != m.section {
				missing.Sections[k] = v
			}
		}
		if got, err := officeAssemble(missing, m.module); err == nil {
			t.Errorf("%s without its %s section assembled %d bytes", m.module, m.section, len(got))
		}
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
// (chars/3.5 is ~15% above ~4 chars/token).
func TestOfficePackTokenCaps(t *testing.T) {
	versions := []struct {
		key     string
		wantEst map[string]int
		worst   int
	}{
		{
			key: "office_uniwork_ai@1",
			wantEst: map[string]int{
				"common": 800, "sheets": 1090, "docs": 571, "slides": 236, "pdf": 252, "markdown": 224, "html": 164,
			},
			worst: 1890,
		},
		{
			key: "office_uniwork_ai@2",
			wantEst: map[string]int{
				"common": 790, "sheets": 1190, "docs": 595, "slides": 236, "pdf": 252, "markdown": 224, "html": 164,
			},
			worst: 1980,
		},
	}
	for _, v := range versions {
		v := v
		t.Run(v.key, func(t *testing.T) {
			p, ok := LookupPrompt(v.key)
			if !ok {
				t.Fatalf("%s is not registered", v.key)
			}
			commonVariant := p.System + "\n" + UntrustedFooter
			if got := officeEstimate(commonVariant); got != v.wantEst["common"] || got > 800 {
				t.Errorf("%s common+footer estimate %d (pinned %d), cap 800", v.key, got, v.wantEst["common"])
			}
			for _, m := range officeModuleSections {
				if got := officeEstimate(p.Sections[m.section]); got != v.wantEst[m.section] || got > 1200 {
					t.Errorf("%s %s estimate %d (pinned %d), cap 1200", v.key, m.section, got, v.wantEst[m.section])
				}
			}
			// The A2 cap is on the assembled turn: common + the largest module + the
			// join separators. Each variant is counted whole, so the separators are
			// measured, not assumed.
			worst := 0
			for _, m := range officeModuleSections {
				text, err := officeAssemble(p, m.module)
				if err != nil {
					t.Fatalf("%s %s: %v", v.key, m.module, err)
				}
				if got := officeEstimate(text); got > 2000 {
					t.Errorf("%s %s assembled estimate %d, cap 2000", v.key, m.module, got)
				} else if got > worst {
					worst = got
				}
			}
			if worst != v.worst {
				t.Errorf("%s worst assembled estimate %d, pinned %d", v.key, worst, v.worst)
			}
		})
	}
}

// officePackPins pins the released text of every office pack version: one
// sha256 over the common variant and all assembled module variants.
// Regenerating the goldens does not re-pin a version — to change wording,
// bump office_uniwork_ai to a new version and add its pin, so a usage row's
// prompt_id keeps explaining the text that was actually sent.
var officePackPins = map[string]string{
	"office_uniwork_ai@1": "610071c053949cca830cacac60883e3491fa131418e377757893b5965d8b1faa",
	"office_uniwork_ai@2": "1e47cf912b53dfb5c481f34bce6c27cc0c7e2e310f1ba22088083c8b0a3e5a82",
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
	// Note says why a row is provisional when the question alone does not
	// (a review finding, or a defect that lives outside the pack).
	Note string `json:"note,omitempty"`
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

// TestGatewayOfficeUniworkUsageRow pins G6-A10's trace and BE14-1 on the real
// path: a normal UniWork AI turn (History ending with the user's message,
// Request.Module set as G6-03a sets it) and the tool-result turn after it both
// send the assembled COMMON + MODULE + footer for the named module, and both
// leave prompt_id office_uniwork_ai@1 on their usage row. Like every gateway
// test it needs a reachable test database (TEST_DATABASE_URL or the default on
// localhost): it SKIPs locally and the cloud round runs it.
func TestGatewayOfficeUniworkUsageRow(t *testing.T) {
	ctx := context.Background()
	fp := &provider.Fake{Reply: func(provider.CompletionRequest) provider.CompletionResponse {
		return provider.CompletionResponse{Text: "3 rows in column A.", Model: "fake", InputTokens: 40, OutputTokens: 8}
	}}
	g, q := gatewayFixture(t, fp, &fakeQuota{})
	want, err := OfficeSystemPrompt("xlsx")
	if err != nil {
		t.Fatal(err)
	}
	ask := []provider.Message{{Role: "user", Content: "how many rows does column A have?"}}
	turns := map[string]Request{
		"normal": {History: ask},
		"tool result": {ToolResultTurn: true, History: append(append([]provider.Message{}, ask...),
			provider.Message{Role: "assistant", ToolCalls: []provider.ToolCall{{ID: "call_1", Name: "read_range", Input: json.RawMessage(`{"range":"A:A"}`)}}},
			provider.Message{Role: "tool", ToolCallID: "call_1", Content: `{"rows":3}`},
		)},
	}
	for _, name := range []string{"normal", "tool result"} {
		req := turns[name]
		req.Actor, req.OrganizationID, req.WorkspaceID = audit.User("u1"), "org1", "ws1"
		req.Capability, req.PromptID, req.Module = CapOfficeUniworkAI, PromptOfficeUniworkAI, "xlsx"
		calls := fp.Calls
		resp, err := g.Complete(ctx, req)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if fp.Calls != calls+1 {
			t.Fatalf("%s: provider called %d times", name, fp.Calls-calls)
		}
		if fp.Last.System != want {
			t.Fatalf("%s: system text is not the xlsx variant: %s", name, firstDiff(want, fp.Last.System))
		}
		if gj, wj := mustJSON(t, fp.Last.Messages), mustJSON(t, req.History); gj != wj {
			t.Fatalf("%s: sent more than the history:\n%s\n%s", name, gj, wj)
		}
		row, err := q.AiGetUsageEvent(ctx, resp.UsageEventID)
		if err != nil {
			t.Fatal(err)
		}
		if row.PromptID != PromptOfficeUniworkAI {
			t.Fatalf("%s: usage row prompt_id = %q, want %q", name, row.PromptID, PromptOfficeUniworkAI)
		}
		if row.Capability != string(CapOfficeUniworkAI) {
			t.Fatalf("%s: usage row capability = %q, want %q", name, row.Capability, CapOfficeUniworkAI)
		}
	}
}

func TestOfficePackModuleMaxTokens(t *testing.T) {
	want := map[string]int{
		"xlsx": 2048,
		"docx": 3072,
		"pptx": 2048,
		"pdf":  2048,
		"md":   3072,
		"html": 4096,
	}
	capCeiling := policies[CapOfficeUniworkAI].MaxTokens
	for _, m := range officeModuleSections {
		got := OfficeModuleMaxTokens(m.module)
		if got != want[m.module] {
			t.Errorf("OfficeModuleMaxTokens(%q) = %d, want %d", m.module, got, want[m.module])
		}
		if got <= 0 || got > capCeiling {
			t.Errorf("OfficeModuleMaxTokens(%q) = %d outside (0, %d]", m.module, got, capCeiling)
		}
	}
	if got := OfficeModuleMaxTokens("unknown"); got != capCeiling {
		t.Errorf("OfficeModuleMaxTokens(unknown) = %d, want %d", got, capCeiling)
	}
}

// TestGatewayOfficeModuleMaxTokens verifies BE68-1: Gateway.Complete sets
// provider.CompletionRequest.MaxTokens from OfficeModuleMaxTokens(req.Module)
// for CapOfficeUniworkAI (lowering xlsx/pptx/pdf to 2048 and docx/md to 3072
// while keeping html at 4096), refuses unknown/empty modules on the sectioned
// office prompt before reaching the provider, falls back to 4096 when a
// non-sectioned prompt runs under CapOfficeUniworkAI with an empty/unknown
// module, and leaves every other capability's MaxTokens unchanged.
func TestGatewayOfficeModuleMaxTokens(t *testing.T) {
	ctx := context.Background()
	fp := &provider.Fake{Reply: func(provider.CompletionRequest) provider.CompletionResponse {
		return provider.CompletionResponse{Text: "ok", Model: "fake", UsagePresent: true, InputTokens: 20, OutputTokens: 5}
	}}
	g, _ := gatewayFixture(t, fp, &fakeQuota{})

	wantByModule := map[string]int{
		"xlsx": 2048,
		"docx": 3072,
		"pptx": 2048,
		"pdf":  2048,
		"md":   3072,
		"html": 4096,
	}
	for _, m := range officeModuleSections {
		req := Request{
			Actor:          audit.User("u1"),
			OrganizationID: "org1",
			WorkspaceID:    "ws1",
			Capability:     CapOfficeUniworkAI,
			PromptID:       PromptOfficeUniworkAI,
			Module:         m.module,
			History:        []provider.Message{{Role: "user", Content: "check"}},
		}
		if _, err := g.Complete(ctx, req); err != nil {
			t.Fatalf("module %s: %v", m.module, err)
		}
		if fp.Last.MaxTokens != wantByModule[m.module] {
			t.Fatalf("module %s: provider MaxTokens = %d, want %d", m.module, fp.Last.MaxTokens, wantByModule[m.module])
		}
	}

	// Empty and unknown modules on the sectioned office prompt are refused by
	// systemText before reaching the provider; OfficeModuleMaxTokens itself
	// falls back to 4096 (and a non-sectioned prompt under CapOfficeUniworkAI
	// with an empty/unknown module receives 4096).
	for _, badModule := range []string{"", "unknown"} {
		callsBefore := fp.Calls
		_, err := g.Complete(ctx, Request{
			Actor:          audit.User("u1"),
			OrganizationID: "org1",
			WorkspaceID:    "ws1",
			Capability:     CapOfficeUniworkAI,
			PromptID:       PromptOfficeUniworkAI,
			Module:         badModule,
			History:        []provider.Message{{Role: "user", Content: "check"}},
		})
		if err == nil || !strings.HasPrefix(err.Error(), "ai: policy:") {
			t.Fatalf("module %q on sectioned office prompt: got err %v, want policy refusal", badModule, err)
		}
		if fp.Calls != callsBefore {
			t.Fatalf("module %q reached provider (%d -> %d calls)", badModule, callsBefore, fp.Calls)
		}
	}

	const nonSectionedKey = "test_office_ceiling_fallback@1"
	prompts[nonSectionedKey] = Prompt{
		ID: "test_office_ceiling_fallback", Version: 1, System: "sys " + UntrustedFooter,
		Render: func(map[string]any) string { return "q" },
	}
	t.Cleanup(func() { delete(prompts, nonSectionedKey) })
	for _, fallbackMod := range []string{"", "unknown"} {
		if _, err := g.Complete(ctx, Request{
			Actor:          audit.User("u1"),
			OrganizationID: "org1",
			WorkspaceID:    "ws1",
			Capability:     CapOfficeUniworkAI,
			PromptID:       nonSectionedKey,
			Module:         fallbackMod,
		}); err != nil {
			t.Fatalf("fallback module %q: %v", fallbackMod, err)
		}
		if fp.Last.MaxTokens != 4096 {
			t.Fatalf("fallback module %q: provider MaxTokens = %d, want 4096", fallbackMod, fp.Last.MaxTokens)
		}
	}

	// Other capabilities ignore Request.Module and keep their own policy.MaxTokens.
	copilotReq := askReq()
	copilotReq.Module = "xlsx"
	fp.Reply = FakeReply
	if _, err := g.Complete(ctx, copilotReq); err != nil {
		t.Fatalf("copilot with Module=xlsx: %v", err)
	}
	if wantCopilot := policies[CapCopilotAnswer].MaxTokens; fp.Last.MaxTokens != wantCopilot {
		t.Fatalf("copilot MaxTokens = %d, want %d", fp.Last.MaxTokens, wantCopilot)
	}
}
