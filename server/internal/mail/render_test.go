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
	if m.Locale != "en" {
		t.Fatalf("unknown locale must fall back to en, got %q", m.Locale)
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

// A sign-in from the phone app names the device it came from, not a browser.
func TestNewLoginFromTheAppNamesTheDevice(t *testing.T) {
	r := Renderer{AppURL: "http://localhost:3000"}
	at := time.Date(2026, 10, 23, 9, 30, 0, 0, time.UTC)
	for loc, want := range map[string][2]string{"vi": {"Thiết bị", "Trình duyệt"}, "en": {"Device", "Browser"}} {
		app, err := r.NewLogin("a@example.com", loc, "u1", NewLoginData{UserAgent: "iPhone của An", IP: "10.0.0.1", At: at, SessionsURL: "http://localhost:3000/settings?tab=security", App: true})
		if err != nil || app.Kind != KindNewLogin {
			t.Fatalf("%s: %v %+v", loc, err, app)
		}
		for _, body := range []string{app.HTML, app.Text} {
			if !strings.Contains(body, want[0]) || strings.Contains(body, want[1]) || !strings.Contains(body, "iPhone của An") {
				t.Fatalf("%s: the app sign-in names the device: %s", loc, body)
			}
		}
		web, err := r.NewLogin("a@example.com", loc, "u1", NewLoginData{UserAgent: "Firefox", IP: "10.0.0.1", At: at, SessionsURL: "x"})
		if err != nil || !strings.Contains(web.Text, want[1]) {
			t.Fatalf("%s: the browser sign-in keeps its words: %v %s", loc, err, web.Text)
		}
	}
}

// One kind tells of every change to the ways into an account (ADR 0047), in
// both languages: the change in the subject, where it came from, the security
// settings and, if it was not the owner, the password reset. It replaced
// apple_linked, which only told of an Apple link.
func TestSignInMethodChangedRendersEveryChangeInBothLocales(t *testing.T) {
	r := Renderer{AppURL: "http://localhost:3000"}
	at := time.Date(2026, 10, 27, 9, 30, 0, 0, time.UTC)
	cases := []struct {
		change, method string
		away           bool
		subject        map[string]string
	}{
		{SignInChangeLinked, SignInMethodApple, false, map[string]string{"vi": "Apple đã được liên kết", "en": "Apple was linked"}},
		{SignInChangeUnlinked, SignInMethodGoogle, false, map[string]string{"vi": "Google đã được gỡ", "en": "Google was unlinked"}},
		{SignInChangeReclaimed, SignInMethodGoogle, false, map[string]string{"vi": "lấy lại tài khoản", "en": "took back your UniWork account"}},
		{SignInChangeReclaimed, SignInMethodPassword, false, map[string]string{"vi": "lấy lại tài khoản", "en": "took back your UniWork account"}},
		{SignInChangeMoved, SignInMethodApple, false, map[string]string{"vi": "chuyển vào tài khoản", "en": "moved into your"}},
		{SignInChangeMoved, SignInMethodApple, true, map[string]string{"vi": "chuyển sang một tài khoản", "en": "moved to another"}},
		{SignInChangePasswordSet, SignInMethodPassword, false, map[string]string{"vi": "Đã đặt mật khẩu", "en": "password was set"}},
		{SignInChangePasswordChanged, SignInMethodPassword, false, map[string]string{"vi": "Mật khẩu tài khoản UniWork đã được đổi", "en": "password was changed"}},
		{SignInChangeSecondFactorLocked, "", false, map[string]string{"vi": "Tạm dừng", "en": "paused"}},
	}
	for _, tc := range cases {
		for _, loc := range []string{"vi", "en"} {
			m, err := r.SignInMethodChanged("a@example.com", loc, "u1", SignInMethodChangedData{
				Change: tc.change, Method: tc.method, MovedAway: tc.away,
				Device: "iPhone của An", IP: "10.0.0.1", At: at, LockedFor: 15 * time.Minute,
			})
			if err != nil || m.Kind != KindSignInMethodChanged || m.UserID != "u1" || m.Locale != loc || m.To != "a@example.com" {
				t.Fatalf("%s/%s: %v %+v", tc.change, loc, err, m)
			}
			if !strings.Contains(m.Subject, tc.subject[loc]) || strings.ContainsAny(m.Subject, "\r\n") {
				t.Fatalf("%s/%s: subject %q", tc.change, loc, m.Subject)
			}
			for _, body := range []string{m.HTML, m.Text} {
				for _, want := range []string{"iPhone của An", "10.0.0.1", "http://localhost:3000/settings?tab=security", "http://localhost:3000/forgot-password"} {
					if !strings.Contains(body, want) {
						t.Fatalf("%s/%s: body misses %q: %s", tc.change, loc, want, body)
					}
				}
				if strings.Contains(body, "{{") || strings.Contains(body, "<no value>") {
					t.Fatalf("%s/%s: unrendered template: %s", tc.change, loc, body)
				}
			}
			if tc.change == SignInChangeSecondFactorLocked && !strings.Contains(m.Text, map[string]string{"vi": "15 phút", "en": "15 minutes"}[loc]) {
				t.Fatalf("%s: the lockout names its length: %s", loc, m.Text)
			}
			if tc.change == SignInChangeReclaimed && tc.method == SignInMethodPassword && !strings.Contains(m.Text, map[string]string{"vi": "liên kết đặt lại mật khẩu", "en": "password reset link"}[loc]) {
				t.Fatalf("%s: a reclaim by reset link says so: %s", loc, m.Text)
			}
		}
	}

	// Where the change came from is optional; the time never is.
	m, err := r.SignInMethodChanged("a@example.com", "en", "u1", SignInMethodChangedData{Change: SignInChangePasswordSet, Method: SignInMethodPassword, At: at})
	if err != nil || strings.Contains(m.Text, "Device:") || strings.Contains(m.Text, "IP address:") || !strings.Contains(m.Text, "When: 2026-10-27 09:30") {
		t.Fatalf("no device or address: %v %s", err, m.Text)
	}
	// User-controlled fields stay text.
	m, _ = r.SignInMethodChanged("a@example.com", "vi", "u1", SignInMethodChangedData{Change: SignInChangeLinked, Method: SignInMethodGoogle, Device: "<script>x</script>", At: at})
	if strings.Contains(m.HTML, "<script>") {
		t.Fatalf("device not escaped: %s", m.HTML)
	}
	// A change it does not know, or a method the change cannot name, is an
	// error rather than an empty mail.
	for _, d := range []SignInMethodChangedData{
		{Change: "apple_linked", Method: SignInMethodApple},
		{Change: SignInChangeLinked, Method: SignInMethodPassword},
		{Change: SignInChangeLinked},
		{Change: SignInChangePasswordSet, Method: SignInMethodGoogle},
		{Change: SignInChangeSecondFactorLocked, Method: SignInMethodPassword},
	} {
		if _, err := r.SignInMethodChanged("a@example.com", "vi", "u1", d); err == nil {
			t.Fatalf("%+v rendered", d)
		}
	}
}
