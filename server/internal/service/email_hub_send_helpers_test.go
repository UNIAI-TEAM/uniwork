package service

import (
	"encoding/base64"
	"strings"
	"testing"
)

func TestParseSendAttachmentsEmpty(t *testing.T) {
	t.Parallel()
	out, err := ParseSendAttachments(nil)
	if err != nil || out != nil {
		t.Fatalf("empty: out=%v err=%v", out, err)
	}
}

func TestParseSendAttachmentsSuccess(t *testing.T) {
	t.Parallel()
	data := []byte("hello")
	raw := base64.StdEncoding.EncodeToString(data)
	out, err := ParseSendAttachments([]SendEmailHubAttachmentPayload{{
		Filename: "a.txt", ContentType: "text/plain", ContentBase64: raw,
	}})
	if err != nil {
		t.Fatal(err)
	}
	if len(out) != 1 || string(out[0].Data) != "hello" || out[0].Filename != "a.txt" {
		t.Fatalf("unexpected: %+v", out)
	}
}

func TestParseSendAttachmentsInvalidBase64(t *testing.T) {
	t.Parallel()
	_, err := ParseSendAttachments([]SendEmailHubAttachmentPayload{{
		Filename: "a.txt", ContentBase64: "!!!",
	}})
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestParseSendAttachmentsMissingContent(t *testing.T) {
	t.Parallel()
	_, err := ParseSendAttachments([]SendEmailHubAttachmentPayload{{
		Filename: "a.txt", ContentBase64: "   ",
	}})
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestNormalizeSendAttachmentsSuccess(t *testing.T) {
	t.Parallel()
	out, err := normalizeSendAttachments([]SendEmailHubAttachmentInput{{
		Filename: "note.txt", ContentType: "text/plain", Data: []byte("ok"),
	}})
	if err != nil || len(out) != 1 || out[0].Filename != "note.txt" {
		t.Fatalf("normalize: out=%+v err=%v", out, err)
	}
}

func TestDecodeSendAttachmentsSDI(t *testing.T) {
	t.Parallel()
	raw := base64.StdEncoding.EncodeToString([]byte("x"))
	out, err := decodeSendAttachmentsSDI([]sendEmailHubAttachmentPayload{{
		Filename: "f.bin", ContentBase64: raw,
	}})
	if err != nil || len(out) != 1 || string(out[0].Data) != "x" {
		t.Fatalf("decode: %+v err=%v", out, err)
	}
}

func TestNormalizeSendAttachmentsLimits(t *testing.T) {
	t.Parallel()
	_, err := normalizeSendAttachments([]SendEmailHubAttachmentInput{{Data: nil}})
	if err == nil {
		t.Fatal("expected empty attachment error")
	}
	big := make([]byte, emailHubMaxAttachmentBytes+1)
	_, err = normalizeSendAttachments([]SendEmailHubAttachmentInput{{Filename: "big", Data: big}})
	if err == nil {
		t.Fatal("expected per-file limit error")
	}
	chunk := emailHubMaxAttachmentBytes - (1 << 20) // 4 MiB each, under per-file cap
	_, err = normalizeSendAttachments([]SendEmailHubAttachmentInput{
		{Filename: "a", Data: make([]byte, chunk)},
		{Filename: "b", Data: make([]byte, chunk)},
		{Filename: "c", Data: make([]byte, chunk)},
		{Filename: "d", Data: make([]byte, chunk)},
	})
	if err == nil {
		t.Fatal("expected total size limit error")
	}
	tooMany := make([]SendEmailHubAttachmentInput, emailHubMaxAttachmentCount+1)
	for i := range tooMany {
		tooMany[i] = SendEmailHubAttachmentInput{Filename: "x", Data: []byte("1")}
	}
	_, err = normalizeSendAttachments(tooMany)
	if err == nil {
		t.Fatal("expected count limit error")
	}
}

func TestBodyHTMLForSend(t *testing.T) {
	t.Parallel()
	if got := bodyHTMLForSend("", "<p>Hi</p>"); got != "<p>Hi</p>" {
		t.Fatalf("html prefer: %q", got)
	}
	got := bodyHTMLForSend("Hello\nWorld", "")
	if !strings.Contains(got, "Hello") || !strings.Contains(got, "<") {
		t.Fatalf("plain to html: %q", got)
	}
	if bodyHTMLForSend("", "") != "" {
		t.Fatal("expected empty")
	}
}

func TestValidateSendInput(t *testing.T) {
	t.Parallel()
	base := SendEmailHubInput{
		To: []string{"a@example.com"}, Subject: "Hi", BodyText: "Body",
	}
	if err := validateSendInput(base); err != nil {
		t.Fatal(err)
	}
	if err := validateSendInput(SendEmailHubInput{BodyText: "x", Subject: "s"}); err == nil {
		t.Fatal("expected recipient error")
	}
	if err := validateSendInput(SendEmailHubInput{To: base.To, Subject: "s"}); err == nil {
		t.Fatal("expected body error")
	}
	if err := validateSendInput(SendEmailHubInput{To: base.To, BodyText: "b"}); err == nil {
		t.Fatal("expected subject error")
	}
	if err := validateSendInput(SendEmailHubInput{To: base.To, BodyText: "b", ReplyToThreadID: "th1"}); err != nil {
		t.Fatal("reply may omit subject")
	}
}
