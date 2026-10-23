package main

import (
	"bytes"
	"testing"
)

func TestFileAccessSecretIsLongEnoughAndStable(t *testing.T) {
	for _, jwt := range []string{"ci", "dev-secret-change-me", "a-much-longer-production-secret-value"} {
		got := fileAccessSecret(jwt)
		if len(got) < 32 {
			t.Fatalf("fileAccessSecret(%q) is %d bytes, FileAccessService needs 32", jwt, len(got))
		}
		if !bytes.Equal(got, fileAccessSecret(jwt)) {
			t.Fatalf("fileAccessSecret(%q) is not deterministic", jwt)
		}
		if bytes.Equal(got, []byte(jwt)) {
			t.Fatalf("fileAccessSecret(%q) returned the JWT secret itself", jwt)
		}
	}
	if bytes.Equal(fileAccessSecret("a"), fileAccessSecret("b")) {
		t.Fatal("different JWT secrets derived the same file access secret")
	}
}
