package smtpclient

import (
	"context"
	"strings"
	"testing"
	"time"
)

func TestCleanAddrs(t *testing.T) {
	t.Parallel()
	got := cleanAddrs([]string{"  A@Example.COM ", "", "b@c.co\r\n"})
	if len(got) != 2 || got[0] != "a@example.com" || got[1] != "b@c.co" {
		t.Fatalf("cleanAddrs: %#v", got)
	}
}

func TestNewMessageIDUsesSenderDomain(t *testing.T) {
	t.Parallel()
	id := newMessageID("user@gmail.com")
	if !strings.HasPrefix(id, "<") || !strings.HasSuffix(id, "@gmail.com>") {
		t.Fatalf("message id: %q", id)
	}
}

func TestBuildRawIncludesHeaders(t *testing.T) {
	t.Parallel()
	raw := buildRaw(
		"from@example.com",
		[]string{"to@example.com"},
		[]string{"cc@example.com"},
		nil,
		"Subject line",
		"Body",
		"",
		nil,
		"<id@example.com>",
		"<parent@example.com>",
		"<parent@example.com>",
	)
	for _, want := range []string{
		"From: from@example.com",
		"To: to@example.com",
		"Cc: cc@example.com",
		"Subject: Subject line",
		"Message-ID: <id@example.com>",
		"In-Reply-To: <parent@example.com>",
		"References: <parent@example.com>",
		"Body",
	} {
		if !strings.Contains(raw, want) {
			t.Fatalf("raw missing %q:\n%s", want, raw)
		}
	}
}

func TestEncodeHeaderStripsNewlines(t *testing.T) {
	t.Parallel()
	if got := encodeHeader("hello\nworld"); got != "hello world" {
		t.Fatalf("encodeHeader: %q", got)
	}
}

func TestSendRequiresRecipients(t *testing.T) {
	t.Parallel()
	_, err := Send(context.Background(), Credentials{}, Message{Subject: "Hi", BodyText: "x"})
	if err == nil || !strings.Contains(err.Error(), "recipient") {
		t.Fatalf("expected recipient error, got %v", err)
	}
}

func TestSendCancelledContext(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := Send(ctx, Credentials{Host: "127.0.0.1", Port: 1, Email: "a@b.co", Password: "x"}, Message{
		To: []string{"c@d.co"}, Subject: "Hi", BodyText: "body",
	})
	if err == nil {
		t.Fatal("expected cancelled context error")
	}
}

func TestSendDialFailure(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_, err := Send(ctx, Credentials{
		Host: "127.0.0.1", Port: 1, Email: "user@gmail.com", Password: "secret",
	}, Message{
		To: []string{"dest@example.com"}, Subject: "Hi", BodyText: "Hello",
	})
	if err == nil {
		t.Fatal("expected dial/auth failure")
	}
}

func TestVerifyLoginUnreachable(t *testing.T) {
	t.Parallel()
	err := VerifyLogin(Credentials{Host: "127.0.0.1", Port: 1, Email: "a@b.co", Password: "x"})
	if err == nil {
		t.Fatal("expected verify login failure")
	}
}
