package notification

import (
	"encoding/json"
	"os"
	"testing"
)

// The server renders the same words the client does. The client's copy is
// the source (vi.json first, then en.json); this test fails when titles.go
// stops matching it, so push and digest never say something the inbox
// would not.
func TestTitlesMatchClientLocales(t *testing.T) {
	for _, locale := range []string{"vi", "en"} {
		raw, err := os.ReadFile("../../../packages/core/i18n/locales/" + locale + ".json")
		if err != nil {
			t.Fatal(err)
		}
		var doc struct {
			Notifications struct {
				Kind      map[string]string `json:"kind"`
				KindTitle map[string]string `json:"kindTitle"`
			} `json:"notifications"`
		}
		if err := json.Unmarshal(raw, &doc); err != nil {
			t.Fatal(err)
		}
		for _, kind := range Kinds {
			if got, want := titles[locale][kind], doc.Notifications.Kind[kind]; got != want {
				t.Errorf("%s %s: server %q, client %q", locale, kind, got, want)
			}
		}
		// OQ-C8: every kind the client gives a short title must have the same
		// one server-side, and the server must not hold a short title the
		// client cannot render.
		for kind, want := range doc.Notifications.KindTitle {
			if got := kindTitles[locale][kind]; got != want {
				t.Errorf("%s kindTitle %s: server %q, client %q", locale, kind, got, want)
			}
		}
		for kind := range kindTitles[locale] {
			if _, ok := doc.Notifications.KindTitle[kind]; !ok {
				t.Errorf("%s kindTitle %s: server has a short title the client does not", locale, kind)
			}
		}
	}
	if got := Title("vi", KindTaskAssigned, map[string]string{"actor": "An", "task": "Spec"}); got != "An đã giao bạn việc “Spec”" {
		t.Fatalf("Title = %q", got)
	}
	if got := Title("xx", KindAuditExportReady, nil); got != titles["en"][KindAuditExportReady] {
		t.Fatalf("unknown locale did not fall back to en: %q", got)
	}
}
