package service

import (
	"errors"
	"net/http"
	"strings"
	"testing"
)

// customEmailHubInput is a valid custom-server request each case bends.
func customEmailHubInput() ConnectEmailHubInput {
	return ConnectEmailHubInput{
		IMAPHost: "mail.example.com", IMAPPort: 993, IMAPSecurity: "tls",
		SMTPHost: "mail.example.com", SMTPPort: 465, SMTPSecurity: "tls",
	}
}

func wantEmailHubServerErr(t *testing.T, err error, sentinel error, field, host string) {
	t.Helper()
	var ce CodedError
	if !errors.Is(err, sentinel) || !errors.As(err, &ce) || ce.Status != http.StatusBadRequest || ce.Fields["field"] != field {
		t.Fatalf("want %v on field %s, got %#v", sentinel, field, err)
	}
	if h := strings.TrimSpace(host); h != "" && strings.Contains(err.Error(), h) {
		t.Fatalf("error text names the host: %q", err.Error())
	}
}

func TestResolveEmailHubServerPreset(t *testing.T) {
	got, err := resolveEmailHubServer("user@gmail.com", ConnectEmailHubInput{})
	want := emailHubServer{
		Provider: "gmail", IMAPHost: "imap.gmail.com", IMAPPort: 993, IMAPSecurity: "tls",
		SMTPHost: "smtp.gmail.com", SMTPPort: 587, SMTPSecurity: "starttls",
	}
	if err != nil || got != want {
		t.Fatalf("gmail preset: got %+v, %v", got, err)
	}
	if _, err := resolveEmailHubServer("user@unknown.example", ConnectEmailHubInput{}); !errors.Is(err, ErrEmailHubUnsupported) {
		t.Fatalf("unknown domain without a server: want ErrEmailHubUnsupported, got %v", err)
	}
	// A login name alone is a custom request, not a silently ignored field.
	_, err = resolveEmailHubServer("user@gmail.com", ConnectEmailHubInput{Username: "ops"})
	wantEmailHubServerErr(t, err, ErrEmailHubInvalidServer, "imap_host", "")
}

