package emailhub

import "testing"

func TestProviderForEmail(t *testing.T) {
	t.Parallel()
	p, ok := ProviderForEmail("user@gmail.com")
	if !ok || p.Name != "gmail" || p.IMAPHost != "imap.gmail.com" {
		t.Fatalf("gmail: %+v ok=%v", p, ok)
	}
	p, ok = ProviderForEmail("  USER@OUTLOOK.COM ")
	if !ok || p.Name != "outlook" {
		t.Fatalf("outlook: %+v ok=%v", p, ok)
	}
	if _, ok := ProviderForEmail("not-an-email"); ok {
		t.Fatal("expected invalid address")
	}
	if _, ok := ProviderForEmail("user@"); ok {
		t.Fatal("expected missing domain")
	}
	if _, ok := ProviderForEmail("user@unknown.example"); ok {
		t.Fatal("expected unknown provider")
	}
}

func TestServerSavesSent(t *testing.T) {
	t.Parallel()
	for host, want := range map[string]bool{
		"imap.gmail.com":        true,
		"OUTLOOK.office365.com": true,
		"imap.mail.yahoo.com":   false,
		"mail.example.com":      false,
		"":                      false,
	} {
		if got := ServerSavesSent(host); got != want {
			t.Errorf("ServerSavesSent(%q) = %v, want %v", host, got, want)
		}
	}
}

// OAuth names a provider, not a domain: a Workspace or Microsoft 365 mailbox on
// its own domain still uses the gmail/outlook servers (spec §4.4).
func TestPresetByName(t *testing.T) {
	t.Parallel()
	for name, host := range map[string]string{"gmail": "imap.gmail.com", "outlook": "outlook.office365.com"} {
		p, ok := Preset(name)
		if !ok || p.Name != name || p.IMAPHost != host || p.IMAPPort != 993 || p.SMTPPort != 587 {
			t.Errorf("Preset(%q) = %+v ok=%v", name, p, ok)
		}
	}
	for _, name := range []string{"yahoo", "custom", "", "GMAIL"} {
		if p, ok := Preset(name); ok {
			t.Errorf("Preset(%q) = %+v, want none: only the OAuth providers have a preset by name", name, p)
		}
	}
}
