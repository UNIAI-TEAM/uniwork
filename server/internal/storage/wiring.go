package storage

import "strings"

// Bucket is the bucket of the selected backend: the value FileService
// records in every new locator. Local storage has no bucket, so it is "".
func (c Config) Bucket() string {
	switch c.Backend {
	case BackendS3:
		if c.S3 != nil {
			return c.S3.Bucket
		}
	case BackendMinIO:
		if c.MinIO != nil {
			return c.MinIO.Bucket
		}
	}
	return ""
}

// NewLegacyStorage returns the pre-FileService adapter that still reads the
// rows written before each module's cutover (plan §7 step 1: keep the old
// destination readable). It is built from the validated Config, never from a
// default: legacy rows stay where their writer put them, so the adapter
// follows the declared groups, not a guess.
//
//   - selected s3, or minio selected with an S3_BUCKET group: the legacy S3
//     adapter (the destination STORAGE_BACKEND=s3 wrote before FileService);
//   - otherwise a declared LOCAL_UPLOAD_DIR: the legacy filesystem adapter
//     that also serves /uploads/*;
//   - nothing declared: nil, and every legacy read answers
//     storage_unavailable instead of pointing at a directory nobody chose.
func NewLegacyStorage(cfg Config) Storage {
	if cfg.S3 != nil && (cfg.Backend == BackendS3 || cfg.Backend == BackendMinIO) {
		// The legacy S3 constructor still owns CLOUDFRONT_DOMAIN and
		// S3_USE_PATH_STYLE; the group itself was validated by LoadConfig.
		if s3 := NewS3StorageFromEnv(); s3 != nil {
			return s3
		}
	}
	if cfg.Local != nil {
		return &LocalStorage{uploadDir: cfg.Local.Root, baseURL: strings.TrimSuffix(cfg.Local.BaseURL, "/"), keyRoot: cfg.KeyRoot}
	}
	return nil
}
