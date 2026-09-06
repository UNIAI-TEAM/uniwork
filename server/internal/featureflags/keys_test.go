package featureflags

import (
	"context"
	"testing"
)

func TestNoServiceYieldsCatalogueDefaults(t *testing.T) {
	// A deployment without a flag file or database has no service; the public
	// endpoint still answers every public flag at its catalogue default.
	flags := EvaluateFrontendPublicFlags(context.Background(), nil)
	if flags == nil {
		t.Fatal("expected a map, got nil")
	}
	for _, f := range Catalogue() {
		got, published := flags[f.Key]
		if published != f.Public || (published && got != f.Default) {
			t.Fatalf("%s: published=%v value=%v, want public=%v default=%v", f.Key, published, got, f.Public, f.Default)
		}
	}
}

func TestNoInheritedCompatKeysArePublished(t *testing.T) {
	// The upstream catalogue published several permanently-enabled compat keys
	// for installed desktop clients. UniWork has no such clients; publishing
	// those keys here would advertise features that do not exist.
	flags := EvaluateFrontendPublicFlags(context.Background(), nil)
	for _, key := range []string{
		"composio_mcp_apps",
		"agents_agent_builder",
		"agents_skill_toggles",
		"settings_resource_labels",
		"desktop_hang_stack_capture",
	} {
		if _, published := flags[key]; published {
			t.Fatalf("%s is an upstream key and must not be published", key)
		}
	}
}
