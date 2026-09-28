package service

import (
	"testing"

	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/files/filescontract"
)

// TestFileServiceContractLocal is Gate B's main acceptance on the filesystem
// adapter: the real FileService on the test database passes the same FS-C1
// suite filesfake passes.
func TestFileServiceContractLocal(t *testing.T) {
	backend := localFileBackend()
	filescontract.Run(t, filescontract.FactoryFunc(func(t *testing.T) filescontract.Harness {
		return newFileHarness(t, backend, nil).contract()
	}))
}

// TestFileServiceContractLocalWithADisabledPurpose keeps the
// file_purpose_disabled case on the real service now that every default
// purpose is open (G1-03 opened the Document purposes).
func TestFileServiceContractLocalWithADisabledPurpose(t *testing.T) {
	backend := localFileBackend()
	filescontract.Run(t, filescontract.FactoryFunc(func(t *testing.T) filescontract.Harness {
		return newFileHarness(t, backend, registryWithDisabled(t, files.DocumentAsset)).contract()
	}))
}

// TestFileServiceContractMinIO is the same suite on MinIO through the S3
// adapter. It skips without the MINIO_* variables of the storage integration
// test (docker compose -f docker-compose.minio.yml up -d minio).
func TestFileServiceContractMinIO(t *testing.T) {
	backend, ok := minioFileBackend()
	if !ok {
		t.Skip("MINIO_* is not set; start MinIO with `docker compose -f docker-compose.minio.yml up -d minio`")
	}
	filescontract.Run(t, filescontract.FactoryFunc(func(t *testing.T) filescontract.Harness {
		return newFileHarness(t, backend, nil).contract()
	}))
}
