package mail

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"
)

func TestVerificationCodeRendersBothLocales(t *testing.T) {
	r := Renderer{AppURL: "http://localhost:3000"}
	for _, loc := range []string{"vi", "en"} {
		m, err := r.VerificationCode("a@example.com", loc, "u1", VerificationData{Code: "123456", Expires: 10 * time.Minute})
		if err != nil {
			t.Fatalf("%s: %v", loc, err)
		}
		if m.Kind != KindVerificationCode || m.Locale != loc || m.UserID != "u1" || m.To != "a@example.com" {
			t.Fatalf("%s: envelope %+v", loc, m)
		}
		if !strings.Contains(m.Subject, "123456") || strings.ContainsAny(m.Subject, "\r\n") {
			t.Fatalf("%s: subject %q", loc, m.Subject)
		}
		if !strings.Contains(m.HTML, "123456") || !strings.Contains(m.Text, "123456") {
			t.Fatalf("%s: code missing from body", loc)
		}
		if !strings.Contains(m.HTML, "UniWork") || !strings.Contains(m.HTML, "http://localhost:3000") {
			t.Fatalf("%s: layout not applied", loc)
		}
	}
	m, _ := r.VerificationCode("a@example.com", "fr", "", VerificationData{Code: "1", Expires: time.Minute})
	if m.Locale != "vi" {
		t.Fatalf("unknown locale must fall back to vi, got %q", m.Locale)
	}
}

func TestInviteEscapesUserFields(t *testing.T) {
	r := Renderer{AppURL: "http://localhost:3000"}
	for _, loc := range []string{"vi", "en"} {
		m, err := r.Invite("b@example.com", loc, InviteData{
			InviterName: "An <script>alert(1)</script>", WorkspaceName: "Đội\r\nAlpha",
			AcceptURL: "http://localhost:3000/invite/tok", Expires: 7 * 24 * time.Hour,
		})
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(m.HTML, "<script>") || strings.ContainsAny(m.Subject, "\r\n") {
			t.Fatalf("%s: unsafe output subject=%q", loc, m.Subject)
		}
		if !strings.Contains(m.HTML, "http://localhost:3000/invite/tok") || !strings.Contains(m.Text, "http://localhost:3000/invite/tok") {
			t.Fatalf("%s: accept url missing", loc)
		}
		if m.Kind != KindWorkspaceInvite || m.UserID != "" {
			t.Fatalf("%s: envelope %+v", loc, m)
		}
	}
}

func TestPasswordResetRenders(t *testing.T) {
	r := Renderer{AppURL: "http://localhost:3000"}
	for _, loc := range []string{"vi", "en"} {
		m, err := r.PasswordReset("a@example.com", loc, "u1", PasswordResetData{ResetURL: "http://localhost:3000/reset-password?token=abc", Expires: time.Hour})
		if err != nil || m.Kind != KindPasswordReset || m.UserID != "u1" {
			t.Fatalf("%s: %v %+v", loc, err, m)
		}
		if !strings.Contains(m.HTML, "token=abc") || !strings.Contains(m.Text, "token=abc") {
			t.Fatalf("%s: reset url missing", loc)
		}
	}
}

func TestWelcomeRenders(t *testing.T) {
	r := Renderer{AppURL: "http://localhost:3000"}
	for _, loc := range []string{"vi", "en"} {
		m, err := r.Welcome("a@example.com", loc, "u1", WelcomeData{DisplayName: "An", WorkspaceName: "Đội Alpha", WorkspaceURL: "http://localhost:3000/acme/alpha"})
		if err != nil || m.Kind != KindWelcome || !strings.Contains(m.HTML, "/acme/alpha") || !strings.Contains(m.Text, "/acme/alpha") {
			t.Fatalf("%s: %v %+v", loc, err, m)
		}
	}
}

func TestSafeFieldStripsControlAndCaps(t *testing.T) {
	got := SafeField("Acme\r\nBcc: x@y.z " + strings.Repeat("a", 100))
	if strings.ContainsAny(got, "\r\n") || len([]rune(got)) > 60 {
		t.Fatalf("got %q", got)
	}
}

