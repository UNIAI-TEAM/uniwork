package service

// Contract test for the flag keys the app capability route evaluates (plan
// X-03, GET /orgs/{orgID}/office/capabilities). The route's own handler test
// asserts behaviour through the HTTP surface; this one pins the keys
// themselves, which no HTTP assertion can see.

import (
	"testing"

	"github.com/unicomhub/uniwork/server/internal/featureflags"
)

// Every key OfficeCapabilitiesService.Get evaluates must be declared in the
// flag registry. enabled() takes the declared default when Lookup hits and
// falls back to false when it misses, so a key renamed or mistyped in
// featureflags/keys.go silently drops a capability the app asked about - and
// only the keys whose default is true would be noticed by a behavioural test,
// so a rename of office_offline_library or of one office_ai_uniwork_<format>
// would pass unnoticed. The list is derived from the service's own constants
// and format list, so renaming either side fails here.
func TestOfficeAppCapabilityFlagKeysAreDeclared(t *testing.T) {
	t.Parallel()

	evaluated := []string{
		officeSyncFeedFlag,
		officeSyncWriteFlag,
		officeOfflineLibraryFlag,
		officeAIUniworkFlag,
	}
	for _, format := range officeAIUniworkFormats {
		evaluated = append(evaluated, officeAIUniworkFormatPrefix+format)
	}

	// The exact set the route reads: four capability switches plus one flag per
	// AI format. A literal list, so a constant changed to a wrong name is a
	// failure here and not a silently-off capability.
	want := []string{
		"office_sync_feed",
		"office_sync_write",
		"office_offline_library",
		"office_ai_uniwork",
		"office_ai_uniwork_docx",
		"office_ai_uniwork_xlsx",
		"office_ai_uniwork_pptx",
		"office_ai_uniwork_pdf",
		"office_ai_uniwork_markdown",
		"office_ai_uniwork_html",
	}
	if len(evaluated) != len(want) {
		t.Fatalf("the route evaluates %d keys %v, want %d %v", len(evaluated), evaluated, len(want), want)
	}
	for i, key := range evaluated {
		if key != want[i] {
			t.Fatalf("key %d = %q, want %q", i, key, want[i])
		}
		if _, ok := featureflags.Lookup(key); !ok {
			t.Errorf("%s is evaluated by OfficeCapabilitiesService.Get but is not declared in the flag registry", key)
		}
	}
}
