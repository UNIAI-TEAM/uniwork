package smtpclient

import (
	"context"
	"mime"
	"strings"
	"testing"
	"time"
)

const (
	preferredSubjectLineLimitForTest = 78
	hardSubjectLineLimitForTest      = 998
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

func TestBuildRawEncodesNonASCIISubjectRFC2047(t *testing.T) {
	t.Parallel()
	const subject = "Báo giá tháng 10"
	raw := buildRaw(
		"from@example.com",
		[]string{"to@example.com"},
		nil,
		nil,
		subject,
		"Body",
		"",
		nil,
		"<id@example.com>",
		"",
		"",
	)

	header := rawHeaderValue(t, raw, "Subject")
	if !isASCII(header) {
		t.Fatalf("Subject header contains raw non-ASCII bytes: %q", header)
	}
	if !strings.HasPrefix(header, "=?UTF-8?q?") {
		t.Fatalf("Subject header is not RFC 2047 Q-encoded: %q", header)
	}
	decoded, err := new(mime.WordDecoder).DecodeHeader(unfoldHeaderValue(header))
	if err != nil {
		t.Fatalf("decode Subject header: %v", err)
	}
	if decoded != subject {
		t.Fatalf("decoded Subject = %q, want %q", decoded, subject)
	}
}

func TestBuildRawKeepsASCIISubjectUnchanged(t *testing.T) {
	t.Parallel()
	const subject = "Quarterly report 2026"
	raw := buildRaw(
		"from@example.com",
		[]string{"to@example.com"},
		nil,
		nil,
		subject,
		"Body",
		"",
		nil,
		"<id@example.com>",
		"",
		"",
	)

	if got := rawHeaderValue(t, raw, "Subject"); got != subject {
		t.Fatalf("Subject header = %q, want unchanged %q", got, subject)
	}
}

func TestBuildRawSanitizesNewlinesBeforeEncodingSubject(t *testing.T) {
	t.Parallel()
	const subject = "Báo giá\r\nBcc: attacker@example.com\ntháng 10"
	raw := buildRaw(
		"from@example.com",
		[]string{"to@example.com"},
		nil,
		nil,
		subject,
		"Body",
		"",
		nil,
		"<id@example.com>",
		"",
		"",
	)

	if strings.Contains(raw, "\r\nBcc: attacker@example.com") {
		t.Fatal("Subject newline injection created a Bcc header")
	}
	header := rawHeaderValue(t, raw, "Subject")
	if !isASCII(header) {
		t.Fatalf("Subject header contains raw non-ASCII bytes: %q", header)
	}
	decoded, err := new(mime.WordDecoder).DecodeHeader(unfoldHeaderValue(header))
	if err != nil {
		t.Fatalf("decode Subject header: %v", err)
	}
	if decoded != "Báo giá  Bcc: attacker@example.com tháng 10" {
		t.Fatalf("decoded sanitized Subject = %q", decoded)
	}
}

func TestBuildRawFoldsLongASCIISubject(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name        string
		subject     string
		wantEncoded bool
	}{
		{name: "foldable words", subject: strings.TrimSpace(strings.Repeat("Quarterly report 2026 ", 80))},
		{name: "unbroken word", subject: strings.Repeat("A", hardSubjectLineLimitForTest+100), wantEncoded: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			raw := buildRaw(
				"from@example.com",
				[]string{"to@example.com"},
				nil,
				nil,
				tt.subject,
				"Body",
				"",
				nil,
				"<id@example.com>",
				"",
				"",
			)

			header := rawHeaderValue(t, raw, "Subject")
			if !strings.Contains(header, "\r\n ") {
				t.Fatalf("long ASCII Subject was not folded: %q", header)
			}
			if got := strings.Contains(header, "=?UTF-8?q?"); got != tt.wantEncoded {
				t.Fatalf("encoded Subject = %t, want %t", got, tt.wantEncoded)
			}
			decoded, err := new(mime.WordDecoder).DecodeHeader(unfoldHeaderValue(header))
			if err != nil {
				t.Fatalf("decode unfolded Subject header: %v", err)
			}
			if decoded != tt.subject {
				t.Fatalf("decoded Subject = %q, want %q", decoded, tt.subject)
			}
			assertSubjectPhysicalLineLengths(t, raw, preferredSubjectLineLimitForTest, hardSubjectLineLimitForTest)
		})
	}
}

