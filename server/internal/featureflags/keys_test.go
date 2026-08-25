package featureflags

import (
	"context"
	"testing"
)

func TestNoServiceYieldsNoPublicFlags(t *testing.T) {
	// A deployment without a flag file has no service; the public endpoint must
	// still answer with a map, not a nil or a panic.
	flags := EvaluateFrontendPublicFlags(context.Background(), nil)
	if flags == nil {
		t.Fatal("expected an empty map, got nil")
	}
	if len(flags) != 0 {
		t.Fatalf("expected no public flags without a service, got %v", flags)
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
