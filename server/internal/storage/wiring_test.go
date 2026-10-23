package storage

import (
	"errors"
	"testing"
)

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

func TestLoadConfigRejectsConflictingAWSAliases(t *testing.T) {
	cases := map[string]map[string]string{
		"AWS_S3_BUCKET differs":                   {"AWS_S3_BUCKET": "other-bucket"},
		"AWS_S3_BUCKET without S3 group on minio": nil,
		"AWS_REGION differs":                      {"AWS_REGION": "eu-west-1"},
	}
	for name, extra := range cases {
		t.Run(name, func(t *testing.T) {
			env := validS3Env()
			if extra == nil {
				env = validMinIOEnv()
				extra = map[string]string{"AWS_S3_BUCKET": "uniwork"}
			}
			for k, v := range extra {
				env[k] = v
			}
			_, err := LoadConfig(allBackends(t), envLookup(env))
			if !errors.Is(err, ErrConfigInvalid) {
				t.Fatalf("err = %v, want storage_config_invalid", err)
			}
		})
	}
	t.Run("matching aliases are accepted", func(t *testing.T) {
		env := validS3Env()
		env["AWS_S3_BUCKET"] = env["S3_BUCKET"]
		env["AWS_REGION"] = env["S3_REGION"]
		if _, err := LoadConfig(allBackends(t), envLookup(env)); err != nil {
			t.Fatalf("matching aliases: %v", err)
		}
	})
	t.Run("AWS_REGION alone does not touch a minio deployment", func(t *testing.T) {
		env := validMinIOEnv()
		env["AWS_REGION"] = "ap-southeast-1"
		if _, err := LoadConfig(allBackends(t), envLookup(env)); err != nil {
			t.Fatalf("minio with AWS_REGION: %v", err)
		}
	})
}
