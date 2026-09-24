package storage

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// TestMinIOBackendIntegration proves the typed MinIO configuration against a
// real MinIO service: the loader reads MINIO_* (and never the AWS credential
// chain), and the values it produces are enough to Put, Head, Get and Delete
// an object in the configured bucket.
//
// It is gated on the MINIO_* variables so a machine without MinIO skips it
// cleanly. `docker compose -f docker-compose.minio.yml up -d minio` followed
// by the minio-init service is the local setup; CI runs the same image as a
// job service and creates the test bucket with minio/mc.
func TestMinIOBackendIntegration(t *testing.T) {
	required := []string{
		"MINIO_ENDPOINT",
		"MINIO_BUCKET",
		"MINIO_ACCESS_KEY_ID",
		"MINIO_SECRET_ACCESS_KEY",
		"MINIO_REGION",
	}
	for _, key := range required {
		if strings.TrimSpace(os.Getenv(key)) == "" {
			t.Skipf("skipping MinIO integration test: %s is not set; start MinIO with `docker compose -f docker-compose.minio.yml up -d minio`", key)
		}
	}

	// The test owns the groups it does not exercise, so an ambient
	// LOCAL_UPLOAD_DIR or S3_BUCKET cannot change what is loaded.
	t.Setenv("LOCAL_UPLOAD_DIR", "")
	t.Setenv("S3_BUCKET", "")
	// MinIO must not read these. A fallback would be caught by the access-key
	// assertion below and by the Put itself.
	t.Setenv("AWS_ACCESS_KEY_ID", "aws-chain-must-not-be-used")
	t.Setenv("AWS_SECRET_ACCESS_KEY", "aws-chain-must-not-be-used")

	// Hide STORAGE_BACKEND so the run also covers the documented default:
	// absent selector -> minio.
	env := func(key string) (string, bool) {
		if key == "STORAGE_BACKEND" {
			return "", false
		}
		return os.LookupEnv(key)
	}

	cfg, err := LoadConfig(registryFor(t, BackendMinIO), env)
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if cfg.Backend != BackendMinIO {
		t.Fatalf("Backend = %q, want minio for an absent STORAGE_BACKEND", cfg.Backend)
	}
	if cfg.MinIO.AccessKeyID != os.Getenv("MINIO_ACCESS_KEY_ID") {
		t.Fatal("MinIO access key must come from MINIO_ACCESS_KEY_ID, not from the AWS credential chain")
	}
	if cfg.MinIO.Bucket != os.Getenv("MINIO_BUCKET") {
		t.Fatalf("Bucket = %q, want %q", cfg.MinIO.Bucket, os.Getenv("MINIO_BUCKET"))
	}
	t.Logf("MinIO integration target: endpoint %s bucket %s region %s", cfg.MinIO.Endpoint, cfg.MinIO.Bucket, cfg.MinIO.Region)

	client := s3.New(s3.Options{
		Region:       cfg.MinIO.Region,
		BaseEndpoint: aws.String(cfg.MinIO.Endpoint),
		// MinIO is reached path-style; virtual-host style needs wildcard DNS.
		UsePathStyle: true,
		Credentials:  credentials.NewStaticCredentialsProvider(cfg.MinIO.AccessKeyID, cfg.MinIO.SecretAccessKey, ""),
	})

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	key := fmt.Sprintf("t2-prep/%d-%s/probe.txt", os.Getpid(), time.Now().UTC().Format("20060102T150405.000000000"))
	body := []byte("t2-prep MinIO integration probe")
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cleanupCancel()
		_, _ = client.DeleteObject(cleanupCtx, &s3.DeleteObjectInput{Bucket: aws.String(cfg.MinIO.Bucket), Key: aws.String(key)})
	})

	if _, err := client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(cfg.MinIO.Bucket),
		Key:         aws.String(key),
		Body:        bytes.NewReader(body),
		ContentType: aws.String("text/plain"),
	}); err != nil {
		t.Fatalf("PutObject: %v", err)
	}

	head, err := client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(cfg.MinIO.Bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		t.Fatalf("HeadObject: %v", err)
	}
	if head.ContentLength == nil || *head.ContentLength != int64(len(body)) {
		t.Fatalf("HeadObject ContentLength = %v, want %d", head.ContentLength, len(body))
	}

	object, err := client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(cfg.MinIO.Bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		t.Fatalf("GetObject: %v", err)
	}
	got, readErr := io.ReadAll(object.Body)
	closeErr := object.Body.Close()
	if readErr != nil {
		t.Fatalf("read object body: %v", readErr)
	}
	if closeErr != nil {
		t.Fatalf("close object body: %v", closeErr)
	}
	if !bytes.Equal(got, body) {
		t.Fatalf("GetObject body = %q, want %q", got, body)
	}

	if _, err := client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(cfg.MinIO.Bucket),
		Key:    aws.String(key),
	}); err != nil {
		t.Fatalf("DeleteObject: %v", err)
	}
	if _, err := client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(cfg.MinIO.Bucket),
		Key:    aws.String(key),
	}); err == nil {
		t.Fatal("HeadObject after DeleteObject succeeded, the object is still there")
	} else if errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("HeadObject after delete did not answer before the deadline: %v", err)
	}
}
