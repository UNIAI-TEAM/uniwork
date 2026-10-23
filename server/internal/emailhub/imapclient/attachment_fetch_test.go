package imapclient

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"strings"
	"testing"
)

// attachmentPDF is binary on purpose: a byte that is not ASCII proves decoding.
var attachmentPDF = append([]byte("%PDF-1.7\n"), bytes.Repeat([]byte{0x00, 0xff, 0x10, 0x80}, 60)...)

// wrapBase64 encodes like a mail client: 76-character lines joined by CRLF.
func wrapBase64(b []byte) string {
	enc := base64.StdEncoding.EncodeToString(b)
	var lines []string
	for len(enc) > 76 {
		lines = append(lines, enc[:76])
		enc = enc[76:]
	}
	return strings.Join(append(lines, enc), "\r\n")
}

func attachmentServer() *fakeIMAP {
	lit := wrapBase64(attachmentPDF)
	return &fakeIMAP{reply: func(w *bufio.Writer, tag, cmd string) bool {
		if !strings.HasPrefix(cmd, "UID FETCH 7 ") {
			return false
		}
		fmt.Fprintf(w, "* 1 FETCH (UID 7 BODYSTRUCTURE ("+
			`("text" "plain" ("charset" "utf-8") NIL NIL "7bit" 5 1)`+
			`("application" "pdf" ("name" "r.pdf") NIL NIL "base64" %d NIL ("attachment" ("filename" "r.pdf")) NIL)`+
			` "mixed") BODY[2] {%d}`+"\r\n%s)\r\n%s OK done\r\n", len(lit), len(lit), lit, tag)
		return true
	}}
}

func TestDecodeTransferEncoding(t *testing.T) {
	t.Parallel()
	cases := map[string]string{
		"base64":           wrapBase64(attachmentPDF),
		"BASE64":           wrapBase64(attachmentPDF),
		"quoted-printable": "%PDF-1.7\n=00=FF=10=80" + strings.Repeat("=00=FF=10=80", 59),
	}
	for enc, raw := range cases {
		got, err := io.ReadAll(decodeTransferEncoding(strings.NewReader(raw), enc))
		if err != nil {
			t.Fatalf("%s: %v", enc, err)
		}
		if !bytes.Equal(got, attachmentPDF) {
			t.Fatalf("%s: decoded bytes differ from the original", enc)
		}
	}
	if got, _ := io.ReadAll(decodeTransferEncoding(strings.NewReader("as-is"), "binary")); string(got) != "as-is" {
		t.Fatalf("binary must pass through, got %q", got)
	}
}

func TestSessionFetchAttachmentReturnsTheOriginalBytes(t *testing.T) {
	t.Parallel()
	sess, err := OpenSession(attachmentServer().start(t))
	if err != nil {
		t.Fatal(err)
	}
	defer sess.Close()
	meta, data, err := sess.FetchAttachment("INBOX", 7, "2")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(data, attachmentPDF) {
		t.Fatalf("expected the decoded PDF, got %q", data[:min(len(data), 16)])
	}
	if meta.Filename != "r.pdf" || meta.MimeType != "application/pdf" {
		t.Fatalf("unexpected meta %+v", meta)
	}
}

// Not parallel: it fills the process-wide slot pool.
func TestAttachmentFetchHoldsAGlobalSlotOnlyWhileFetching(t *testing.T) {
	f := attachmentServer()
	creds := f.start(t)
	for i := 0; i < maxGlobalIMAPConns; i++ {
		if err := acquireGlobalIMAP(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	_, err := OpenSessionInteractive(creds)
	for i := 0; i < maxGlobalIMAPConns; i++ {
		releaseGlobalIMAP()
	}
	if err == nil || !strings.Contains(err.Error(), "capacity") {
		t.Fatalf("expected a capacity error while every slot is taken, got %v", err)
	}
	if f.sent("LOGIN") {
		t.Fatal("no connection may be opened past the slot limit")
	}

	sess, err := OpenSessionInteractive(creds)
	if err != nil {
		t.Fatal(err)
	}
	_, data, err := sess.FetchAttachment("INBOX", 7, "2")
	if err != nil {
		t.Fatal(err)
	}
	if err := sess.Close(); err != nil {
		t.Fatal(err)
	}
	if n := len(globalIMAPSlots); n != 0 {
		t.Fatalf("expected the slot back before the bytes are read, %d still held", n)
	}
	if !bytes.Equal(data, attachmentPDF) {
		t.Fatal("bytes must stay readable after the session closed")
	}
}
