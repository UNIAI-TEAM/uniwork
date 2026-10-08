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

func TestOfficeHTMLVisualEditIsPublicAndOffByDefault(t *testing.T) {
	f, ok := Lookup("office_html_visual_edit")
	if !ok {
		t.Fatal("office_html_visual_edit is not declared")
	}
	if f.Default || !f.Public || f.Owner != "office" {
		t.Fatalf("office_html_visual_edit = %+v, want default off, public, owner office", f)
	}
	flags := EvaluateFrontendPublicFlags(context.Background(), nil)
	if v, published := flags["office_html_visual_edit"]; !published || v {
		t.Fatalf("published=%v value=%v, want published and false", published, v)
	}
}

func TestOfficeDocsWebIsPublicOffByDefaultAndReviewed(t *testing.T) {
	f, ok := Lookup("office_docs_web")
	if !ok {
		t.Fatal("office_docs_web is not declared")
	}
	if f.Default || !f.Public || f.Owner != "office" || !f.ReviewAt.Equal(day(2026, 12, 5)) {
		t.Fatalf("office_docs_web = %+v, want default off, public, owner office, review 2026-12-05", f)
	}
	flags := EvaluateFrontendPublicFlags(context.Background(), nil)
	if v, published := flags["office_docs_web"]; !published || v {
		t.Fatalf("published=%v value=%v, want published and false", published, v)
	}
}

func TestOfficeFormatFlagsAreOnByDefaultAndEngineStaysOff(t *testing.T) {
	flags := EvaluateFrontendPublicFlags(context.Background(), nil)
	for _, key := range []string{"office_docx", "office_xlsx", "office_pptx", "office_pdf", "office_markdown", "office_html"} {
		f, ok := Lookup(key)
		if !ok {
			t.Fatalf("%s is not declared", key)
		}
		if !f.Default || !f.Public || f.Owner != "office" {
			t.Fatalf("%s = %+v, want default on, public, owner office", key, f)
		}
		if v, published := flags[key]; !published || !v {
			t.Fatalf("%s published=%v value=%v, want published and true", key, published, v)
		}
	}
	engine, ok := Lookup("office_engine")
	if !ok || !engine.Default {
		t.Fatalf("office_engine = %+v ok=%v, want declared and default on", engine, ok)
	}
}
