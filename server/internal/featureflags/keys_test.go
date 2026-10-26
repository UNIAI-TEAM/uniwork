package featureflags

import (
	"context"
	"fmt"
	"os"
	"testing"

	"github.com/unicomhub/uniwork/server/pkg/featureflag"
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

// The web frame of every genoffice module has its own flag (UNI-1013 docs,
// UNI-1014/1015/1016 the others): on by default (user decision 2026-10-09,
// CONTRACT C14), public, owner office, one review date.
func TestOfficeWebModuleFlagsArePublicOnByDefaultAndReviewed(t *testing.T) {
	flags := EvaluateFrontendPublicFlags(context.Background(), nil)
	for _, key := range []string{"office_docs_web", "office_pdf_web", "office_markdown_web", "office_html_web", "office_slides_web", "office_sheets_web"} {
		f, ok := Lookup(key)
		if !ok {
			t.Fatalf("%s is not declared", key)
		}
		if !f.Default || !f.Public || f.Owner != "office" || !f.ReviewAt.Equal(day(2026, 12, 5)) {
			t.Fatalf("%s = %+v, want default on, public, owner office, review 2026-12-05", key, f)
		}
		if v, published := flags[key]; !published || !v {
			t.Fatalf("%s published=%v value=%v, want published and true", key, published, v)
		}
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

func TestOfficeTxtOpenFlagIsGone(t *testing.T) {
	// .txt opens like .md with no flag of its own (UNI-2046): the key is not
	// declared and not published to the web.
	if _, ok := Lookup("office_txt_open"); ok {
		t.Fatal("office_txt_open is still declared")
	}
	if _, published := EvaluateFrontendPublicFlags(context.Background(), nil)["office_txt_open"]; published {
		t.Fatal("office_txt_open is still published")
	}
}

// UniChat mobile reads its kill switches from mobile_flags; the calls switch is
// on by default (calls ship in the binary) and only a mobile flag is published there.
func TestMobileFlagsPublishTheCallsKillSwitchOnByDefault(t *testing.T) {
	flags := EvaluateMobileFlags(context.Background(), nil)
	if v, ok := flags["unichat_mobile_calls"]; !ok || !v {
		t.Fatalf("unichat_mobile_calls published=%v value=%v, want published and true", ok, v)
	}
	for _, f := range Catalogue() {
		if _, published := flags[f.Key]; published != f.Mobile {
			t.Fatalf("%s: in mobile_flags=%v, want %v", f.Key, published, f.Mobile)
		}
	}
	if _, onWeb := EvaluateFrontendPublicFlags(context.Background(), nil)["unichat_mobile_calls"]; onWeb {
		t.Fatal("unichat_mobile_calls is a phone switch, not a web flag")
	}
}

func TestMobileCallsKillSwitchTurnsOffByEnv(t *testing.T) {
	t.Setenv("FF_UNICHAT_MOBILE_CALLS", "false")
	svc := featureflag.NewService(featureflag.NewEnvProvider("FF_"))
	if EvaluateMobileFlags(context.Background(), svc)["unichat_mobile_calls"] {
		t.Fatal("FF_UNICHAT_MOBILE_CALLS=false must turn the calls switch off")
	}
}

// The phone's subsystem switches (audit "remote-config-thin") are mobile flags,
// on by default, and roll out to a share of people by a hash of the user id:
// FF_<KEY>=N% (or a `percent: {percent: N, by: user_id}` rule in the flags
// file) puts the same person in or out on every config read, about N% of all.
func TestMobileSubsystemSwitchesRollOutByUserPercent(t *testing.T) {
	for _, key := range []string{"unichat_mobile_media_upload", "unichat_mobile_voice_messages", "unichat_mobile_ai_catch_up", "unichat_mobile_outbox_flush", "unichat_mobile_background_send", "unichat_mobile_chat_sync"} {
		f, ok := Lookup(key)
		if !ok || !f.Mobile || !f.Default || f.Public || f.ReviewAt.IsZero() {
			t.Fatalf("%s: %+v, want a mobile flag on by default with a review date", key, f)
		}
		if !EvaluateMobileFlags(context.Background(), nil)[key] {
			t.Fatalf("%s is on without a service", key)
		}
	}
	byEnv := func(t *testing.T) *featureflag.Service {
		t.Setenv("FF_UNICHAT_MOBILE_VOICE_MESSAGES", "30%")
		return featureflag.NewService(featureflag.NewEnvProvider("FF_"))
	}
	byFile := func(t *testing.T) *featureflag.Service {
		return ruleFile(t, "unichat_mobile_voice_messages:\n  default: false\n  percent:\n    percent: 30\n    by: user_id\n")
	}
	for name, build := range map[string]func(*testing.T) *featureflag.Service{"env": byEnv, "file": byFile} {
		t.Run(name, func(t *testing.T) { rollsOutToAShare(t, build(t)) })
	}
}

func rollsOutToAShare(t *testing.T, rules *featureflag.Service) {
	t.Helper()
	on := 0
	for i := 0; i < 2000; i++ {
		ctx := featureflag.WithEvalContext(context.Background(), featureflag.EvalContext{UserID: fmt.Sprintf("01J8X4USER%016d", i)})
		first := EvaluateMobileFlags(ctx, rules)["unichat_mobile_voice_messages"]
		if again := EvaluateMobileFlags(ctx, rules)["unichat_mobile_voice_messages"]; again != first {
			t.Fatalf("user %d flipped between two reads", i)
		}
		if first {
			on++
		}
		if !EvaluateMobileFlags(ctx, rules)["unichat_mobile_media_upload"] {
			t.Fatal("a rollout of one switch leaves the others alone")
		}
	}
	if on < 500 || on > 700 {
		t.Fatalf("30%% rollout reached %d of 2000 people", on)
	}
}

func ruleFile(t *testing.T, yaml string) *featureflag.Service {
	t.Helper()
	path := t.TempDir() + "/flags.yaml"
	if err := os.WriteFile(path, []byte(yaml), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv(featureflag.EnvFlagFile, path)
	svc, err := featureflag.NewServiceFromEnv()
	if err != nil {
		t.Fatal(err)
	}
	return svc
}

// The calls kill switch reaches the server's own work too (UNI-2053): the
// push consumer reads it per recipient through ForPerson, the same answer
// the phone gets from GET /api/v1/config.
func TestForPersonReadsTheMobileCallsSwitch(t *testing.T) {
	ctx := context.Background()
	if !ForPerson(nil, "unichat_mobile_calls")(ctx, "u1", "o1") {
		t.Fatal("no flag service: want the catalogue default (on)")
	}
	if ForPerson(nil, "no_such_flag")(ctx, "u1", "o1") {
		t.Fatal("an undeclared key must read false")
	}
	t.Setenv("FF_UNICHAT_MOBILE_CALLS", "false")
	svc, err := featureflag.NewServiceFromEnv()
	if err != nil {
		t.Fatal(err)
	}
	if ForPerson(svc, "unichat_mobile_calls")(ctx, "u1", "o1") {
		t.Fatal("FF_UNICHAT_MOBILE_CALLS=false: want off")
	}
	t.Setenv("FF_UNICHAT_MOBILE_CALLS", "true")
	if !ForPerson(svc, "unichat_mobile_calls")(ctx, "u1", "o1") {
		t.Fatal("FF_UNICHAT_MOBILE_CALLS=true: want on")
	}
}

// Calls on an iPhone wait for CallKit (UNI-2053 audit "ios-no-callkit-pushkit"):
// unichat_mobile_calls_ios is a mobile flag, off by default, and an iPhone's
// unichat_mobile_calls reads off while it is off, whatever the calls switch
// says. Android and a caller that names no OS keep the calls switch alone;
// turning the iOS switch on gives an iPhone the calls switch's own answer.
func TestMobileCallsAreOffOnAnIPhoneUntilTheIOSSwitchIsOn(t *testing.T) {
	f, ok := Lookup("unichat_mobile_calls_ios")
	if !ok || !f.Mobile || f.Default || f.Public || f.ReviewAt.IsZero() {
		t.Fatalf("unichat_mobile_calls_ios = %+v, want a mobile flag off by default with a review date", f)
	}
	ctx := context.Background()
	if MobileFlagsFor(ctx, nil, "ios")["unichat_mobile_calls"] {
		t.Fatal("an iPhone must not call by default")
	}
	for _, os := range []string{"android", "", "web"} {
		if !MobileFlagsFor(ctx, nil, os)["unichat_mobile_calls"] {
			t.Fatalf("os %q: the calls switch alone decides, want on", os)
		}
	}
	t.Setenv("FF_UNICHAT_MOBILE_CALLS_IOS", "true")
	svc := featureflag.NewService(featureflag.NewEnvProvider("FF_"))
	if !MobileFlagsFor(ctx, svc, "ios")["unichat_mobile_calls"] {
		t.Fatal("iOS switch on: an iPhone calls")
	}
	t.Setenv("FF_UNICHAT_MOBILE_CALLS", "false")
	if MobileFlagsFor(ctx, svc, "ios")["unichat_mobile_calls"] || MobileFlagsFor(ctx, svc, "android")["unichat_mobile_calls"] {
		t.Fatal("the calls kill switch still turns calls off on every platform")
	}
}

// The recycled message list is an A/B, not a kill switch: a mobile flag off by default, with a review date, that
// a share of people (by user id) can be put on.
func TestTimelineRecycledIsAnOffByDefaultMobileRollout(t *testing.T) {
	f, ok := Lookup("unichat_mobile_timeline_recycled")
	if !ok || !f.Mobile || f.Default || f.Public || f.ReviewAt.IsZero() {
		t.Fatalf("unichat_mobile_timeline_recycled = %+v, want a mobile flag off by default with a review date", f)
	}
	if EvaluateMobileFlags(context.Background(), nil)["unichat_mobile_timeline_recycled"] {
		t.Fatal("unichat_mobile_timeline_recycled is off without a service")
	}
	t.Setenv("FF_UNICHAT_MOBILE_TIMELINE_RECYCLED", "true")
	if !EvaluateMobileFlags(context.Background(), featureflag.NewService(featureflag.NewEnvProvider("FF_")))["unichat_mobile_timeline_recycled"] {
		t.Fatal("FF_UNICHAT_MOBILE_TIMELINE_RECYCLED=true turns it on")
	}
}
