package mail

import (
	"strings"
	"testing"
)

func TestVerificationCodeRendersBothLocales(t *testing.T) {
	r := Renderer{AppURL: "http://localhost:3000"}
	for _, loc := range []string{"vi", "en"} {
		m, err := r.VerificationCode("a@example.com", loc, "u1", VerificationData{Code: "123456", ExpiresInMinutes: 10})
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
	m, _ := r.VerificationCode("a@example.com", "fr", "", VerificationData{Code: "1", ExpiresInMinutes: 1})
	if m.Locale != "vi" {
		t.Fatalf("unknown locale must fall back to vi, got %q", m.Locale)
	}
}

func TestInviteEscapesUserFields(t *testing.T) {
	r := Renderer{AppURL: "http://localhost:3000"}
	for _, loc := range []string{"vi", "en"} {
		m, err := r.Invite("b@example.com", loc, InviteData{
			InviterName: "An <script>alert(1)</script>", WorkspaceName: "Đội\r\nAlpha",
			AcceptURL: "http://localhost:3000/invite/tok", ExpiresInDays: 7,
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
		m, err := r.PasswordReset("a@example.com", loc, "u1", PasswordResetData{ResetURL: "http://localhost:3000/reset-password?token=abc", ExpiresInMinutes: 60})
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
