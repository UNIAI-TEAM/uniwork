package main

import (
	"testing"

	"github.com/unicomhub/uniwork/server/internal/storage"
)

func TestRecordingTargetFollowsTheFileServiceBucket(t *testing.T) {
	minio := storage.Config{Backend: storage.BackendMinIO, MinIO: &storage.MinIOConfig{
		Endpoint: "http://localhost:9000", Bucket: "uniwork", Region: "us-east-1",
		AccessKeyID: "minio-access", SecretAccessKey: "minio-secret",
	}}

	if got, err := recordingTarget(minio, "", ""); got != nil || err != nil {
		t.Fatalf("no bucket: got %+v, %v; want recording off", got, err)
	}

	got, err := recordingTarget(minio, "uniwork", "")
	if err != nil {
		t.Fatal(err)
	}
	want := storage.MinIOConfig{Endpoint: "http://localhost:9000", Region: "us-east-1", AccessKeyID: "minio-access", SecretAccessKey: "minio-secret"}
	if got.Bucket != "uniwork" || got.Endpoint != want.Endpoint || got.Region != want.Region || got.AccessKey != want.AccessKeyID || got.Secret != want.SecretAccessKey {
		t.Fatalf("minio target = %+v", got)
	}

	got, err = recordingTarget(minio, "uniwork", "http://host.docker.internal:9000")
	if err != nil || got.Endpoint != "http://host.docker.internal:9000" {
		t.Fatalf("override: %+v, %v", got, err)
	}

	if _, err := recordingTarget(minio, "another-bucket", ""); err == nil {
		t.Fatal("a bucket other than the FileService one must fail startup")
	}

	local := storage.Config{Backend: storage.BackendLocal, Local: &storage.LocalConfig{Root: t.TempDir()}}
	if _, err := recordingTarget(local, "uniwork", ""); err == nil {
		t.Fatal("local storage cannot receive Egress output")
	}

	iam := storage.Config{Backend: storage.BackendS3, S3: &storage.S3Config{Bucket: "uniwork", Region: "us-east-1"}}
	if _, err := recordingTarget(iam, "uniwork", ""); err == nil {
		t.Fatal("s3 on the IAM chain has no static key for Egress")
	}
}
