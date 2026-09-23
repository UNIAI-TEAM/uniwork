package handler

import (
	"encoding/base64"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
)

func TestParseSendEmailHubAttachments(t *testing.T) {
	t.Parallel()
	out, err := parseSendEmailHubAttachments(nil)
	if err != nil || out != nil {
		t.Fatalf("empty: out=%v err=%v", out, err)
	}
	raw := base64.StdEncoding.EncodeToString([]byte("bytes"))
	out, err = parseSendEmailHubAttachments([]sdi.SendEmailHubAttachmentSDI{{
		Filename: "f.txt", ContentType: "text/plain", ContentBase64: raw,
	}})
	if err != nil || len(out) != 1 || string(out[0].Data) != "bytes" {
		t.Fatalf("ok: out=%+v err=%v", out, err)
	}
	_, err = parseSendEmailHubAttachments([]sdi.SendEmailHubAttachmentSDI{{
		Filename: "bad", ContentBase64: "!!!",
	}})
	if err == nil {
		t.Fatal("expected invalid base64 error")
	}
}
