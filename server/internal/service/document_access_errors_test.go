package service

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/files"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// openRefusingFiles is a files.Service whose Open always fails with err; the
// other methods are never reached by openDocumentBytes.
type openRefusingFiles struct {
	files.Service
	err error
}

func (f openRefusingFiles) Open(context.Context, files.OpenInput) (files.Reader, error) {
	return files.Reader{}, f.err
}

// TestDocumentDownloadNeverLeaksFileCodes pins C-01 §14.5 on the read path:
// a FileService refusal on download reaches the caller in the Documents
// vocabulary, never as a file_* code.
func TestDocumentDownloadNeverLeaksFileCodes(t *testing.T) {
	doc := db.Document{ID: "doc", OrganizationID: "org", WorkspaceID: "ws"}
	cases := []struct {
		name string
		err  error
		want func(t *testing.T, err error)
	}{
		{"not found", files.NotFound("f1"), func(t *testing.T, err error) {
			if !errors.Is(err, ErrNotFound) {
				t.Fatalf("want ErrNotFound, got %v", err)
			}
		}},
		{"not ready", files.NotReady("f1"), func(t *testing.T, err error) {
			wantDocumentCode(t, err, "document_upload_invalid")
		}},
		{"storage unavailable", files.StorageUnavailable(errors.New("down")), func(t *testing.T, err error) {
			wantDocumentCode(t, err, files.CodeStorageUnavailable)
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := &DocumentService{files: openRefusingFiles{err: tc.err}}
			_, err := s.openDocumentBytes(context.Background(), doc, "f1", DocumentByteRange{})
			if err == nil {
				t.Fatal("want an error")
			}
			tc.want(t, err)
		})
	}
	t.Run("service not configured", func(t *testing.T) {
		_, err := (&DocumentService{}).openDocumentBytes(context.Background(), doc, "f1", DocumentByteRange{})
		wantDocumentCode(t, err, files.CodeStorageUnavailable)
	})
}

func wantDocumentCode(t *testing.T, err error, code string) {
	t.Helper()
	var ce CodedError
	if !errors.As(err, &ce) {
		t.Fatalf("want a CodedError %q, got %T %v", code, err, err)
	}
	if ce.Code != code {
		t.Fatalf("code = %q, want %q", ce.Code, code)
	}
	if strings.HasPrefix(ce.Code, "file_") {
		t.Fatalf("file code %q reached the caller", ce.Code)
	}
}
