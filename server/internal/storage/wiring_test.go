package storage

import "testing"

func TestConfigBucketFollowsTheSelectedBackend(t *testing.T) {
	cfg := Config{
		Backend: BackendMinIO,
		S3:      &S3Config{Bucket: "legacy-bucket"},
		MinIO:   &MinIOConfig{Bucket: "files-bucket"},
	}
	if got := cfg.Bucket(); got != "files-bucket" {
		t.Fatalf("minio bucket = %q", got)
	}
	cfg.Backend = BackendS3
	if got := cfg.Bucket(); got != "legacy-bucket" {
		t.Fatalf("s3 bucket = %q", got)
	}
	cfg.Backend = BackendLocal
	if got := cfg.Bucket(); got != "" {
		t.Fatalf("local bucket = %q, want none", got)
	}
}

func TestNewLegacyStorageNeverPicksAnUndeclaredDestination(t *testing.T) {
	if got := NewLegacyStorage(Config{Backend: BackendMinIO, MinIO: &MinIOConfig{Bucket: "b"}}); got != nil {
		t.Fatalf("minio-only config built a legacy adapter %T; want none", got)
	}
	root := t.TempDir()
	got := NewLegacyStorage(Config{
		Backend: BackendMinIO,
		MinIO:   &MinIOConfig{Bucket: "b"},
		Local:   &LocalConfig{Root: root, BaseURL: "http://localhost:8080/"},
	})
	local, ok := got.(*LocalStorage)
	if !ok {
		t.Fatalf("declared local group: got %T, want *LocalStorage", got)
	}
	if local.uploadDir != root || local.baseURL != "http://localhost:8080" {
		t.Fatalf("local adapter = %+v", local)
	}
}