func TestBuildRawFoldsLongUnicodeSubject(t *testing.T) {
	t.Parallel()
	subject := strings.TrimSpace(strings.Repeat("Báo giá tháng 10 ", 80))
	raw := buildRaw(
		"from@example.com",
		[]string{"to@example.com"},
		nil,
		nil,
		subject,
		"Body",
		"",
		nil,
		"<id@example.com>",
		"",
		"",
	)

	header := rawHeaderValue(t, raw, "Subject")
	if !strings.Contains(header, "\r\n ") {
		t.Fatalf("long Unicode Subject was not folded: %q", header)
	}
	decoded, err := new(mime.WordDecoder).DecodeHeader(unfoldHeaderValue(header))
	if err != nil {
		t.Fatalf("decode unfolded Subject header: %v", err)
	}
	if decoded != subject {
		t.Fatalf("decoded Subject = %q, want %q", decoded, subject)
	}
	assertSubjectPhysicalLineLengths(t, raw, preferredSubjectLineLimitForTest, hardSubjectLineLimitForTest)
}

func rawHeaderValue(t *testing.T, raw, name string) string {
	t.Helper()
	prefix := name + ": "
	lines := strings.Split(raw, "\r\n")
	for i, line := range lines {
		if strings.HasPrefix(line, prefix) {
			var value strings.Builder
			value.WriteString(strings.TrimPrefix(line, prefix))
			for _, continuation := range lines[i+1:] {
				if !strings.HasPrefix(continuation, " ") && !strings.HasPrefix(continuation, "\t") {
					break
				}
				value.WriteString("\r\n")
				value.WriteString(continuation)
			}
			return value.String()
		}
	}
	t.Fatalf("missing %s header", name)
	return ""
}

func unfoldHeaderValue(value string) string {
	return strings.ReplaceAll(value, "\r\n", "")
}

func assertSubjectPhysicalLineLengths(t *testing.T, raw string, preferred, hard int) {
	t.Helper()
	lines := strings.Split(raw, "\r\n")
	found := false
	for i, line := range lines {
		if !strings.HasPrefix(line, "Subject: ") {
			continue
		}
		found = true
		for {
			if len(line) > hard {
				t.Fatalf("Subject physical line length = %d, exceeds hard limit %d", len(line), hard)
			}
			if len(line) > preferred {
				t.Fatalf("Subject physical line length = %d, exceeds preferred limit %d", len(line), preferred)
			}
			i++
			if i >= len(lines) || (!strings.HasPrefix(lines[i], " ") && !strings.HasPrefix(lines[i], "\t")) {
				break
			}
			line = lines[i]
		}
		break
	}
	if !found {
		t.Fatal("missing Subject header")
	}
}

func isASCII(value string) bool {
	for i := 0; i < len(value); i++ {
		if value[i] > 0x7f {
			return false
		}
	}
	return true
}

func TestSendRequiresRecipients(t *testing.T) {
	t.Parallel()
	_, _, err := Send(context.Background(), Credentials{}, Message{Subject: "Hi", BodyText: "x"})
	if err == nil || !strings.Contains(err.Error(), "recipient") {
		t.Fatalf("expected recipient error, got %v", err)
	}
}

func TestSendCancelledContext(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, _, err := Send(ctx, Credentials{Host: "127.0.0.1", Port: 1, Email: "a@b.co", Password: "x"}, Message{
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
	_, _, err := Send(ctx, Credentials{
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
