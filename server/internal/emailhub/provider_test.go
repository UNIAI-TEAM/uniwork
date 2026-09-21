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
