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
	for _, mime := range spec.Policy.MIMEAllowlist {
		if _, canonical := spec.Policy.CanonicalTypes[mime]; canonical {
			continue
		}
		ext, ok := supportedChatFileContentTypes[mime]
		if !ok {
			t.Errorf("chat_attachment stores %s on upload but supportedChatFileContentTypes rejects it on read", mime)
			continue
		}
		if err := validateFileMessageInput(PrepareFileMessageInput{
			Filename:    "upload." + ext,
			ContentType: mime,
			SizeBytes:   1,
		}); err != nil {
			t.Errorf("validateFileMessageInput rejects %s (.%s): %v", mime, ext, err)
		}
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
	for mime := range clientMIME {
		ext, ok := supportedChatFileContentTypes[mime]
		if !ok {
			t.Errorf("client ALLOWED_MIME allows %s but service refuses it", mime)
			continue
		}
		if !clientExt["."+ext] {
			t.Errorf("client ALLOWED_EXT is missing .%s", ext)
		}
	}
	for mime, ext := range supportedChatFileContentTypes {
		if strings.HasPrefix(mime, "text/") && mime != "text/plain" {
			continue
		}
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

// The composer's document picker and the server's L8 subset must agree, or a
// picked format answers 415 (or a server type can never be picked).
func TestChatDocumentShareableTypesMirrorTheServer(t *testing.T) {
	src, err := os.ReadFile("../../../packages/views/chat/chat-file-accept.ts")
	if err != nil {
		t.Fatal(err)
	}
	block := regexp.MustCompile(`(?s)export const CHAT_DOCUMENT_SHAREABLE_TYPES.*?\n\];`).Find(src)
	if block == nil {
		t.Fatal("CHAT_DOCUMENT_SHAREABLE_TYPES block not found in chat-file-accept.ts")
	}
	client := map[string]bool{}
	for _, m := range regexp.MustCompile(`mime: "([^"]+)"`).FindAllSubmatch(block, -1) {
		client[strings.ToLower(string(m[1]))] = true
	}
	if len(client) == 0 {
		t.Fatal("CHAT_DOCUMENT_SHAREABLE_TYPES has no mime entries")
	}
	server := map[string]bool{}
	for _, m := range files.ChatDocumentMIMETypes {
		server[strings.ToLower(m)] = true
	}
	for m := range client {
		if !server[m] {
			t.Errorf("composer lists %s but files.ChatDocumentMIMETypes refuses it", m)
		}
	}
	for m := range server {
		if !client[m] {
			t.Errorf("files.ChatDocumentMIMETypes accepts %s but the composer table is missing it", m)
		}
	}
}
