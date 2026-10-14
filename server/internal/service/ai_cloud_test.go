package service

import (
	"slices"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/ai"
)

// Every web frame module maps to the office_ai_uniwork_<format> token of the
// format it opens, through the same module table the frame token uses, and
// every token it yields is one the X-03 capability route evaluates.
func TestUniworkAIFormatOfEveryFrameModule(t *testing.T) {
	want := map[string]string{
		OfficeFrameModuleDocs:     "docx",
		OfficeFrameModuleSheets:   "xlsx",
		OfficeFrameModuleSlides:   "pptx",
		OfficeFrameModulePDF:      "pdf",
		OfficeFrameModuleMarkdown: "markdown",
		OfficeFrameModuleHTML:     "html",
	}
	for _, m := range officeFrameModules {
		got, ok := uniworkAIFormatOfModule(m.module)
		if !ok || got != want[m.module] {
			t.Errorf("module %s -> %q %v, want %q", m.module, got, ok, want[m.module])
		}
		if !slices.Contains(officeAIUniworkFormats, got) {
			t.Errorf("module %s -> %q is not a capability format %v", m.module, got, officeAIUniworkFormats)
		}
	}
	if got, ok := uniworkAIFormatOfModule("odt"); ok {
		t.Errorf("unknown module -> %q, want none", got)
	}
}

// The frame grant uniwork_ai needs chat (member, entitlement, configured,
// office_ai_uniwork) AND the document's format flag: a format switched off
// closes only that format.
func TestUniworkAIGrantNeedsChatAndTheDocumentFormat(t *testing.T) {
	on := AICloudStatus{Chat: true, UniworkAIFormats: []string{"docx", "pdf"}}
	cases := []struct {
		name   string
		st     AICloudStatus
		module string
		want   bool
	}{
		{"docx on", on, OfficeFrameModuleDocs, true},
		{"pdf on", on, OfficeFrameModulePDF, true},
		{"xlsx flag off", on, OfficeFrameModuleSheets, false},
		{"unknown module", on, "odt", false},
		{"chat off keeps every format off", AICloudStatus{UniworkAIFormats: []string{"docx"}}, OfficeFrameModuleDocs, false},
		{"zero status", AICloudStatus{}, OfficeFrameModuleDocs, false},
	}
	for _, c := range cases {
		if got := c.st.UniworkAIFor(c.module); got != c.want {
			t.Errorf("%s: UniworkAIFor(%s) = %v, want %v", c.name, c.module, got, c.want)
		}
	}
}

// For an entitled organization: enabled is "some cloud tool or chat can run";
// spent credits read as reason credits_exhausted with enabled kept true, so
// the client shows the credits-exhausted state, and chat stays whatever the
// configuration and flags say (the turn itself answers 402).
func TestCloudStateCreditsExhaustedKeepsChat(t *testing.T) {
	zero, some := int64(0), int64(10)
	cases := []struct {
		name        string
		tools       ai.CloudAvailability
		chat        bool
		credits     CloudCredits
		wantEnabled bool
		wantReason  string
	}{
		{"nothing configured", ai.CloudAvailability{}, false, CloudCredits{}, false, "cloud_unavailable"},
		{"chat only", ai.CloudAvailability{}, true, CloudCredits{Remaining: &some}, true, ""},
		{"tools, credits left", ai.CloudAvailability{WebSearch: true}, false, CloudCredits{Remaining: &some}, true, ""},
		{"unlimited plan", ai.CloudAvailability{WebSearch: true}, true, CloudCredits{}, true, ""},
		{"credits spent, chat on", ai.CloudAvailability{}, true, CloudCredits{Remaining: &zero}, true, "credits_exhausted"},
		{"credits spent, tools on", ai.CloudAvailability{WebSearch: true}, false, CloudCredits{Remaining: &zero}, true, "credits_exhausted"},
		{"credits spent, nothing configured", ai.CloudAvailability{}, false, CloudCredits{Remaining: &zero}, false, "cloud_unavailable"},
	}
	for _, c := range cases {
		enabled, reason := cloudState(c.tools, c.chat, c.credits)
		if enabled != c.wantEnabled || reason != c.wantReason {
			t.Errorf("%s: cloudState = %v %q, want %v %q", c.name, enabled, reason, c.wantEnabled, c.wantReason)
		}
	}
}
