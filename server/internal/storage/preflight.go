package storage

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	s3types "github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/aws/smithy-go"
)

// The bounded startup preflight of the S3-compatible adapters (spec §3.3.3):
// prove the endpoint answers, the credentials authenticate, the bucket exists
// in the configured region, and the bucket's versioning / object-lock mode is
// one the adapter can serve. Everything runs under one deadline with a small
// retry budget, so a slow endpoint fails startup fast instead of hanging it.
// The check never creates the bucket, changes an ACL, or weakens TLS to pass.

const (
	// preflightTimeout bounds the whole check - endpoint, credentials,
	// bucket mode - retries included.
	preflightTimeout = 15 * time.Second
	// preflightAttempts is the retry budget for transient failures (network
	// resets, 5xx). A definitive answer (4xx, bad credentials) fails at once.
	preflightAttempts = 3
	preflightBackoff  = 300 * time.Millisecond
)

// preflight runs the bounded startup check and records the bucket mode on the
// adapter (versioned). Any failure keeps startup from serving.
func (s *s3ObjectStore) preflight(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, preflightTimeout)
	defer cancel()

	if err := s.preflightHeadBucket(ctx); err != nil {
		return err
	}
	if err := s.preflightBucketMode(ctx); err != nil {
		return err
	}
	return nil
}

// preflightHeadBucket proves connectivity, credentials and bucket existence,
// with a bounded retry for transient failures only.
func (s *s3ObjectStore) preflightHeadBucket(ctx context.Context) error {
	var err error
	for attempt := 1; ; attempt++ {
		_, err = s.client.HeadBucket(ctx, &s3.HeadBucketInput{Bucket: aws.String(s.bucket)})
		if err == nil {
			return nil
		}
		if attempt >= preflightAttempts || !isRetryableStorageError(err) {
			break
		}
		select {
		case <-ctx.Done():
			return fmt.Errorf("%s preflight: %w", string(s.Backend()), ctx.Err())
		case <-time.After(preflightBackoff * time.Duration(attempt)):
		}
	}
	return fmt.Errorf("%s preflight: bucket unreachable, missing or credentials rejected: %w", string(s.Backend()), err)
}

// preflightBucketMode detects the bucket's versioning and object-lock state.
// A versioned bucket is served with version-aware deletes; a bucket whose
// object-lock defaults would block every delete is refused before the first
// upload (spec §3.3.2 / §9.4), because a GC that can never delete is a
// misconfiguration, not a runtime retry.
func (s *s3ObjectStore) preflightBucketMode(ctx context.Context) error {
	versioning, err := s.client.GetBucketVersioning(ctx, &s3.GetBucketVersioningInput{Bucket: aws.String(s.bucket)})
	if err != nil {
		// Without the bucket mode the adapter cannot prove a delete removes
		// bytes - fail closed rather than guess (spec §9.4).
		return fmt.Errorf("%s preflight: cannot read bucket versioning: %w", string(s.Backend()), err)
	}
	s.versioned = versioning.Status == s3types.BucketVersioningStatusEnabled ||
		versioning.Status == s3types.BucketVersioningStatusSuspended

	lock, err := s.client.GetObjectLockConfiguration(ctx, &s3.GetObjectLockConfigurationInput{Bucket: aws.String(s.bucket)})
	if err != nil {
		// Buckets without object lock answer a not-found code - S3 uses
		// NoSuchObjectLockConfiguration(OnBucket), MinIO
		// ObjectLockConfigurationNotFoundError or a bare 404. That is the
		// healthy answer; every other failure means the mode is unknown.
		if !isAPIErrorCode(err, "NoSuchObjectLockConfiguration", "NoSuchObjectLockConfigurationOnBucket", "ObjectLockConfigurationNotFoundError", "NotFound", "404") {
			return fmt.Errorf("%s preflight: cannot read object lock configuration: %w", string(s.Backend()), err)
		}
		return nil
	}
	cfg := lock.ObjectLockConfiguration
	if cfg == nil || cfg.ObjectLockEnabled != s3types.ObjectLockEnabledEnabled {
		return nil
	}
	// Object lock is on. A bucket-wide default retention would hold every
	// object the service writes, so that destination is refused; object-lock
	// enabled without a default rule is safe because this adapter never sends
	// retention headers and deletes keep working.
	if rule := cfg.Rule; rule != nil && rule.DefaultRetention != nil {
		return fmt.Errorf("%s preflight: %w: bucket has a default object-lock retention; deletes would be held", string(s.Backend()), ErrBucketUnsupported)
	}
	return nil
}

// isRetryableStorageError reports whether a preflight failure may be
// transient: context timeouts are not (the deadline owns them), network
// errors and 5xx are, a definitive 4xx is not.
func isRetryableStorageError(err error) bool {
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return false
	}
	var apiErr smithy.APIError
	if errors.As(err, &apiErr) {
		code := apiErr.ErrorCode()
		switch code {
		case "RequestTimeout", "InternalError", "ServiceUnavailable", "SlowDown", "RequestTimeoutException":
			return true
		}
		// Any other API answer is definitive: auth, missing bucket, forbidden.
		return false
	}
	// No API answer at all: dial/connectivity failure - worth one retry.
	return true
}

// isAPIErrorCode reports whether err is a smithy API error with one of the
// given codes.
func isAPIErrorCode(err error, codes ...string) bool {
	var apiErr smithy.APIError
	if !errors.As(err, &apiErr) {
		return false
	}
	for _, code := range codes {
		if apiErr.ErrorCode() == code {
			return true
		}
	}
	return false
}
