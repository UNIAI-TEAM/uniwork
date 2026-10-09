package service

import (
	"os"
	"regexp"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/files/filescontract"
)

// The chat composer, the chat service and the chat_attachment purpose each
// keep an allowlist; a type one of them accepts and another refuses fails
// every upload of it (H9: .docx and .xlsx answered 415). This locks the three.
func TestChatFileAllowlistsAgree(t *testing.T) {
	spec, err := files.DefaultRegistry().Lookup(files.ChatAttachment)
	if err != nil {
		t.Fatal(err)
	}
	for mime, ext := range supportedChatFileContentTypes {
		found := false
		for _, s := range filescontract.Samples() {
			if s.ContentType != mime {
				continue
			}
			found = true
			got := spec.Policy.Canonical(files.DetectContentType(s.Body, "upload."+ext))
			if !spec.Policy.Allows(got) {
				t.Errorf("chat service allows %s (.%s) but chat_attachment refuses its verified type %q", mime, ext, got)
			}
		}
		if !found {
			t.Errorf("no filescontract sample for %s", mime)
		}
	}

	src, err := os.ReadFile("../../../packages/views/chat/chat-file-accept.ts")
	if err != nil {
		t.Fatal(err)
	}
	clientMIME := tsSetEntries(t, string(src), "ALLOWED_MIME")
	clientExt := tsSetEntries(t, string(src), "ALLOWED_EXT")
	if len(clientMIME) != len(supportedChatFileContentTypes) {
		t.Errorf("client ALLOWED_MIME = %v, service allows %v", clientMIME, supportedChatFileContentTypes)
	}
	for mime, ext := range supportedChatFileContentTypes {
		if !clientMIME[mime] {
			t.Errorf("client ALLOWED_MIME is missing %s", mime)
		}
		if !clientExt["."+ext] {
			t.Errorf("client ALLOWED_EXT is missing .%s", ext)
		}
	}
}

func tsSetEntries(t *testing.T, src, name string) map[string]bool {
	t.Helper()
	block := regexp.MustCompile(`const ` + name + ` = new Set\(\[([^\]]*)\]\)`).FindStringSubmatch(src)
	if block == nil {
		t.Fatalf("%s not found in chat-file-accept.ts", name)
	}
	out := map[string]bool{}
	for _, m := range regexp.MustCompile(`"([^"]+)"`).FindAllStringSubmatch(block[1], -1) {
		out[strings.ToLower(m[1])] = true
	}
	return out
}
