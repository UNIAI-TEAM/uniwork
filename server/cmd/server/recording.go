package main

import (
	"errors"
	"strings"

	"github.com/unicomhub/uniwork/server/internal/meetings"
	"github.com/unicomhub/uniwork/server/internal/storage"
)

// recordingTarget builds the LiveKit Egress upload target from the FileService
// storage config (T8 flag 4): Egress writes the object FileService registered,
// so it must write the same bucket with the same provider's credentials.
// LIVEKIT_RECORDING_BUCKET only confirms the operator meant that bucket, and
// LIVEKIT_RECORDING_S3_ENDPOINT only overrides the host Egress reaches it by
// (a container cannot use localhost). Any mismatch is a startup error rather
// than a recording that fails on the first call.
func recordingTarget(cfg storage.Config, bucket, endpointOverride string) (*meetings.RecordingS3, error) {
	bucket = strings.TrimSpace(bucket)
	if bucket == "" {
		return nil, nil
	}
	if bucket != cfg.Bucket() {
		return nil, errors.New("LIVEKIT_RECORDING_BUCKET must name the FileService bucket (MINIO_BUCKET or S3_BUCKET of the selected STORAGE_BACKEND)")
	}
	target := &meetings.RecordingS3{Bucket: bucket, Endpoint: strings.TrimSpace(endpointOverride)}
	switch cfg.Backend {
	case storage.BackendMinIO:
		target.AccessKey, target.Secret, target.Region = cfg.MinIO.AccessKeyID, cfg.MinIO.SecretAccessKey, cfg.MinIO.Region
		if target.Endpoint == "" {
			target.Endpoint = cfg.MinIO.Endpoint
		}
	case storage.BackendS3:
		if cfg.S3.AccessKeyID == "" {
			return nil, errors.New("recording to s3 needs AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY: Egress cannot use the server's IAM chain")
		}
		target.AccessKey, target.Secret, target.Region = cfg.S3.AccessKeyID, cfg.S3.SecretAccessKey, cfg.S3.Region
		if target.Endpoint == "" {
			target.Endpoint = cfg.S3.EndpointURL
		}
	default:
		return nil, errors.New("LIVEKIT_RECORDING_BUCKET needs an object-store STORAGE_BACKEND (minio or s3)")
	}
	return target, nil
}
