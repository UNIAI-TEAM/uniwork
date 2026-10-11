package service

import (
	"context"
	"errors"
	"net/http"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/storage"
)

// presignlessFiles is FileService over a backend that cannot sign a write
// target (the local filesystem store): RegisterProviderOutput refuses with the
// contract's storage_unavailable, exactly as FileService.writeTarget does.
type presignlessFiles struct{ *bridgeFiles }

func (presignlessFiles) RegisterProviderOutput(context.Context, files.ProviderOutputInput) (files.ProviderOutput, error) {
	return files.ProviderOutput{}, files.StorageUnavailable(storage.ErrCapabilityUnsupported)
}

func TestDocumentOfficeJobWithoutPresignedStorageAnswers503(t *testing.T) {
	f := newOfficeFixture(t, "no presign\n")
	svc := NewDocumentOfficeService(DocumentOfficeOptions{
		Pool: f.pool, Queries: f.q, Files: presignlessFiles{f.files}, Engine: newScriptedEngine(), Documents: f.docs,
		MaxDeadline: f.input("k").Deadline,
	})

	_, err := svc.StartOfficeJob(context.Background(), f.actor, f.input("k-presignless"))
	var ce CodedError
	if !errors.As(err, &ce) || ce.Status != http.StatusServiceUnavailable || ce.Code != files.CodeStorageUnavailable {
		t.Fatalf("StartOfficeJob on a backend without presign = %v, want a 503 storage_unavailable CodedError", err)
	}
}