func TestExpiresSpeaksInWholeUnits(t *testing.T) {
	cases := []struct {
		d      time.Duration
		vi, en string
	}{
		{10 * time.Minute, "10 phút", "10 minutes"},
		{time.Minute, "1 phút", "1 minute"},
		{time.Hour, "1 giờ", "1 hour"},
		{90 * time.Minute, "90 phút", "90 minutes"},
		{7 * 24 * time.Hour, "7 ngày", "7 days"},
	}
	for _, c := range cases {
		if got := expires(c.d, "vi"); got != c.vi {
			t.Errorf("%v vi: got %q want %q", c.d, got, c.vi)
		}
		if got := expires(c.d, "en"); got != c.en {
			t.Errorf("%v en: got %q want %q", c.d, got, c.en)
		}
	}
}

// html/template drops HTML comments, and Outlook's conditional comments are
// HTML comments. The layout and the button route them through raw/button;
// this pins that they actually reach the output.
func TestOutlookConditionalsSurviveRendering(t *testing.T) {
	r := Renderer{AppURL: "http://localhost:3000"}
	m, err := r.PasswordReset("a@example.com", "vi", "u1", PasswordResetData{ResetURL: "http://localhost:3000/reset-password?token=abc", Expires: time.Hour})
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		`<!--[if mso]><table role="presentation" width="480"`,
		`<v:roundrect`, `href="http://localhost:3000/reset-password?token=abc"`,
		`<!--[if !mso]><!-->`, `<h1 `,
	} {
		if !strings.Contains(m.HTML, want) {
			t.Errorf("missing %q", want)
		}
	}
}

func TestButtonEscapesArguments(t *testing.T) {
	got := string(button(`http://x/?a=1&b="2"`, `<b>Go</b>`))
	if strings.Contains(got, `<b>`) || strings.Contains(got, `"2"`) {
		t.Fatalf("unescaped: %s", got)
	}
	if !strings.Contains(got, "&lt;b&gt;Go&lt;/b&gt;") || !strings.Contains(got, "a=1&amp;b=&#34;2&#34;") {
		t.Fatalf("escaped form missing: %s", got)
	}
}

// Mail cannot use CSS variables, so the templates carry the light-theme
// values of packages/ui/styles/tokens.css inline. This keeps them the same
// values: change a token on the web and the mail fails until it follows.
func TestMailColoursMatchWebTokens(t *testing.T) {
	css, err := os.ReadFile(filepath.Join("..", "..", "..", "packages", "ui", "styles", "tokens.css"))
	if err != nil {
		t.Fatal(err)
	}
	root := string(css)
	root = root[strings.Index(root, ":root"):]
	root = root[:strings.Index(root, "}")]
	token := func(name string) string {
		m := regexp.MustCompile(`--` + name + `:\s*(#[0-9a-fA-F]{6})`).FindStringSubmatch(root)
		if m == nil {
			t.Fatalf("token --%s not found in :root", name)
		}
		return strings.ToLower(m[1])
	}
	layout, err := templateFS.ReadFile("templates/layout.html")
	if err != nil {
		t.Fatal(err)
	}
	all := strings.ToLower(string(layout))
	for _, k := range kinds {
		b, err := templateFS.ReadFile("templates/" + k + ".vi.html")
		if err != nil {
			t.Fatal(err)
		}
		all += strings.ToLower(string(b))
	}
	all += strings.ToLower(string(button("http://x", "x")))
	for _, name := range []string{"background", "card", "foreground", "muted", "muted-foreground", "border", "primary"} {
		if !strings.Contains(all, token(name)) {
			t.Errorf("--%s = %s is not used by the mail templates", name, token(name))
		}
	}
	// And nothing off-palette: every hex in the templates is one of the tokens.
	allowed := map[string]bool{"#ffffff": true}
	for _, name := range []string{"background", "card", "foreground", "muted", "muted-foreground", "border", "primary"} {
		allowed[token(name)] = true
	}
	allowed["#71717a"] = true // footer/caption: --muted-foreground is 7.7:1, this is the 4.6:1 floor for 12px on --background
	for _, hex := range regexp.MustCompile(`#[0-9a-f]{6}`).FindAllString(all, -1) {
		if !allowed[hex] {
			t.Errorf("colour %s is not a web token", hex)
		}
	}
}