func TestResolveEmailHubServerCustom(t *testing.T) {
	got, err := resolveEmailHubServer("me@example.com", ConnectEmailHubInput{
		IMAPHost: " MAIL.Example.COM. ", IMAPPort: 143, IMAPSecurity: "starttls",
		SMTPHost: "Smtp.Example.com", SMTPPort: 587, SMTPSecurity: "starttls", Username: " ops-login ",
	})
	want := emailHubServer{
		Provider: "custom", IMAPHost: "mail.example.com", IMAPPort: 143, IMAPSecurity: "starttls",
		SMTPHost: "smtp.example.com", SMTPPort: 587, SMTPSecurity: "starttls", Username: "ops-login",
	}
	if err != nil || got != want {
		t.Fatalf("custom: got %+v, %v", got, err)
	}

	hosts := []struct{ raw, want string }{
		{"mail.example.com", "mail.example.com"},
		{"[2606:4700::1111]", "2606:4700::1111"},
		{"2606:4700::1111", "2606:4700::1111"},
		{"::ffff:8.8.8.8", "8.8.8.8"},
		{"Bücher.example", "xn--bcher-kva.example"},
		{"xn--bcher-kva.example", "xn--bcher-kva.example"},
		{strings.Repeat("a", 63) + ".example.com", strings.Repeat("a", 63) + ".example.com"},
	}
	for _, h := range hosts {
		in := customEmailHubInput()
		in.IMAPHost = h.raw
		got, err := resolveEmailHubServer("me@example.com", in)
		if err != nil || got.IMAPHost != h.want {
			t.Errorf("host %q: got %q, %v; want %q", h.raw, got.IMAPHost, err, h.want)
		}
	}
	// A case-only or trailing-dot edit is the same server: Task 3 wipes the
	// cache on a server change.
	a, _ := normalizeEmailHubHost("MAIL.Example.COM.")
	b, _ := normalizeEmailHubHost("mail.example.com")
	if a != b {
		t.Fatalf("normalization differs: %q vs %q", a, b)
	}

	bad := []struct {
		name  string
		edit  func(*ConnectEmailHubInput)
		field string
		host  string
	}{
		{"host with port", func(in *ConnectEmailHubInput) { in.IMAPHost = "mail.example.com:993" }, "imap_host", "mail.example.com:993"},
		{"scheme", func(in *ConnectEmailHubInput) { in.IMAPHost = "imaps://mail.example.com" }, "imap_host", "imaps://mail.example.com"},
		{"path", func(in *ConnectEmailHubInput) { in.SMTPHost = "a/b" }, "smtp_host", "a/b"},
		{"userinfo", func(in *ConnectEmailHubInput) { in.IMAPHost = "me@mail.example.com" }, "imap_host", "me@mail.example.com"},
		{"empty label", func(in *ConnectEmailHubInput) { in.IMAPHost = "mail..example.com" }, "imap_host", "mail..example.com"},
		{"leading hyphen", func(in *ConnectEmailHubInput) { in.SMTPHost = "-bad.example.com" }, "smtp_host", "-bad.example.com"},
		{"underscore", func(in *ConnectEmailHubInput) { in.IMAPHost = "_dmarc.example.com" }, "imap_host", "_dmarc.example.com"},
		{"254 chars", func(in *ConnectEmailHubInput) { in.IMAPHost = strings.Repeat("a.", 126) + "ab" }, "imap_host", ""},
		{"64-char label", func(in *ConnectEmailHubInput) { in.IMAPHost = strings.Repeat("a", 64) + ".example.com" }, "imap_host", ""},
		{"numeric shorthand", func(in *ConnectEmailHubInput) { in.IMAPHost = "127.1" }, "imap_host", "127.1"},
		{"decimal address", func(in *ConnectEmailHubInput) { in.SMTPHost = "2130706433" }, "smtp_host", "2130706433"},
		{"bracketed v4", func(in *ConnectEmailHubInput) { in.IMAPHost = "[8.8.8.8]" }, "imap_host", "8.8.8.8"},
		{"blank host", func(in *ConnectEmailHubInput) { in.IMAPHost = "  " }, "imap_host", ""},
		{"only smtp host", func(in *ConnectEmailHubInput) {
			*in = ConnectEmailHubInput{SMTPHost: "mail.example.com"}
		}, "imap_host", ""},
		{"port 8080", func(in *ConnectEmailHubInput) { in.IMAPPort = 8080 }, "imap_port", ""},
		{"port missing", func(in *ConnectEmailHubInput) { in.IMAPPort = 0 }, "imap_port", ""},
		{"smtp port 2525", func(in *ConnectEmailHubInput) { in.SMTPPort = 2525 }, "smtp_port", ""},
		{"security ssl", func(in *ConnectEmailHubInput) { in.SMTPSecurity = "ssl" }, "smtp_security", ""},
		{"security missing", func(in *ConnectEmailHubInput) { in.IMAPSecurity = "" }, "imap_security", ""},
		{"username 321", func(in *ConnectEmailHubInput) { in.Username = strings.Repeat("u", 321) }, "username", ""},
		{"username CR", func(in *ConnectEmailHubInput) { in.Username = "ops\rRCPT" }, "username", ""},
	}
	for _, c := range bad {
		t.Run(c.name, func(t *testing.T) {
			in := customEmailHubInput()
			c.edit(&in)
			_, err := resolveEmailHubServer("me@example.com", in)
			wantEmailHubServerErr(t, err, ErrEmailHubInvalidServer, c.field, c.host)
		})
	}
}

func TestResolveEmailHubServerBlockedIPLiteral(t *testing.T) {
	for _, host := range []string{
		"127.0.0.1", "10.0.0.5", "169.254.169.254", "::1", "[::1]", "::ffff:10.0.0.1", "fe80::1%eth0",
	} {
		in := customEmailHubInput()
		in.IMAPHost = host
		_, err := resolveEmailHubServer("me@example.com", in)
		wantEmailHubServerErr(t, err, ErrEmailHubHostNotAllowed, "imap_host", host)
	}
	in := customEmailHubInput()
	in.SMTPHost = "192.168.1.10"
	_, err := resolveEmailHubServer("me@example.com", in)
	wantEmailHubServerErr(t, err, ErrEmailHubHostNotAllowed, "smtp_host", "192.168.1.10")

	in = customEmailHubInput()
	in.IMAPHost = "8.8.8.8"
	if got, err := resolveEmailHubServer("me@example.com", in); err != nil || got.IMAPHost != "8.8.8.8" {
		t.Fatalf("public IPv4 literal: got %+v, %v", got, err)
	}
}

func TestResolveEmailHubServerRejectsHeaderInjectionAddress(t *testing.T) {
	for _, email := range []string{
		"a\r\nbcc: x@evil.test@gmail.com", "not-an-address", "bob <bob@gmail.com>", "",
	} {
		for _, in := range []ConnectEmailHubInput{{}, customEmailHubInput()} {
			var ve ValidationError
			if _, err := resolveEmailHubServer(email, in); !errors.As(err, &ve) {
				t.Fatalf("address %q: want ValidationError, got %v", email, err)
			}
		}
	}
}
